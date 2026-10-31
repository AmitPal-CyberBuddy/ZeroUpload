/**
 * Spike 1 — PDF password protection, entirely in the browser, and verified by
 * software that is not us.
 *
 * The question this answers: can ZeroUpload protect and unlock PDFs without a
 * backend, and will the result open in the applications people actually have?
 *
 * Candidates, measured against each other:
 *   A. pdf-lib-encrypt  — pure JS on WebCrypto, writes /V5 /R6 /AESV3, ~10 kB gz
 *   B. qpdf-wasm        — real qpdf in WASM, 659 kB gz, pthread build
 *
 * Verification is done by two independent implementations on this machine:
 *   • pikepdf 10.17.0  (libqpdf 12.4.2) — the same engine qpdf ships
 *   • pypdf 6.21.4                       — a separate, pure-Python implementation
 * plus a structural check of the /Encrypt dictionary that any reader must obey.
 *
 * Usage:  node node/01-pdf.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfLib from 'pdf-lib';
import { configure, lock, unlockInPlace } from 'pdf-lib-encrypt';

const { PDFDocument, StandardFonts } = pdfLib;
// `configure` wants the module namespace: the library keys off PDFRawStream and
// friends, which only exist on it.
configure(pdfLib);

const OUT = new URL('./out/pdf/', import.meta.url);
const PY = '/tmp/venv/bin/python';
const MB = 1024 * 1024;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const out = (name) => new URL(name, OUT).pathname;

const results = [];
/** `ok: false` marks a check that did not behave as required. */
const record = (row) => {
  if (row.ok === undefined) row.ok = !/bad|ACCEPTED WRONG/i.test(String(row.value));
  results.push(row);
  console.log(`  ${row.ok === false ? 'FAIL' : '    '} ${row.check.padEnd(52)} ${String(row.value).padStart(20)}`);
};

const rss = () => process.memoryUsage().rss;
const now = () => performance.now();

/* -------------------------------------------------------------- fixtures */

