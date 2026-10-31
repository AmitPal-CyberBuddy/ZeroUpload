/**
 * Spike 3 — Office password protection, both directions.
 *
 * Read  : files encrypted by msoffcrypto-tool → `office-crypto` (JS) decrypts them.
 * Write : our own Web-Crypto Agile encryptor (`node/agile.mjs`) → msoffcrypto-tool
 *         and Office-compatible readers open them.
 *
 * Fixtures are produced by real Office consumers (python-docx / openpyxl /
 * python-pptx write genuine OOXML packages), and every result is checked by an
 * implementation that is not the one being tested.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encryptOoxml } from './agile.mjs';

const OUT = join(process.cwd(), 'node/out/office');
const PY = '/tmp/venv/bin/python';
const MB = 1024 * 1024;
const now = () => performance.now();
const rss = () => process.memoryUsage().rss;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const rows = [];
const check = (name, value, ok = true) => {
  rows.push({ name, value, ok });
  console.log(`  ${ok ? '    ' : 'FAIL'} ${name.padEnd(48)} ${String(value).padStart(24)}`);
};

const py = (code, args = []) => execFileSync(PY, ['-c', code, ...args], { encoding: 'utf8' }).trim();

console.log('\nSpike 3 — Office encryption / decryption\n');

/* ---- fixtures: real files from real writers -------------------------- */
py(String.raw`
import sys, os, docx, openpyxl, pptx
out = sys.argv[1]

d = docx.Document()
d.add_heading("ZeroUpload proof of capability", 0)
for i in range(30):
    d.add_paragraph("Paragraph %d — the quick brown fox jumps over the lazy dog." % i)
d.save(os.path.join(out, "plain.docx"))

wb = openpyxl.Workbook()
ws = wb.active
ws.append(["quarter", "revenue"])
for q in range(1, 60):
    ws.append(["Q%d" % q, q * 1000])
wb.save(os.path.join(out, "plain.xlsx"))

p = pptx.Presentation()
slide = p.slides.add_slide(p.slide_layouts[1])
slide.shapes.title.text = "Proof of capability"
slide.placeholders[1].text = "Office protection, entirely in the browser."
p.save(os.path.join(out, "plain.pptx"))
`, [OUT]);

const kinds = ['docx', 'xlsx', 'pptx'];
check('fixtures written by python-docx/openpyxl/python-pptx', kinds.map((kind) => `${kind} ${(statSync(join(OUT, `plain.${kind}`)).size / 1024).toFixed(0)} kB`).join(', '));

/* ---- encrypt with msoffcrypto-tool (the reference) -------------------- */
const PY_ENCRYPT = String.raw`
import sys, io, msoffcrypto
src, dst, password = sys.argv[1], sys.argv[2], sys.argv[3]
with open(src, "rb") as fin, open(dst, "wb") as fout:
    msoffcrypto.OfficeFile(fin).encrypt(password, fout)
`;
/* ---- verify any encrypted file with msoffcrypto-tool ------------------ */
const PY_VERIFY = String.raw`
import sys, io, json, hashlib, msoffcrypto
path, password, expect_ok = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
out = {}
data = open(path, "rb").read()
out["encrypted"] = msoffcrypto.OfficeFile(io.BytesIO(data)).is_encrypted()
try:
    file = msoffcrypto.OfficeFile(io.BytesIO(data))
    file.load_key(password=password, verify_password=True)
    plain = io.BytesIO()
    file.decrypt(plain, verify_integrity=True)
    payload = plain.getvalue()
    out["decrypted_sha256"] = hashlib.sha256(payload).hexdigest()
    out["bytes"] = len(payload)
    out["is_zip"] = payload[:2] == b"PK"
    out["ok"] = True
except Exception as exc:
    out["ok"] = False
    out["error"] = "%s: %s" % (type(exc).__name__, exc)
print(json.dumps(out))
`;

const verifyWithReference = (path, password) => JSON.parse(py(PY_VERIFY, [path, password, '1']));

/* ---- 1. reference-encrypted files, decrypted by office-crypto -------- */
const { OfficeFile } = await import('office-crypto');

for (const kind of kinds) {
  const plainPath = join(OUT, `plain.${kind}`);
  const encryptedPath = join(OUT, `reference-locked.${kind}`);
  py(PY_ENCRYPT, [plainPath, encryptedPath, 'correct horse']);

  const started = now();
  const file = await OfficeFile.create?.(readFileSync(encryptedPath));
  const handler = file ?? new (await import('office-crypto')).OOXMLFile(readFileSync(encryptedPath));
  const before = rss();
  handler.loadKey({ password: 'correct horse' });
  const decrypted = handler.decrypt();
  const ms = Math.round(now() - started);

  const plain = readFileSync(plainPath);
  const identical = Buffer.compare(Buffer.from(decrypted), plain) === 0;
  check(`office-crypto decrypts ${kind}`, `${identical ? 'byte-identical' : 'DIFFERENT'} · ${ms} ms · RSS +${((rss() - before) / MB).toFixed(1)} MB`, identical);
}

