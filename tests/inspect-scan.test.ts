/**
 * The file scanners.
 *
 * Fixtures are built as real bytes — a PDF assembled the way a document is, a
 * ZIP with fflate, a PNG with a real chunk list — rather than as strings that
 * happen to contain the keyword under test. That distinction matters here: the
 * bug this suite exists to prevent is a scanner that finds a keyword in a naive
 * sample but not in a file an office suite actually produces.
 */
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8, zlibSync } from 'fflate';

import {
  worstSeverity,
  sortFindings,
  countBySeverity,
  describeCounts,
} from '../src/lib/inspect/findings';
import { scanPdfBytes } from '../src/lib/inspect/pdf';
import { scanArchiveBytes, readDirectory } from '../src/lib/inspect/archive';
import { scanImageBytes, endsWithEndMarker, trailingBytesOf } from '../src/lib/inspect/image';
import { scanTextBytes, inspectJsonStructure } from '../src/lib/inspect/text';
import { scanFile } from '../src/lib/inspect/scan';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { makeZip } from './helpers';

const encoder = new TextEncoder();

/**
 * latin1, one byte per character. The PDF fixture embeds an already-compressed
 * byte string, and `TextEncoder` would UTF-8 encode every byte above 0x7f into
 * two — which silently corrupts the stream and made the first version of this
 * test pass a file the scanner was right to find nothing in.
 */
function latin1Encode(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff;
  return out;
}

/** A minimal but structurally real PDF: header, one page, xref, trailer, EOF. */
function makePdf(body: string, options: { stream?: string; trailer?: string; eof?: boolean } = {}): Uint8Array {
  const stream = options.stream
    ? `4 0 obj\n<< /Length ${options.stream.length} /Filter /FlateDecode >>\nstream\n${options.stream}\nendstream\nendobj\n`
    : '';
  const text = `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R ${body} >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>
endobj
${stream}${options.trailer ?? ''}
trailer
<< /Root 1 0 R /Size 5 >>
startxref
0
${options.eof === false ? '' : '%%EOF'}
`;
  return latin1Encode(text);
}

function findingsOf(bytes: Uint8Array) {
  return scanPdfBytes(bytes, { wholeFile: true });
}

const ids = (bytes: Uint8Array) => findingsOf(bytes).findings.map((finding) => finding.id);

