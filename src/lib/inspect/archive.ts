/**
 * What is actually inside an archive, judged by its entry names and containers.
 *
 * The inspector already lists entries to count them. This reads the same listing
 * for the three things that turn an archive from a folder into a hazard:
 *
 *  - **Paths that escape the folder you extract into.** `../` in an entry name is
 *    a zip-slip attempt; several older extractors honoured it and wrote files over
 *    the user's home directory. Our own reader sanitises these — it reports every
 *    rename as a warning — but the file still deserves the flag, because it was
 *    built to be extracted by something that does not.
 *  - **Macros.** A `.docm`, `.xlsm` or `.pptm` — or any Office container with a
 *    `vbaProject.bin` part — runs VBA when the document is opened with macros
 *    enabled. An archive is how those travel by email.
 *  - **Executables and scripts.** Not because a `.exe` is malware, but because an
 *    archive sent to a person that unpacks into a `.exe` beside a `.pdf` is a
 *    shape worth naming.
 *
 * The parser works on the central directory only — no decompression — so it is
 * cheap and cannot be made to allocate by a crafted header. It is deliberately
 * independent of `readZip`, which needs the whole archive in memory, because this
 * has to run on the *listing* without inflating anything.
 */
import { type Finding, type Insight, type NextStep, sortFindings } from './findings';

/** Entries examined; a 5,000-file archive does not need a per-file verdict. */
const MAX_ENTRIES = 4_000;
/** Reads enough of the central directory for the largest archive we accept. */
const DIRECTORY_WINDOW = 6 * 1024 * 1024;

/** Executable extensions that a person can double-click into a running process. */
const EXECUTABLE_EXTENSIONS = [
  'exe', 'scr', 'com', 'pif', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh',
  'hta', 'msi', 'msp', 'cpl', 'jar', 'lnk', 'reg', 'dll', 'apk', 'app', 'dmg', 'sh', 'command',
] as const;

/** Containers whose contents the Office applications will execute. */
const OFFICE_MACRO_HOSTS: Record<string, string> = {
  docm: 'Word',
  dotm: 'Word template',
  xlsm: 'Excel',
  xltm: 'Excel template',
  pptm: 'PowerPoint',
  potm: 'PowerPoint template',
  ppam: 'PowerPoint add-in',
  xlam: 'Excel add-in',
};

interface DirectoryEntry {
  name: string;
  /** Uncompressed size, from the central directory. */
  size: number;
  /** Absolute offset of the local file header — also where the encrypted flag lives. */
  localOffset: number;
}

const CENTRAL_HEADER = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase();
}

function directoryOnly(name: string): boolean {
  return name.endsWith('/');
}

/**
 * Walks the central directory. Returns `null` when the end record is not in the
 * window, which means the archive is larger than anything this scan claims to
 * have read — the caller reports that rather than pretending it is empty.
 */
