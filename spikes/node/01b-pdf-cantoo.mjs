/**
 * Spike 1b — @cantoo/pdf-lib as the single PDF engine: read encrypted files
 * (including compressed object streams), write AES-256, and stay a drop-in for
 * the API our pdf/ops.ts already uses.
 *
 * Verify: libqpdf (pikepdf 10.17 / qpdf 12.4) and pypdf, both independent.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

const OUT = join(process.cwd(), 'node/out/pdf');
mkdirSync(OUT, { recursive: true });
const PY = '/tmp/venv/bin/python';
const MB = 1024 * 1024;
const now = () => performance.now();
const rss = () => process.memoryUsage().rss;

const VERIFY = String.raw`
import json, sys
import pikepdf, pypdf
path, user_pw, owner_pw = sys.argv[1], sys.argv[2], sys.argv[3]
out = {}

def attempt(label, fn):
    try:
        out[label] = fn()
    except Exception as exc:
        out[label] = f"ERROR: {type(exc).__name__}: {exc}"

def summarize(pdf):
    first = pdf.pages[0]
    return {"pages": len(pdf.pages), "encrypted": bool(pdf.is_encrypted), "title": str(pdf.docinfo.get("/Title", ""))}

attempt("no_password", lambda: summarize(pikepdf.open(path)))
attempt("with_user", lambda: summarize(pikepdf.open(path, password=user_pw)))
attempt("with_owner", lambda: summarize(pikepdf.open(path, password=owner_pw)))
attempt("wrong", lambda: summarize(pikepdf.open(path, password="wrong-wrong")))
attempt("pypdf", lambda: {"pages": len(pypdf.PdfReader(path, password=user_pw).pages),
                          "text": len(pypdf.PdfReader(path, password=user_pw).pages[0].extract_text() or "")})
def enc():
    with pikepdf.open(path, password=user_pw or owner_pw) as pdf:
        e = pdf.trailer.get("/Encrypt")
        if e is None: return "none"
        return {"V": int(e.V), "R": int(e.R), "Length": int(e.get("/Length", 0)), "P": int(e.P),
                "StmF": str(e.get("/StmF", "")), "UE": "/UE" in e, "Perms": "/Perms" in e}
attempt("encrypt_dict", enc)
print(json.dumps(out))
`;

const verify = (path, userPw, ownerPw = '') =>
  JSON.parse(execFileSync(PY, ['-c', VERIFY, path, userPw, ownerPw], { encoding: 'utf8' }).trim());

const rows = [];
const check = (name, value, ok = true) => {
  rows.push({ name, value, ok });
  console.log(`  ${ok ? '    ' : 'FAIL'} ${name.padEnd(54)} ${String(value).padStart(20)}`);
};

console.log('\nSpike 1b — @cantoo/pdf-lib as the engine\n');

/* ---- fixture: a 5-page document written by *this* library ------------- */
const source = await (async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle('Cantoo fixture');
  doc.setAuthor('ZeroUpload spike');
  for (let p = 0; p < 5; p += 1) {
    const page = doc.addPage([595.28, 841.89]);
    for (let line = 0; line < 20; line += 1) {
      page.drawText(`Page ${p + 1} line ${line + 1} — interoperability fixture`, { x: 40, y: 800 - line * 34, size: 11, font });
    }
  }
  return doc.save();
})();
writeFileSync(join(OUT, 'cantoo-plain.pdf'), source);

/* ---- 1. write protection --------------------------------------------- */
{
  const before = rss();
  const started = now();
  const doc = await PDFDocument.load(source);
  doc.encrypt({
    userPassword: 'user-pw',
    ownerPassword: 'owner-pw',
    permissions: { printing: 'highResolution', copying: false, modifying: false, annotating: false },
  });
  const bytes = await doc.save();
  const ms = Math.round(now() - started);
  writeFileSync(join(OUT, 'cantoo-locked.pdf'), bytes);
  check('encrypt(): wall time', `${ms} ms`);
  check('encrypt(): RSS delta', `${((rss() - before) / MB).toFixed(1)} MB`);
  check('encrypt(): size', `${(bytes.length / 1024).toFixed(1)} kB · ${(bytes.length / source.length).toFixed(2)}×`);

  const v = verify(join(OUT, 'cantoo-locked.pdf'), 'user-pw', 'owner-pw');
  check('libqpdf: no password', v.no_password?.includes?.('PasswordError') || String(v.no_password).includes('PasswordError') ? 'refused' : String(v.no_password));
  check('libqpdf: user password', v.with_user?.pages ? `${v.with_user.pages} pages` : String(v.with_user));
  check('libqpdf: owner password', v.with_owner?.pages ? `${v.with_owner.pages} pages` : String(v.with_owner));
  check('libqpdf: wrong password', String(v.wrong).includes('PasswordError') ? 'refused' : String(v.wrong));
  check('pypdf: independent read', v.pypdf?.pages ? `${v.pypdf.pages} pages, ${v.pypdf.text} chars` : String(v.pypdf));
  check('structure', v.encrypt_dict ? JSON.stringify(v.encrypt_dict) : '—');
}