describe('PDF scan', () => {
  it('finds nothing to report in a plain document', () => {
    const insight = findingsOf(makePdf(''));
    expect(insight.findings.filter((finding) => finding.severity !== 'info')).toEqual([]);
    expect(insight.limited).toEqual([]);
  });

  it('flags an /OpenAction script as serious, not merely present', () => {
    const insight = findingsOf(makePdf('/OpenAction << /S /JavaScript /JS (app.alert(1)) >>'));
    const javaScript = insight.findings.find((finding) => finding.id === 'pdf.javascript');
    expect(javaScript).toBeDefined();
    expect(javaScript!.severity).toBe('danger');
    expect(javaScript!.title).toMatch(/runs javascript/i);
    expect(worstSeverity(insight.findings)).toBe('danger');
  });

  it('reports JavaScript without an open action at warning level', () => {
    const insight = findingsOf(makePdf('/Names << /JavaScript << /Names [(a) << /S /JavaScript /JS (x) >>] >> >>'));
    const javaScript = insight.findings.find((finding) => finding.id === 'pdf.javascript');
    expect(javaScript?.severity).toBe('warn');
  });

  it('flags /Launch with the count it actually saw', () => {
    const insight = findingsOf(makePdf('/OpenAction << /S /Launch /F (cmd.exe) >> /AA << /S /Launch >>'));
    const launch = insight.findings.find((finding) => finding.id === 'pdf.launch');
    expect(launch?.severity).toBe('danger');
    expect(launch?.evidence).toBe('2 launch actions');
  });

  it('finds keywords inside a compressed stream, not just the clear text', () => {
    // The keyword exists only after inflation — this is the case a plain
    // text search misses, and the reason the scanner inflates.
    const payload = '<< /S /JavaScript /JS (this.exportDataObject({cName:"a.exe"})) >>';
    const compressed = zlibSync(strToU8(payload));
    let binary = '';
    for (const byte of compressed) binary += String.fromCharCode(byte);
    const raw = makePdf('', { stream: binary });
    const insight = scanPdfBytes(raw, { wholeFile: true });
    expect(insight.findings.map((finding) => finding.id)).toContain('pdf.javascript');
    expect(insight.findings.map((finding) => finding.id)).toContain('pdf.script-body');
  });

  it('names the exploit primitive rather than repeating the keyword', () => {
    const insight = findingsOf(makePdf('/OpenAction << /S /JavaScript /JS (util.printf("%45000f", 0)) >>'));
    const body = insight.findings.find((finding) => finding.id === 'pdf.script-body');
    expect(body?.evidence).toContain('util.printf');
    expect(body?.severity).toBe('danger');
  });

  it('flags a javascript: URI in a link', () => {
    const insight = findingsOf(makePdf('/Annots [<< /A << /S /URI /URI (javascript:alert(1)) >> >>]'));
    expect(ids(makePdf('/Annots [<< /A << /S /URI /URI (javascript:alert(1)) >> >>]'))).toContain('pdf.script-uri');
    expect(insight.findings.find((finding) => finding.id === 'pdf.script-uri')?.severity).toBe('danger');
  });

  it('flags a truncated document and an adjacent polyglot header', () => {
    expect(ids(makePdf('', { eof: false }))).toContain('pdf.truncated');

    const leading = new Uint8Array([...encoder.encode('GIF89a'), ...makePdf('')]);
    const insight = scanPdfBytes(leading, { wholeFile: true });
    const offset = insight.findings.find((finding) => finding.id === 'pdf.header-offset');
    expect(offset?.evidence).toContain('6 leading bytes');
  });

  it('reports attachments and rich media without calling them malicious', () => {
    const insight = findingsOf(makePdf('/Names << /EmbeddedFiles << /Names [(a) 5 0 R] >> >> /RichMedia << /A 1 >>'));
    const embedded = insight.findings.find((finding) => finding.id === 'pdf.embedded-file');
    expect(embedded?.severity).toBe('warn');
    expect(embedded?.detail).toMatch(/smuggle/i);
  });

  it('says what it could not read instead of reporting a clean file', () => {
    const insight = scanPdfBytes(makePdf(''), { wholeFile: false });
    expect(insight.limited.join(' ')).toMatch(/first 24 MB/);

    const encrypted = findingsOf(makePdf('/Encrypt << /Filter /Standard >>'));
    expect(encrypted.findings.map((finding) => finding.id)).toContain('pdf.encrypted');
    expect(encrypted.limited.join(' ')).toMatch(/encrypted/);
  });

  it('says nothing alarming about a real generated document', async () => {
    /*
     * The regression this exists for: `stream` matched inside `endstream`, so
     * every end marker was treated as the start of a stream, the bytes after it
     * failed to inflate, and a perfectly ordinary twelve-page invoice reported
     * "13 compressed streams would not decode". False positives at that rate make
     * the whole report worthless, so it is asserted against real library output
     * rather than a hand-built fixture.
     */
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let index = 0; index < 12; index += 1) {
      const page = doc.addPage();
      for (let line = 0; line < 40; line += 1) {
        page.drawText(`Page ${index + 1} line ${line + 1}: an ordinary invoice line item`, {
          x: 40,
          y: 780 - line * 18,
          size: 9,
          font,
        });
      }
    }
    const insight = scanPdfBytes(await doc.save(), { wholeFile: true });
    expect(insight.findings.filter((finding) => finding.severity !== 'info')).toEqual([]);
    expect(insight.limited).toEqual([]);
  });

  it('offers the action that actually helps with a scripted document', () => {
    const insight = findingsOf(makePdf('/OpenAction << /S /JavaScript /JS (app.alert(1)) >>'));
    expect(insight.next[0].slug).toBe('split-pdf');
    expect(insight.next[0].why).toMatch(/catalog-level actions do not come with it/);
  });
});