/* ---- 2. wrong password must be refused ------------------------------ */
{
  const data = readFileSync(join(OUT, 'reference-locked.docx'));
  const { OOXMLFile } = await import('office-crypto');
  const handler = new OOXMLFile(data);
  let outcome = 'accepted (bad)';
  let ok = false;
  try {
    handler.loadKey({ password: 'not-the-password' });
    handler.decrypt();
  } catch (error) {
    outcome = `${String(error.name)}: ${String(error.message).slice(0, 34)}`;
    ok = true;
  }
  check('office-crypto rejects a wrong password', outcome, ok);
}

/* ---- 3. our Web-Crypto encryptor → reference implementation ---------- */
for (const kind of kinds) {
  const plain = readFileSync(join(OUT, `plain.${kind}`));
  const before = rss();
  const started = now();
  const encrypted = await encryptOoxml(plain, 'correct horse');
  const ms = Math.round(now() - started);
  const path = join(OUT, `ours-locked.${kind}`);
  writeFileSync(path, encrypted);
  check(`ours: encrypt ${kind} (spinCount 100k)`, `${ms} ms · ${(encrypted.length / 1024).toFixed(0)} kB · RSS +${((rss() - before) / MB).toFixed(1)} MB`);

  const result = verifyWithReference(path, 'correct horse');
  const expected = py('import sys,hashlib;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())', [join(OUT, `plain.${kind}`)]);
  const ok = result.ok && result.decrypted_sha256 === expected && result.is_zip;
  check(`msoffcrypto-tool decrypts ours (${kind})`, ok ? `byte-identical · HMAC verified · ${result.bytes} B` : JSON.stringify(result).slice(0, 60), ok);

  const wrong = verifyWithReference(path, 'wrong password');
  check(`  ↳ reference rejects a wrong password`, wrong.ok ? 'accepted (bad)' : 'refused', !wrong.ok);
}

/* ---- 4. what the spin count costs ------------------------------------ */
{
  const plain = readFileSync(join(OUT, 'plain.docx'));
  for (const spinCount of [10_000, 100_000]) {
    const started = now();
    await encryptOoxml(plain, 'pw', { spinCount });
    rows.push({ name: `spinCount ${spinCount}`, value: `${Math.round(now() - started)} ms`, ok: true });
    console.log(`         spinCount ${String(spinCount).padEnd(37)} ${String(`${Math.round(now() - started)} ms`).padStart(24)}`);
  }
}

/* ---- 5. a bigger document: 8 MB of OOXML ---------------------------- */
{
  py(String.raw`
import sys, os, docx, zipfile
path = os.path.join(sys.argv[1], "large.docx")
d = docx.Document()
d.add_paragraph("Large fixture with incompressible media.")
d.save(path)
# add 8 MB of already-compressed noise so the package cannot shrink
noise = os.urandom(8 * 1024 * 1024)
with zipfile.ZipFile(path, "a", zipfile.ZIP_STORED) as zf:
    zf.writestr("word/media/blob.bin", noise)
`, [OUT]);
  const plain = readFileSync(join(OUT, 'large.docx'));
  const before = rss();
  const started = now();
  const encrypted = await encryptOoxml(plain, 'pw');
  const ms = Math.round(now() - started);
  const path = join(OUT, 'ours-locked-large.docx');
  writeFileSync(path, encrypted);
  const result = verifyWithReference(path, 'pw');
  check('8 MB document', `${(plain.length / MB).toFixed(1)} MB → ${ms} ms · RSS +${((rss() - before) / MB).toFixed(0)} MB · ${result.ok ? 'reference opens it' : 'FAILED'}`, result.ok);
}

/* ---- 6. library cost -------------------------------------------------- */
{
  const size = (path) => statSync(path).size;
  const gz = (path) => Number(execFileSync('bash', ['-c', `gzip -9 -c ${path} | wc -c`], { encoding: 'utf8' }).trim());
  const officeCrypto = 'node_modules/office-crypto/dist/index.js';
  const cfb = 'node_modules/cfb/dist/cfb.min.js';
  const agile = 'node/agile.mjs';
  check('office-crypto (decrypt)', `${(size(officeCrypto) / 1024).toFixed(0)} kB · ${(gz(officeCrypto) / 1024).toFixed(0)} kB gz`);
  check('cfb (OLE container writer)', `${(size(cfb) / 1024).toFixed(0)} kB · ${(gz(cfb) / 1024).toFixed(0)} kB gz`);
  check('our agile.mjs (encrypt)', `${(size(agile) / 1024).toFixed(1)} kB · ${(gz(agile) / 1024).toFixed(1)} kB gz`, true);
}

const failures = rows.filter((row) => !row.ok);
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ rows, failures }, null, 2));
console.log(`\n  failures: ${failures.length === 0 ? 'none' : failures.map((f) => f.name).join('; ')}\n`);