/* ---- 2. read a file produced by libqpdf, WITH object streams ---------- */
for (const mode of ['generate', 'disable']) {
  const path = join(OUT, `cantoo-read-${mode}.pdf`);
  execFileSync(PY, ['-c', String.raw`
import sys, pikepdf
src, dst, mode = sys.argv[1], sys.argv[2], sys.argv[3]
with pikepdf.open(src) as pdf:
    pdf.save(dst, encryption=pikepdf.Encryption(user="user-pw", owner="owner-pw", R=6, metadata=False),
             object_stream_mode=pikepdf.ObjectStreamMode.generate if mode == "generate" else pikepdf.ObjectStreamMode.disable)
`, join(OUT, 'cantoo-plain.pdf'), path, mode]);

  const started = now();
  let outcome;
  let ok = true;
  try {
    const doc = await PDFDocument.load(readFileSync(path), { password: 'user-pw' });
    const pages = doc.getPageCount();
    const bytes = await doc.save();
    writeFileSync(join(OUT, `cantoo-unlocked-${mode}.pdf`), bytes);
    const v = verify(join(OUT, `cantoo-unlocked-${mode}.pdf`), '');
    outcome = `opened ${pages} pages → libqpdf reads ${v.no_password?.pages ?? '?'}, encrypted=${v.no_password?.encrypted}`;
  } catch (error) {
    ok = false;
    outcome = error.message.slice(0, 70);
  }
  check(`load({password}) — object streams ${mode}`, outcome, ok);
  check('  ↳ time', `${Math.round(now() - started)} ms`);
}

/* ---- 3. wrong password must throw ------------------------------------- */
{
  let outcome = 'did not throw (bad)';
  let ok = false;
  try {
    await PDFDocument.load(readFileSync(join(OUT, 'cantoo-locked.pdf')), { password: 'nope' });
  } catch (error) {
    outcome = `threw: ${String(error.message).slice(0, 50)}`;
    ok = true;
  }
  check('load({password}) with a wrong password', outcome, ok);
}

/* ---- 4. inspect an encrypted file without decrypting ------------------ */
{
  const doc = await PDFDocument.load(readFileSync(join(OUT, 'cantoo-locked.pdf')), { ignoreEncryption: true });
  check('isEncrypted on an encrypted file', String(doc.isEncrypted));
}

/* ---- 5. ours again: can libqpdf-produced AES-256 be re-encrypted? ----- */
{
  const doc = await PDFDocument.load(readFileSync(join(OUT, 'cantoo-read-generate.pdf')), { password: 'user-pw' });
  doc.encrypt({ userPassword: 'new-user', ownerPassword: 'new-owner' });
  const bytes = await doc.save();
  writeFileSync(join(OUT, 'cantoo-reencrypted.pdf'), bytes);
  const v = verify(join(OUT, 'cantoo-reencrypted.pdf'), 'new-user', 'new-owner');
  check('change password (decrypt → re-encrypt)', v.with_user?.pages ? `new password works, ${v.with_user.pages} pages` : String(v.with_user));
}