describe('archive scan', () => {
  const zip = (entries: [string, Uint8Array][]) => makeZip(entries);

  it('reads entry names out of the central directory', () => {
    const directory = readDirectory(zip([['a.txt', strToU8('a')], ['folder/b.txt', strToU8('b')]]));
    expect(directory?.map((entry) => entry.name)).toEqual(['a.txt', 'folder/b.txt']);
  });

  it('flags a traversal path as serious', () => {
    const scan = scanArchiveBytes(zip([['../etc/passwd', strToU8('x')], ['ok.txt', strToU8('y')]]), { wholeFile: true });
    const traversal = scan.insight.findings.find((finding) => finding.id === 'archive.traversal');
    expect(traversal?.severity).toBe('danger');
    expect(traversal?.evidence).toContain('../etc/passwd');
  });

  it('flags an absolute path, which is the same escape by another route', () => {
    const scan = scanArchiveBytes(zip([['/etc/shadow', strToU8('x')]]), { wholeFile: true });
    expect(scan.insight.findings.map((finding) => finding.id)).toContain('archive.traversal');
  });

  it('flags a double extension and does not also file it as a plain executable', () => {
    const scan = scanArchiveBytes(zip([['invoice.pdf.exe', strToU8('MZ')]]), { wholeFile: true });
    const found = scan.insight.findings.map((finding) => finding.id);
    expect(found).toContain('archive.double-extension');
    expect(found).not.toContain('archive.executable');
  });

  it('names a runnable file as a warning, not an accusation', () => {
    const scan = scanArchiveBytes(zip([['setup.exe', strToU8('MZ')], ['readme.txt', strToU8('hi')]]), { wholeFile: true });
    const executable = scan.insight.findings.find((finding) => finding.id === 'archive.executable');
    expect(executable?.severity).toBe('warn');
    expect(executable?.detail).toMatch(/not proof of anything/i);
  });

  it('confirms a macro project from the part rather than the extension', () => {
    const scan = scanArchiveBytes(
      zip([
        ['[Content_Types].xml', strToU8('<Types/>')],
        ['word/vbaProject.bin', strToU8('macro bytes')],
        ['word/document.xml', strToU8('<doc/>')],
      ]),
      { wholeFile: true },
    );
    const macro = scan.insight.findings.find((finding) => finding.id === 'archive.macro');
    expect(macro?.title).toMatch(/macro project confirmed/i);
    expect(macro?.severity).toBe('danger');
  });

  it('flags a macro-enabled extension even without the part', () => {
    const scan = scanArchiveBytes(zip([['report.xlsm', strToU8('PK')]]), { wholeFile: true });
    const macro = scan.insight.findings.find((finding) => finding.id === 'archive.macro');
    expect(macro).toBeDefined();
    expect(macro?.severity).toBe('danger');
  });

  it('reports embedded OLE objects and external links separately', () => {
    const scan = scanArchiveBytes(
      zip([
        ['word/embeddings/oleObject1.bin', strToU8('ole')],
        ['xl/externalLinks/externalLink1.xml', strToU8('<x/>')],
      ]),
      { wholeFile: true },
    );
    const found = scan.insight.findings.map((finding) => finding.id);
    expect(found).toContain('archive.embedded-object');
    expect(found).toContain('archive.external-link');
  });

  it('is silent on a folder of ordinary files', () => {
    const scan = scanArchiveBytes(zip([['photos/a.jpg', strToU8('x')], ['notes.md', strToU8('y')]]), { wholeFile: true });
    expect(scan.insight.findings).toEqual([]);
    expect(scan.entryCount).toBe(2);
  });

  it('refuses to guess when the directory cannot be read', () => {
    const scan = scanArchiveBytes(encoder.encode('this is not an archive'), { wholeFile: true });
    expect(scan.unreadable).toMatch(/could not be read/);
    expect(scan.insight.findings).toEqual([]);
  });
});

/** A minimal valid 1×1 PNG with the given extra chunks and trailing bytes. */
function makePng(options: { trailing?: Uint8Array; truncateIend?: boolean; width?: number; height?: number } = {}): Uint8Array {
  const width = options.width ?? 1;
  const height = options.height ?? 1;
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(strToU8(type), 4);
    out.set(data, 8);
    return out;
  };
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const idat = new Uint8Array([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01]);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    ...(options.truncateIend ? [] : [chunk('IEND', new Uint8Array(0))]),
  ];
  const trailing = options.trailing ?? new Uint8Array(0);
  const total = parts.reduce((sum, part) => sum + part.length, 0) + trailing.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  out.set(trailing, offset);
  return out;
}