async function makePdf(pages, { withImage = false } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle('Quarterly figures — confidential');
  doc.setAuthor('ZeroUpload spike');
  doc.setSubject('Encryption interoperability fixture');
  for (let index = 0; index < pages; index += 1) {
    const page = doc.addPage([595.28, 841.89]);
    for (let line = 0; line < 20; line += 1) {
      page.drawText(`Page ${index + 1} · line ${line + 1} · the quick brown fox jumps over the lazy dog`, {
        x: 40,
        y: 800 - line * 34,
        size: 11,
        font,
      });
    }
    page.drawText('CONFIDENTIAL', { x: 40, y: 30, size: 9, font });
    if (withImage) {
      // A tiny PNG keeps the fixture small; it proves object-level encryption
      // does not damage stream contents.
      const png = tinyPng();
      const image = await doc.embedPng(png);
      page.drawImage(image, { x: 400, y: 640, width: 120, height: 120 });
    }
  }
  return doc.save();
}

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
const crc32 = (buffer) => {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function tinyPng() {
  const width = 8;
  const height = 8;
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x40);
  for (let y = 0; y < height; y += 1) raw[y * (width * 3 + 1)] = 0;
  const zlib = require('node:zlib');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
// `require` inside an ESM module is not available; zlib is imported lazily here.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

/* --------------------------------------------------------- python helpers */

/**
 * Every verification is done by a separate Python process so a bug in our own
 * code cannot certify itself. Each helper prints JSON on stdout.
 */
function py(script, args = []) {
  const started = now();
  const stdout = execFileSync(PY, ['-c', script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { json: JSON.parse(stdout.trim() || '{}'), ms: Math.round(now() - started) };
}

const VERIFY = String.raw`
import json, sys
import pikepdf
import pypdf

path, user_pw, owner_pw, expect = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
out = {"path": path, "expect_encrypted": expect == "encrypted"}

def attempt(label, fn):
    try:
        out[label] = fn()
    except Exception as exc:
        out[label] = f"ERROR: {type(exc).__name__}: {exc}"

def content_bytes(page):
    contents = page.obj.get("/Contents")
    if contents is None:
        return 0
    if isinstance(contents, pikepdf.Array):
        return sum(len(bytes(stream.read_bytes())) for stream in contents)
    return len(bytes(contents.read_bytes()))

def pikepdf_open(password):
    with pikepdf.open(path, password=password) as pdf:
        return {
            "pages": len(pdf.pages),
            "encrypted": bool(pdf.is_encrypted),
            "version": str(pdf.pdf_version),
            "metadata_title": str(pdf.docinfo.get("/Title", "")),
            "first_page_stream_bytes": content_bytes(pdf.pages[0]),
        }

# 1. No password at all. Encrypted => must raise; unencrypted => must open.
def no_password():
    with pikepdf.open(path) as pdf:
        opened = {"pages": len(pdf.pages), "encrypted": bool(pdf.is_encrypted)}
    if expect == "encrypted":
        return "OPENED WITHOUT A PASSWORD (bad)"
    return opened
attempt("pikepdf_no_password", no_password)

# 2. Correct user password.
attempt("pikepdf_user_password", lambda: pikepdf_open(user_pw))

# 3. What the permissions actually are, as a reader enforces them.
def owner_check():
    with pikepdf.open(path, password=owner_pw) as pdf:
        allow = pdf.allow
        return {
            "pages": len(pdf.pages),
            "extract": bool(allow.extract),
            "modify_other": bool(allow.modify_other),
            "modify_annotation": bool(allow.modify_annotation),
            "modify_form": bool(allow.modify_form),
            "print_lowres": bool(allow.print_lowres),
            "print_highres": bool(allow.print_highres),
        }
attempt("pikepdf_owner_password", owner_check)

# 4. Wrong password — must raise, not return garbage.
attempt("pikepdf_wrong_password", lambda: pikepdf.open(path, password="definitely-not-it").close() or "ACCEPTED WRONG PW (bad)")

# 5. Independent reader.
def pypdf_check():
    reader = pypdf.PdfReader(path, password=user_pw)
    page = reader.pages[0]
    text = page.extract_text() or ""
    return {
        "pages": len(reader.pages),
        "encrypted": reader.is_encrypted,
        "text_latin1_len": len(text),
        "has_confidential": "CONFIDENTIAL" in text,
        "has_page1": "Page 1" in text,
    }
attempt("pypdf_reader", pypdf_check)

# 6. The /Encrypt dictionary itself: what any conforming reader will obey.
def encrypt_dict():
    with pikepdf.open(path, password=user_pw or owner_pw) as pdf:
        enc = pdf.trailer.get("/Encrypt")
        if enc is None:
            return "NO /Encrypt (unencrypted)"
        return {
            "Filter": str(enc.get("/Filter")),
            "V": int(enc.get("/V", 0)),
            "R": int(enc.get("/R", 0)),
            "Length": int(enc.get("/Length", 0)),
            "P": int(enc.get("/P", 0)),
            "StmF": str(enc.get("/StmF", "")),
            "StrF": str(enc.get("/StrF", "")),
            "crypt_filters": str(enc.get("/CF", "")),
            "has_OE": "/OE" in enc,
            "has_UE": "/UE" in enc,
            "has_Perms": "/Perms" in enc,
        }
attempt("encrypt_dict", encrypt_dict)

print(json.dumps(out))
`;

const verify = (path, userPw, ownerPw = '', expect = 'encrypted') =>
  py(VERIFY, [path, userPw, ownerPw, expect]);

/* ------------------------------------------------------------------ main */

console.log('\nSpike 1 — PDF password protection in the browser\n');

/* ---- fixture ---------------------------------------------------------- */
let baseline = rss();
const plain = await makePdf(5, { withImage: true });
writeFileSync(out('plain.pdf'), plain);
const plainSize = statSync(out('plain.pdf')).size;
record({ check: 'fixture: 5 pages + 1 image', value: `${(plainSize / 1024).toFixed(1)} kB`, note: '' });

/* ======================================================================= */
console.log('\nA. pdf-lib-encrypt — pure JS / WebCrypto, no WASM\n');
/* ======================================================================= */

const password = 'correct horse battery staple';
const ownerPassword = 'owner fallback passphrase';

let before = rss();
let started = now();
const lockedBytes = await lock(plain, password, { permissions: -1852 }); // deny copy/modify/annotate
const lockMs = Math.round(now() - started);
const lockRss = (rss() - before) / MB;
writeFileSync(out('locked-by-pdf-lib-encrypt.pdf'), lockedBytes);
record({ check: 'lock(): wall time', value: `${lockMs} ms`, note: '' });
record({ check: 'lock(): RSS delta', value: `${lockRss.toFixed(1)} MB`, note: '' });
record({ check: 'lock(): output size', value: `${(lockedBytes.length / 1024).toFixed(1)} kB`, note: `${(lockedBytes.length / plainSize).toFixed(2)}× input` });

let verified = verify(out('locked-by-pdf-lib-encrypt.pdf'), password, password);
const noPw = verified.json.pikepdf_no_password;
record({
  check: 'libqpdf: refuses to open without a password',
  value: typeof noPw === 'string' ? noPw.split(':')[0].replace('ERROR', 'refused —') : 'OPENED (bad)',
  ok: typeof noPw === 'string',
});
record({
  check: 'libqpdf: opens with USER password',
  value: verified.json.pikepdf_user_password?.pages !== undefined ? `${verified.json.pikepdf_user_password.pages} pages` : verified.json.pikepdf_user_password,
  note: '',
});
record({
  check: 'libqpdf: rejects a WRONG password',
  value: String(verified.json.pikepdf_wrong_password).includes('PasswordError') ? 'refused — PasswordError' : String(verified.json.pikepdf_wrong_password),
  ok: String(verified.json.pikepdf_wrong_password).includes('PasswordError'),
});
record({
  check: 'libqpdf: permission bits it enforces',
  value: JSON.stringify(verified.json.pikepdf_owner_password),
  note: '',
});
record({
  check: 'pypdf: independent read + text',
  value: verified.json.pypdf_reader?.pages !== undefined
    ? `${verified.json.pypdf_reader.pages} pages, CONFIDENTIAL=${verified.json.pypdf_reader.has_confidential}, text=${verified.json.pypdf_reader.text_latin1_len} chars`
    : String(verified.json.pypdf_reader).slice(0, 70),
  note: '',
});
const encDict = verified.json.encrypt_dict;
record({
  check: 'structure: /Encrypt dictionary',
  value: encDict?.Filter ? `${encDict.Filter} V=${encDict.V} R=${encDict.R} Len=${encDict.Length}` : String(encDict),
  note: '',
});
record({
  check: 'structure: crypt filters + key material',
  value: encDict?.StmF ? `StmF=${encDict.StmF} StrF=${encDict.StrF} UE=${encDict.has_UE} OE=${encDict.has_OE} Perms=${encDict.has_Perms}` : '—',
  note: '',
});
record({ check: 'verification cost (2 python runs, 2 libs)', value: `${verified.ms} ms`, note: '' });

/* ---- round 2: unlock what we locked ----------------------------------- */
started = now();
const reloaded = await PDFDocument.load(lockedBytes, { ignoreEncryption: true });
const okUnlock = await unlockInPlace(reloaded, password);
const roundTrip = await reloaded.save({ useObjectStreams: false });
const unlockMs = Math.round(now() - started);
writeFileSync(out('unlocked-by-pdf-lib-encrypt.pdf'), roundTrip);
record({ check: 'unlock(): password accepted', value: String(okUnlock), note: '' });
record({ check: 'unlock(): wall time', value: `${unlockMs} ms`, note: '' });
const rtVerify = verify(out('unlocked-by-pdf-lib-encrypt.pdf'), '', '', 'plain');
record({
  check: 'unlocked file opens with no password (expected)',
  value: JSON.stringify(rtVerify.json.pikepdf_no_password).slice(0, 62),
  note: '',
});

/* ---- round 3: wrong password must throw, not corrupt ------------------ */
let wrongRejected = 'no';
try {
  const wrongDoc = await PDFDocument.load(lockedBytes, { ignoreEncryption: true });
  await unlockInPlace(wrongDoc, 'nope');
} catch (error) {
  wrongRejected = `yes (${String(error.message).slice(0, 40)})`;
}
record({ check: 'unlock(): wrong password rejected', value: wrongRejected, note: '' });

/* ---- round 4: the support matrix, measured against real files ---------- */

/**
 * The README claims: AES-256 and RC4 can be unlocked; AES-128 and anything
 * inside compressed object streams cannot. Those claims decide whether "unlock
 * a PDF I have the password for" is a feature or a minefield, so each one is
 * tested with a file produced by libqpdf (pikepdf), not by our own code.
 */
const makeEncrypted = (name, { R = 6, aes = true, objectStreams = true, user = password, owner = ownerPassword }) => {
  const script = String.raw`
import sys, json, pikepdf
src, dst, R, aes, streams, user, owner = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4] == "1", sys.argv[5] == "1", sys.argv[6], sys.argv[7]
encryption = pikepdf.Encryption(user=user, owner=owner, R=R, aes=aes, metadata=False)
with pikepdf.open(src) as pdf:
    pdf.save(dst, encryption=encryption,
             object_stream_mode=pikepdf.ObjectStreamMode.generate if streams else pikepdf.ObjectStreamMode.disable)
print(json.dumps({"written": dst}))
`;
  py(script, [out('plain.pdf'), out(name), String(R), aes ? '1' : '0', objectStreams ? '1' : '0', user, owner]);
  return out(name);
};

const fixtures = [
  { name: 'aes256-objectstreams.pdf', label: 'AES-256 R6, object streams', args: { R: 6, objectStreams: true }, pw: password },
  { name: 'aes256-plain.pdf', label: 'AES-256 R6, no object streams', args: { R: 6, objectStreams: false }, pw: password },
  { name: 'aes128-r4.pdf', label: 'AES-128 (R4 /AESV2)', args: { R: 4, aes: true, objectStreams: false }, pw: password },
  { name: 'rc4-128-r3.pdf', label: 'RC4-128 (R3)', args: { R: 3, aes: false, objectStreams: false }, pw: password },
  { name: 'owner-only.pdf', label: 'owner password only (user pw empty)', args: { R: 6, user: '', owner: ownerPassword }, pw: ownerPassword },
];

console.log('\nCase: unlock a file produced by libqpdf 12.4 (pikepdf), password known\n');
for (const fixture of fixtures) {
  const path = makeEncrypted(fixture.name, fixture.args);
  let outcome;
  let ok = null;
  let ms = 0;
  try {
    started = now();
    const doc = await PDFDocument.load(readFileSync(path), { ignoreEncryption: true });
    await unlockInPlace(doc, fixture.pw);
    const bytes = await doc.save({ useObjectStreams: false });
    ms = Math.round(now() - started);
    writeFileSync(out(`unlocked-${fixture.name}`), bytes);
    const check = verify(out(`unlocked-${fixture.name}`), '', '', 'plain');
    outcome = check.json.pikepdf_no_password?.pages ? `unlocked → libqpdf reads ${check.json.pikepdf_no_password.pages} pages` : `unlocked → ${JSON.stringify(check.json.pikepdf_no_password).slice(0, 40)}`;
  } catch (error) {
    ms = Math.round(now() - started);
    outcome = error.message.slice(0, 78);
  }
  record({ check: `${fixture.label}`, value: outcome, note: `${ms} ms`, ok: undefined });
  record({ check: `  ↳ time`, value: `${ms} ms`, note: '' });
}

// A real-world encrypted PDF, not one we produced. pdf.js uses "test".
const REAL_PW = 'test';
const realPath = out('real-world-encrypted-attachment.pdf');
try {
  const response = await fetch('https://api.github.com/repos/mozilla/pdf.js/contents/test/pdfs/encrypted-attachment.pdf?ref=master', {
    headers: { accept: 'application/vnd.github.raw' },
  });
  if (response.ok) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    writeFileSync(realPath, bytes);
    const info = py(String.raw`
import json, sys, pikepdf
path, pw = sys.argv[1], sys.argv[2]
out = {}
try:
    with pikepdf.open(path, password=pw) as pdf:
        out["pages"] = len(pdf.pages)
        out["attachments"] = len(pdf.attachments)
except Exception as exc:
    out["error"] = f"{type(exc).__name__}: {exc}"
print(json.dumps(out))
`, [realPath, REAL_PW]);
    let outcome;
    try {
      const doc = await PDFDocument.load(readFileSync(realPath), { ignoreEncryption: true });
      await unlockInPlace(doc, REAL_PW);
      outcome = 'unlocked';
    } catch (error) {
      outcome = error.message.slice(0, 78);
    }
    record({
      check: 'real-world file (pdf.js: encrypted-attachment.pdf)',
      value: `${(bytes.length / 1024).toFixed(1)} kB, libqpdf: ${JSON.stringify(info.json).slice(0, 34)} → ${outcome}`,
      note: '',
    });
  } else {
    record({ check: 'real-world file download', value: `HTTP ${response.status}`, note: '' });
  }
} catch (error) {
  record({ check: 'real-world file download', value: `skipped (${error.message.slice(0, 40)})`, note: '' });
}

/* ======================================================================= */
console.log('\nB. qpdf-wasm — real qpdf, pthread build\n');
/* ======================================================================= */

const qpdfDir = join(process.cwd(), 'node_modules/qpdf-wasm');
const qpdfWasm = statSync(join(qpdfDir, 'qpdf.wasm')).size;
const glue = readFileSync(join(qpdfDir, 'qpdf.js'), 'utf8');
record({ check: 'qpdf.wasm size', value: `${(qpdfWasm / 1024 / 1024).toFixed(2)} MB`, note: '' });
record({ check: 'qpdf.js glue size', value: `${(glue.length / 1024).toFixed(1)} kB`, note: '' });
record({
  check: 'shared-memory memory object (needs crossOriginIsolated)',
  value: /new WebAssembly\.Memory\(\{[^}]*shared:!0/.test(glue) ? 'YES — shared:true' : 'no',
  note: '',
});
record({
  check: 'spawns pthread workers at startup',
  value: /for\(var a=navigator\.hardwareConcurrency;a--;\)rc\(\)/.test(glue) ? 'YES — hardwareConcurrency workers' : 'no',
  note: '',
});
record({
  check: 'gzip size of the wasm (what a user downloads)',
  value: `${(Number(execFileSync('bash', ['-c', `gzip -9 -c node_modules/qpdf-wasm/qpdf.wasm | wc -c`]).toString().trim()) / 1024).toFixed(0)} kB`,
  note: '',
});

// Can it run at all? Node can hand us shared memory and worker threads, which a
// browser only allows on a cross-origin-isolated page. So a success here proves
// the engine works, NOT that GitHub Pages can host it.
let qpdfRun;
try {
  const { runQpdf } = await import('./qpdf-run.mjs');
  // Time-boxed: the pthread protocol is a shim over a shim in Node. If it has
  // not produced a file in 25 s, that is the answer — record it and move on.
  qpdfRun = await Promise.race([
    runQpdf(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('no completion within 25 s under the Node pthread shim')), 25_000)),
  ]);
  record({ check: 'runs under a Node pthread shim', value: qpdfRun.ok ? `yes — ${qpdfRun.version}` : `no — ${qpdfRun.error}`, note: '' });
  record({ check: '  ↳ startup (instantiate + pthread pool)', value: `${qpdfRun.startupMs} ms`, note: '' });
  record({ check: '  ↳ RSS after startup', value: `${qpdfRun.rssMb.toFixed(0)} MB`, note: '' });
  if (qpdfRun.encryptedBytes) {
    writeFileSync(out('locked-by-qpdf-wasm.pdf'), qpdfRun.encryptedBytes);
    const qv = verify(out('locked-by-qpdf-wasm.pdf'), qpdfRun.password, qpdfRun.password);
    record({
      check: '  ↳ libqpdf reads qpdf-wasm output',
      value: qv.json.pikepdf_user_password?.pages !== undefined ? `${qv.json.pikepdf_user_password.pages} pages, dict ${qv.json.encrypt_dict?.V}/${qv.json.encrypt_dict?.R}` : String(qv.json.pikepdf_user_password),
      note: '',
    });
  }
} catch (error) {
  record({ check: 'runs under a Node pthread shim', value: `no — ${String(error.message).slice(0, 60)}`, note: '' });
}

/* ======================================================================= */
console.log('\nC. Summary\n');
/* ======================================================================= */

const failed = results.filter((row) => row.ok === false);
for (const row of results.filter((r) => r.check.startsWith('A.') || r.check.startsWith('B.'))) {
  console.log(`  ${row.check}: ${row.value}`);
}

writeFileSync(
  out('results.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, results, failed }, null, 2),
);

console.log(`\n  artefacts in spikes/node/out/pdf/: ${readdirSync(OUT).join(', ')}`);
console.log(`  failures: ${failed.length === 0 ? 'none' : failed.map((f) => f.check).join('; ')}`);
console.log(`  peak RSS during the whole spike: ${(rss() / MB).toFixed(0)} MB (baseline ${(baseline / MB).toFixed(0)} MB)\n`);