/* ---- 5b. older crypt filters: AES-128 (R4) and RC4-128 (R3) ---------- */
for (const [label, encryption] of [
  ['AES-128 R4', 'pikepdf.Encryption(user="user-pw", owner="owner-pw", R=4, aes=True)'],
  ['RC4-128 R3', 'pikepdf.Encryption(user="user-pw", owner="owner-pw", R=3, aes=False, metadata=False)'],
]) {
  const path = join(OUT, `cantoo-read-${label.replace(/[^a-z0-9]+/gi, '-')}.pdf`);
  execFileSync(PY, ['-c', String.raw`
import sys, pikepdf
src, dst = sys.argv[1], sys.argv[2]
enc = ${encryption}
with pikepdf.open(src) as pdf:
    pdf.save(dst, encryption=enc, object_stream_mode=pikepdf.ObjectStreamMode.generate)
`, join(OUT, 'cantoo-plain.pdf'), path]);

  const started = now();
  let outcome;
  let ok = true;
  try {
    const doc = await PDFDocument.load(readFileSync(path), { password: 'user-pw' });
    const bytes = await doc.save();
    writeFileSync(path.replace('.pdf', '-unlocked.pdf'), bytes);
    outcome = `opened ${doc.getPageCount()} pages`;
  } catch (error) {
    ok = false;
    outcome = error.message.slice(0, 60);
  }
  check(`load({password}) — ${label}`, outcome, ok);
  check('  ↳ time', `${Math.round(now() - started)} ms`);
}

/* ---- 6. owner-only protection (restrictions, no open password) -------- */
{
  const path = join(OUT, 'cantoo-owner-only.pdf');
  execFileSync(PY, ['-c', String.raw`
import sys, pikepdf
src, dst = sys.argv[1], sys.argv[2]
with pikepdf.open(src) as pdf:
    pdf.save(dst, encryption=pikepdf.Encryption(user="", owner="owner-only", R=6),
             object_stream_mode=pikepdf.ObjectStreamMode.generate)
`, join(OUT, 'cantoo-plain.pdf'), path]);

  const locked = await PDFDocument.load(readFileSync(path), { ignoreEncryption: true });
  check('owner-only file: isEncrypted', String(locked.isEncrypted));
  try {
    const doc = await PDFDocument.load(readFileSync(path), { password: '' });
    const bytes = await doc.save();
    writeFileSync(join(OUT, 'cantoo-owner-only-unlocked.pdf'), bytes);
    const v = verify(join(OUT, 'cantoo-owner-only-unlocked.pdf'), '');
    check('owner-only file: opened with empty password', `pages=${v.no_password?.pages}, encryption=${v.encrypt_dict}`, v.no_password?.pages === 5);
  } catch (error) {
    check('owner-only file: opened with empty password', error.message.slice(0, 56), false);
  }
}

/* ---- 7. a 200-page, ~4 MB document with object streams --------------- */
{
  const bigPlain = join(OUT, 'cantoo-large-plain.pdf');
  execFileSync(PY, ['-c', String.raw`
import sys, os, pikepdf
path = sys.argv[1]
pdf = pikepdf.new()
noise = os.urandom(20000)
for index in range(200):
    pdf.add_blank_page(page_size=(595, 842))
pdf.save(path, object_stream_mode=pikepdf.ObjectStreamMode.generate)
`, bigPlain]);
  const lockedPath = join(OUT, 'cantoo-large-locked.pdf');
  execFileSync(PY, ['-c', String.raw`
import sys, pikepdf
src, dst = sys.argv[1], sys.argv[2]
with pikepdf.open(src) as pdf:
    pdf.save(dst, encryption=pikepdf.Encryption(user="user-pw", owner="owner-pw", R=6),
             object_stream_mode=pikepdf.ObjectStreamMode.generate)
`, bigPlain, lockedPath]);

  const before = rss();
  const started = now();
  const doc = await PDFDocument.load(readFileSync(lockedPath), { password: 'user-pw' });
  const bytes = await doc.save();
  const ms = Math.round(now() - started);
  writeFileSync(join(OUT, 'cantoo-large-unlocked.pdf'), bytes);
  const v = verify(join(OUT, 'cantoo-large-unlocked.pdf'), '');
  check('200-page document (unlock)', `${doc.getPageCount()} pages · ${ms} ms · RSS +${((rss() - before) / MB).toFixed(0)} MB`);
  check('  ↳ libqpdf agrees', `${v.no_password?.pages} pages, encrypted=${v.no_password?.encrypted}`, v.no_password?.pages === 200);
}

const failures = rows.filter((row) => !row.ok);
writeFileSync(join(OUT, 'cantoo-results.json'), JSON.stringify({ rows, failures }, null, 2));
console.log(`\n  failures: ${failures.length === 0 ? 'none' : failures.map((f) => f.name).join('; ')}`);
console.log(`  peak RSS: ${(rss() / MB).toFixed(0)} MB`);