describe('image scan', () => {
  it('finds nothing in a clean PNG', () => {
    const insight = scanImageBytes(makePng(), { width: 1, height: 1 });
    expect(insight.findings).toEqual([]);
  });

  it('measures the bytes appended after IEND and names what they look like', () => {
    const zipTail = zipSync({ 'payload.txt': strToU8('hidden') });
    const insight = scanImageBytes(makePng({ trailing: zipTail }), { width: 1, height: 1 });
    const trailing = insight.findings.find((finding) => finding.id === 'image.trailing-data');
    expect(trailing?.severity).toBe('warn');
    expect(trailing?.evidence).toMatch(/looks like a ZIP archive/);
    expect(trailing?.title).toMatch(new RegExp(`${zipTail.length.toLocaleString()} bytes`));
  });

  it('counts trailing bytes the same way through the exported helper', () => {
    const bytes = makePng({ trailing: new Uint8Array(40) });
    expect(trailingBytesOf(bytes)).toBe(40);
    expect(endsWithEndMarker('png', bytes.subarray(0, 40))).toBe(false);
  });

  it('flags a PNG that never ends', () => {
    const insight = scanImageBytes(makePng({ truncateIend: true }), { width: 1, height: 1 });
    expect(insight.findings.map((finding) => finding.id)).toContain('image.unterminated');
  });

  it('warns about a pixel count that would exhaust a tab', () => {
    const insight = scanImageBytes(makePng({ width: 30_000, height: 30_000 }), { width: 30_000, height: 30_000 });
    const ids = insight.findings.map((finding) => finding.id);
    expect(ids).toContain('image.pixel-count');
    expect(insight.findings.find((finding) => finding.id === 'image.pixel-count')?.evidence).toBe('30000 × 30000');
  });

  it('explains that re-encoding is the fix for appended data', () => {
    const insight = scanImageBytes(makePng({ trailing: zipSync({ 'a': strToU8('x') }) }), { width: 1, height: 1 });
    expect(insight.next[0].slug).toBe('image-converter');
    expect(insight.next.some((step) => step.why.includes('dropping anything appended'))).toBe(true);
  });

  it('says so when the format is not one it can walk', () => {
    const insight = scanImageBytes(strToU8('not an image'));
    expect(insight.limited[0]).toMatch(/not recognised/);
  });
});

describe('text scan', () => {
  const scan = (text: string, name = 'notes.txt') => scanTextBytes(strToU8(text), { name });

  it('counts structure without reporting a hazard in ordinary prose', () => {
    const insight = scan('hello\nworld\n');
    expect(insight.findings.filter((finding) => finding.severity !== 'info')).toEqual([]);
  });

  it('names a renamed binary rather than trying to read it as text', () => {
    const pdf = makePdf('');
    const insight = scanTextBytes(pdf, { name: 'invoice.txt' });
    const renamed = insight.findings.find((finding) => finding.id === 'text.renamed-binary');
    expect(renamed?.severity).toBe('danger');
    expect(renamed?.title).toBe('This is not text — it is a PDF');
  });

  it('flags executable markup only when the file is markup', () => {
    const html = scan('<html><script>alert(1)</script></html>', 'page.html');
    expect(html.findings.map((finding) => finding.id)).toContain('text.markup-script');

    const prose = scan('Use the <script> tag to include JavaScript.', 'notes.txt');
    expect(prose.findings.map((finding) => finding.id)).not.toContain('text.markup-script');
  });

  it('flags inline event handlers as executable markup', () => {
    const insight = scan('<html><body onload="alert(1)"></body></html>', 'x.html');
    const finding = insight.findings.find((entry) => entry.id === 'text.markup-script');
    expect(finding?.evidence).toContain('on* handler');
  });

  it('finds duplicate keys, which JSON.parse silently resolves', () => {
    const result = inspectJsonStructure('{"a":1,"a":2}');
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.duplicateKeys).toEqual(['a']);
  });

  it('measures nesting depth and warns on a parser-buster', () => {
    const deep = '['.repeat(80) + ']'.repeat(80);
    const result = inspectJsonStructure(deep);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.depth).toBe(80);
    const insight = scan(deep, 'x.json');
    expect(insight.findings.map((finding) => finding.id)).toContain('text.json-depth');
  });

  it('reports invalid JSON with the position it failed at', () => {
    const result = inspectJsonStructure('{"a": }');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/character \d+/);
  });

  it('detects a BOM, which breaks shell scripts', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8('echo hi')]);
    const insight = scanTextBytes(bytes, { name: 'run.sh' });
    const bom = insight.findings.find((finding) => finding.id === 'text.bom');
    expect(bom?.title).toBe('UTF-8 BOM present');
    expect(bom?.evidence).toBe('ef bb bf');
  });

  it('reports mixed line endings as a compatibility fact', () => {
    const insight = scan('one\r\ntwo\nthree\rfour');
    const mixed = insight.findings.find((finding) => finding.id === 'text.mixed-endings');
    expect(mixed?.evidence).toBe('crlf + lf + cr');
  });

  it('suggests the formatter only when there is JSON to format', () => {
    expect(scan('{"a":1}', 'x.json').next[0].slug).toBe('json-formatter');
    expect(scan('plain words').next.map((step) => step.slug)).not.toContain('json-formatter');
  });
});