export function readDirectory(bytes: Uint8Array): DirectoryEntry[] | null {
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (u32(bytes, offset) === END_OF_CENTRAL_DIRECTORY) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return null;

  const declared = u16(bytes, eocd + 10);
  const count = Math.min(declared, MAX_ENTRIES);
  let offset = u32(bytes, eocd + 16);
  const entries: DirectoryEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || u32(bytes, offset) !== CENTRAL_HEADER) break;
    const size = u32(bytes, offset + 24);
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const commentLength = u16(bytes, offset + 32);
    const localOffset = u32(bytes, offset + 42);
    const name = new TextDecoder('utf-8', { fatal: false }).decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    entries.push({ name, size, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

const MACRO_PART = /(^|\/)vbaProject\.bin$/i;
const ACTIVE_X = /(^|\/)activeX[^/]*\.xml$/i;
const OLE_EMBEDDING = /(^|\/)oleObject[^/]*\.bin$/i;
const EXTERNAL_LINK = /(^|\/)externalLink[^/]*\.xml$/i;

export interface ArchiveScan {
  insight: Insight;
  entryCount: number;
  /** Set when the central directory was not reachable inside the window. */
  unreadable?: string;
}

/**
 * Scans an archive without extracting it.
 *
 * `bytes` may be a window of the file; pass `wholeFile: false` and the report
 * will say what it did not see.
 */
export function scanArchiveBytes(bytes: Uint8Array, options: { wholeFile?: boolean } = {}): ArchiveScan {
  const limited: string[] = [];
  const findings: Finding[] = [];

  if (!options.wholeFile) {
    limited.push(
      'Only the end of the archive was read. Entry names are listed there, but the contents of individual entries were not inspected.',
    );
  }

  const window = bytes.length > DIRECTORY_WINDOW ? bytes.subarray(bytes.length - DIRECTORY_WINDOW) : bytes;
  const entries = readDirectory(window);
  if (!entries) {
    return {
      insight: { findings, limited, next: [] },
      entryCount: 0,
      unreadable: 'The archive directory could not be read. It may be truncated, or it may not be a ZIP at all.',
    };
  }

  const files = entries.filter((entry) => !directoryOnly(entry.name));

  /* ---- Paths that escape the extraction folder ---- */
  const traversal = files.filter((entry) => entry.name.includes('../') || entry.name.startsWith('/') || /^[a-z]:/i.test(entry.name));
  if (traversal.length > 0) {
    findings.push({
      id: 'archive.traversal',
      severity: 'danger',
      title: 'Entries try to write outside the folder',
      detail:
        'One or more entry names contain a parent-directory segment or an absolute path. An extractor that honours them writes over files elsewhere on the disk — this is the zip-slip technique, and there is no innocent reason to ship it.',
      evidence: traversal.slice(0, 3).map((entry) => entry.name).join(', ') + (traversal.length > 3 ? ` and ${traversal.length - 3} more` : ''),
      advice: 'Extract with this site, not a command-line tool: names are sanitised here and every rename is reported.',
    });
  }

  /* ---- Double extensions, the classic disguise ---- */
  const disguised = files.filter((entry) => /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|txt|mp4)\.(exe|scr|bat|cmd|com|pif|js|vbs|lnk)$/i.test(entry.name));
  if (disguised.length > 0) {
    findings.push({
      id: 'archive.double-extension',
      severity: 'danger',
      title: 'A file is disguised as a document',
      detail:
        'An entry ends in a document extension followed by an executable one. Windows hides the final extension by default, so "invoice.pdf.exe" shows as "invoice.pdf" in Explorer — and runs when double-clicked.',
      evidence: disguised.slice(0, 3).map((entry) => entry.name).join(', '),
    });
  }

  /* ---- Executables ---- */
  const executables = files.filter((entry) => (EXECUTABLE_EXTENSIONS as readonly string[]).includes(extensionOf(entry.name)));
  if (executables.length > 0 && disguised.length === 0) {
    findings.push({
      id: 'archive.executable',
      severity: 'warn',
      title: `Contains ${executables.length === 1 ? 'a runnable file' : 'runnable files'}`,
      detail:
        'These extensions start a program when opened. That is not proof of anything — installers arrive this way every day — but an archive with an executable next to documents is worth a second look before you open it.',
      evidence: executables.slice(0, 4).map((entry) => entry.name).join(', ') + (executables.length > 4 ? ` and ${executables.length - 4} more` : ''),
      advice: 'Download the file individually and inspect it rather than running it from the archive.',
    });
  }

  /* ---- Office macro containers ---- */
  const macroNames = files.filter((entry) => extensionOf(entry.name) in OFFICE_MACRO_HOSTS);
  const macroParts = entries.filter((entry) => MACRO_PART.test(entry.name));
  if (macroNames.length > 0 || macroParts.length > 0) {
    const host = macroNames.length > 0
      ? OFFICE_MACRO_HOSTS[extensionOf(macroNames[0].name)]
      : 'Office';
    findings.push({
      id: 'archive.macro',
      severity: 'danger',
      title: macroParts.length > 0 ? 'Macro project confirmed inside' : `Macro-enabled ${host} document`,
      detail:
        macroParts.length > 0
          ? 'A vbaProject.bin part is present, which is a compiled VBA macro project. If macros are enabled for the document, it runs when the file is opened — the mechanism behind most document-borne ransomware.'
          : 'The extension says the document is macro-enabled. Macros are what a macro-enabled document is for; they run on open when the application allows it.',
      evidence: (macroParts.length > 0 ? macroParts : macroNames).slice(0, 3).map((entry) => entry.name).join(', '),
      advice: 'Open it in Protected View or not at all. Nothing here can execute a macro, so inspecting it is safe.',
    });
  }

  /* ---- Embedded objects, external links, ActiveX ---- */
  const ole = entries.filter((entry) => OLE_EMBEDDING.test(entry.name));
  if (ole.length > 0) {
    findings.push({
      id: 'archive.embedded-object',
      severity: 'warn',
      title: 'Embeds an OLE object',
      detail:
        'An object from another application is embedded in the document. Embedded packages have been used to run code without macros, because opening the object launches its owning application.',
      evidence: ole.slice(0, 3).map((entry) => entry.name).join(', '),
    });
  }

  const externalLinks = entries.filter((entry) => EXTERNAL_LINK.test(entry.name));
  if (externalLinks.length > 0) {
    findings.push({
      id: 'archive.external-link',
      severity: 'warn',
      title: 'References data on another machine',
      detail:
        'An external link part means the workbook or document pulls values from a file path or a network share. Opening it can reach out to that location, and a crafted one leaks what the file reads.',
      evidence: externalLinks.slice(0, 3).map((entry) => entry.name).join(', '),
    });
  }

  const activeX = entries.filter((entry) => ACTIVE_X.test(entry.name));
  if (activeX.length > 0) {
    findings.push({
      id: 'archive.active-x',
      severity: 'warn',
      title: 'Contains an ActiveX control',
      detail: 'ActiveX controls are executable components. Word and Excel now block them by default, but a document carrying one predates that change or was built to bypass it.',
      evidence: activeX.slice(0, 3).map((entry) => entry.name).join(', '),
    });
  }

  /* ---- A bomb that stayed under our own limits ---- */
  const ratio = files.reduce((sum, entry) => sum + entry.size, 0) / Math.max(1, bytes.length);
  const huge = files.filter((entry) => entry.size > 64 * 1024 * 1024);
  if (huge.length > 0) {
    findings.push({
      id: 'archive.huge-entry',
      severity: 'info',
      title: `${huge.length === 1 ? 'A file expands' : 'Files expand'} to over 64 MB`,
      detail: `Declared uncompressed sizes reach ${(huge[0].size / 1024 / 1024).toFixed(0)} MB from a ${(bytes.length / 1024 / 1024).toFixed(1)} MB archive${ratio > 50 ? ' — a compression ratio of ' + ratio.toFixed(0) + ':1, which is bomb territory' : ''}. The extract tool refuses anything above its own limits before unpacking, so a bomb fails loudly rather than filling memory.`,
      evidence: huge.slice(0, 3).map((entry) => `${entry.name} (${(entry.size / 1024 / 1024).toFixed(0)} MB)`).join(', '),
    });
  }

  /* ---- Encrypted ---- */
  const encryptedFlag = entries.some((entry) => {
    const offset = entry.localOffset;
    if (offset + 8 > window.length || u32(window, offset) !== LOCAL_HEADER) return false;
    return (u16(window, offset + 6) & 0x0001) !== 0;
  });
  if (encryptedFlag) {
    findings.push({
      id: 'archive.encrypted',
      severity: 'info',
      title: 'Entries are encrypted',
      detail:
        'The archive has a password. Entry names are still readable — they always are in ZIP — but the contents are not, and neither this scan nor anyone else can see them without the key. A password on an archive you were not expecting is itself the warning sign: it exists to stop a scanner looking inside.',
      advice: 'Open it in the extract tool, where the password is asked for and decryption happens on your device.',
    });
  }

  if (entries.length >= MAX_ENTRIES) {
    limited.push(`Only the first ${MAX_ENTRIES.toLocaleString()} entries were examined; the rest of the listing was not read.`);
  }

  const next: NextStep[] = [];
  const has = (id: string) => findings.some((finding) => finding.id === id);
  /*
   * "Unlock" is only honest when the archive contains an Office container *and*
   * that container is what carries the problem. A plain ZIP of executables has
   * nothing to unlock, so it gets no such suggestion.
   */
  const officeInside = entries.some((entry) => /^[^/]+\.(docx|xlsx|pptx)$/i.test(entry.name))
    && (has('archive.macro') || has('archive.embedded-object') || has('archive.active-x'));
  if (has('archive.traversal') || has('archive.executable') || has('archive.double-extension')) {
    next.push({
      slug: 'extract-zip',
      label: 'Extract with the names checked',
      why: 'Path traversal is stripped here and every rename is listed, so nothing is written outside the folder you chose.',
    });
  }
  if (officeInside) {
    next.push({
      slug: 'unlock-office',
      label: 'Unlock the Office file inside',
      why: 'Removing the password also tells you which parts the document really contains.',
    });
  }
  if (entries.some((entry) => extensionOf(entry.name) === 'xlsx' || extensionOf(entry.name) === 'csv')) {
    next.push({ slug: 'xlsx-to-csv', label: 'Export a sheet to CSV', why: 'Values without the executable parts of the workbook.' });
  }
  next.push(
    { slug: 'extract-zip', label: 'Open this archive', why: 'The full entry list, ready to download one by one.' },
    { slug: 'create-zip', label: 'Rebuild it without the extras', why: 'Repack only the entries you chose to keep.' },
  );

  return {
    insight: { findings: sortFindings(findings), limited, next: dedupe(next) },
    entryCount: entries.length,
  };
}

function dedupe(steps: NextStep[]): NextStep[] {
  const seen = new Set<string>();
  return steps.filter((step) => {
    if (seen.has(step.slug)) return false;
    seen.add(step.slug);
    return true;
  });
}