describe('scanFile dispatch', () => {
  const run = (name: string, family: Parameters<typeof scanFile>[0]['family'], bytes: Uint8Array) =>
    scanFile({
      name,
      size: bytes.length,
      family,
      readHead: async () => bytes,
      readTail: async () => bytes.subarray(Math.max(0, bytes.length - 4096)),
    });

  it('routes a PDF to the PDF scanner', async () => {
    const insight = await run('x.pdf', 'pdf', makePdf('/OpenAction << /S /Launch /F (a) >>'));
    expect(insight.findings.map((finding) => finding.id)).toContain('pdf.launch');
  });

  it('routes an archive to the archive scanner', async () => {
    const insight = await run('x.zip', 'archive', makeZip([['../escape', strToU8('x')]]));
    expect(insight.findings.map((finding) => finding.id)).toContain('archive.traversal');
  });

  it('adds the name-level checks that belong to no single scanner', async () => {
    const doubled = await run('invoice.pdf.exe', 'unknown', strToU8('MZ'));
    expect(doubled.findings.map((finding) => finding.id)).toContain('name.double-extension');

    const bidi = await run('invoice\u202egnp.exe', 'unknown', strToU8('MZ'));
    expect(bidi.findings.map((finding) => finding.id)).toContain('name.bidi-control');
  });

  it('does not treat a right-to-left name in ordinary prose as a double extension', async () => {
    const insight = await run('notes.txt', 'text', strToU8('hello'));
    expect(insight.findings.map((finding) => finding.id)).not.toContain('name.double-extension');
  });

  it('keeps going when a scanner throws, and says which one', async () => {
    const insight = await scanFile({
      name: 'x.pdf',
      size: 10,
      family: 'pdf',
      readHead: async () => {
        throw new Error('unreadable');
      },
    });
    expect(insight.limited.join(' ')).toMatch(/PDF scan could not complete/);
  });

  it('states plainly what an empty result means', async () => {
    const insight = await run('a.png', 'unknown', makePng());
    expect(insight.limited.length).toBeGreaterThan(0);
  });

  it('always leaves at least one next step', async () => {
    const insight = await run('a.bin', 'unknown', new Uint8Array([0, 1, 2, 3, 0]));
    expect(insight.next.length).toBeGreaterThan(0);
  });
});

describe('finding helpers', () => {
  const sample = [
    { id: 'a', severity: 'info' as const, title: 'note', detail: '' },
    { id: 'b', severity: 'danger' as const, title: 'bad', detail: '' },
    { id: 'c', severity: 'warn' as const, title: 'meh', detail: '' },
  ];

  it('orders by severity and keeps the reported order inside one', () => {
    expect(sortFindings(sample).map((finding) => finding.id)).toEqual(['b', 'c', 'a']);
  });

  it('names the worst severity and counts each level', () => {
    expect(worstSeverity(sample)).toBe('danger');
    expect(worstSeverity([])).toBeNull();
    expect(countBySeverity(sample)).toEqual({ danger: 1, warn: 1, info: 1 });
  });

  it('writes a heading a person can scan', () => {
    expect(describeCounts(sample)).toBe('1 serious · 1 warning · 1 note');
    expect(describeCounts([sample[1], sample[1]])).toBe('2 serious');
  });
});
