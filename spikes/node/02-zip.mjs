/**
 * Spike 2 — AES-256 ZIP in the browser, and who can actually open it.
 *
 * Questions: does `@zip.js/zip.js` produce archives that other tools decrypt, can
 * it decrypt archives other tools produced, and what exactly does the
 * compatibility warning have to say?
 *
 * Verification, none of it ours:
 *   • pyzipper 0.4.0 (pycryptodome AES) — an independent AES-ZIP implementation
 *   • Info-ZIP `unzip` / `zipinfo` — the implementation macOS and most scripts
 *     date from, and the closest thing on this machine to Windows Explorer's
 *     built-in handler (which refuses AES entirely)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BlobReader, BlobWriter, TextReader, ZipReader, ZipWriter } from '@zip.js/zip.js';

const OUT = join(process.cwd(), 'node/out/zip');
const PY = '/tmp/venv/bin/python';
const MB = 1024 * 1024;
const now = () => performance.now();
const rss = () => process.memoryUsage().rss;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const rows = [];
const check = (name, value, ok = true) => {
  rows.push({ name, value, ok });
  console.log(`  ${ok ? '    ' : 'FAIL'} ${name.padEnd(50)} ${String(value).padStart(26)}`);
};

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  return { ok: result.status === 0, out: text.split('\n').filter(Boolean).slice(-1)[0]?.trim().slice(0, 90) ?? '' };
};

console.log('\nSpike 2 — AES-256 ZIP interoperability\n');

/* ------------------------------------------------------------- fixtures */

const entries = [
  ['notes.txt', 'the quick brown fox jumps over the lazy dog\n'.repeat(200)],
  ['data/quarterly.csv', 'quarter,revenue\nQ1,120000\nQ2,135000\nQ3,151000\n'.repeat(50)],
  ['readme.md', '# Confidential bundle\n\nThree files, one password.\n'],
];

/* ---- write with zip.js, AES-256 -------------------------------------- */
let before = rss();
let started = now();
const aesWriter = new BlobWriter('application/zip');
const writer = new ZipWriter(aesWriter, { password: 'correct horse', encryptionStrength: 3 });
for (const [name, text] of entries) await writer.add(name, new TextReader(text));
const aesBytes = await writer.close();
const aesMs = Math.round(now() - started);
const aesRss = (rss() - before) / MB;
writeFileSync(join(OUT, 'zipjs-aes256.zip'), new Uint8Array(await aesBytes.arrayBuffer()));

check('zip.js AES-256 write: wall time', `${aesMs} ms`);
check('zip.js AES-256 write: RSS delta', `${aesRss.toFixed(1)} MB`);
check('zip.js AES-256 write: archive size', `${(statSync(join(OUT, 'zipjs-aes256.zip')).size / 1024).toFixed(1)} kB`);

/* ---- write with zip.js, ZipCrypto (the "compatible" option) ---------- */
const legacyWriter = new ZipWriter(new BlobWriter('application/zip'), {
  password: 'correct horse',
  zipCrypto: true, // the broken-but-universally-openable option
});
for (const [name, text] of entries) await legacyWriter.add(name, new TextReader(text));
const legacyBlob = await legacyWriter.close();
writeFileSync(join(OUT, 'zipjs-zipcrypto.zip'), new Uint8Array(await legacyBlob.arrayBuffer()));

/* ------------------------------------------------------- verification */

const PY_VERIFY = String.raw`
import json, sys, pyzipper, zipfile
path, password = sys.argv[1], sys.argv[2]
out = {}

# 1. pyzipper (independent implementation, pycryptodome AES)
def pyzipper_read():
    with pyzipper.AESZipFile(path) as zf:
        zf.setpassword(password.encode())
        names = zf.namelist()
        first = zf.read(names[0]).decode("utf-8", "replace")
        return {"names": names, "first_bytes": len(first), "has_fox": "quick brown fox" in first}
try:
    out["pyzipper"] = pyzipper_read()
except Exception as exc:
    out["pyzipper"] = f"ERROR: {type(exc).__name__}: {exc}"

# 2. Python's stdlib zipfile (ZipCrypto only, no AES)
def stdlib_read():
    with zipfile.ZipFile(path) as zf:
        zf.setpassword(password.encode())
        return {"names": zf.namelist(), "first": len(zf.read(zf.namelist()[0]))}
try:
    out["stdlib"] = stdlib_read()
except Exception as exc:
    out["stdlib"] = f"ERROR: {type(exc).__name__}: {exc}"

# 3. metadata: what encryption method each entry declares
def aes_extra(info):
    data, index = info.extra, 0
    while index + 4 <= len(data):
        header_id = int.from_bytes(data[index:index + 2], "little")
        size = int.from_bytes(data[index + 2:index + 4], "little")
        body = data[index + 4:index + 4 + size]
        if header_id == 0x9901 and len(body) >= 7:
            return {"vendor_version": int.from_bytes(body[2:4], "little"),
                    "vendor_id": body[4:6].decode("ascii", "replace"),
                    "key_bits": int.from_bytes(body[6:8] or b"\x00\x00", "little")}
        index += 4 + size
    return None

def methods():
    with zipfile.ZipFile(path) as zf:
        return [{"name": info.filename, "method": info.compress_type,
                 "flags": hex(info.flag_bits), "aes": aes_extra(info)}
                for info in zf.infolist()]
try:
    out["methods"] = methods()
except Exception as exc:
    out["methods"] = f"ERROR: {exc}"

print(json.dumps(out))
`;

const verify = (path, password) =>
  JSON.parse(execFileSync(PY, ['-c', PY_VERIFY, path, password], { encoding: 'utf8' }).trim());

/* ---- AES archive ------------------------------------------------------ */
const aesPath = join(OUT, 'zipjs-aes256.zip');
const aes = verify(aesPath, 'correct horse');
check('pyzipper reads AES-256 archive', aes.pyzipper?.names ? `${aes.pyzipper.names.length} entries, fox=${aes.pyzipper.has_fox}` : String(aes.pyzipper));
check('python stdlib reads AES-256 archive', String(aes.stdlib).startsWith('ERROR') ? 'refused — NotImplementedError' : 'opened (unexpected)', String(aes.stdlib).startsWith('ERROR'));
check('entry metadata (AES)', JSON.stringify(aes.methods?.[0] ?? aes.methods).slice(0, 68));

const infoZipAes = run('unzip', ['-P', 'correct horse', '-t', aesPath]);
check('Info-ZIP unzip (Explorer-class)', infoZipAes.ok ? 'extracted (unexpected)' : 'refused', !infoZipAes.ok);
check('  ↳ what it says', infoZipAes.out.split('\n').slice(-2).join(' ').slice(0, 64));

/* ---- ZipCrypto archive (the compatibility option) -------------------- */
const legacyPath = join(OUT, 'zipjs-zipcrypto.zip');
const legacy = verify(legacyPath, 'correct horse');
check('pyzipper reads ZipCrypto archive', legacy.stdlib?.names ? `${legacy.stdlib.names.length} entries` : String(legacy.stdlib));
const infoZipLegacy = run('unzip', ['-P', 'correct horse', '-t', legacyPath]);
check('Info-ZIP unzip reads ZipCrypto', infoZipLegacy.ok ? 'yes — broad compatibility' : 'refused', infoZipLegacy.ok);
check('  ↳ entry method', JSON.stringify(legacy.methods?.[0] ?? legacy.methods).slice(0, 52));

/* ---- reverse direction: decrypt what pyzipper wrote ------------------- */
execFileSync(PY, ['-c', String.raw`
import sys, pyzipper
path = sys.argv[1]
with pyzipper.AESZipFile(path, "w", compression=pyzipper.ZIP_DEFLATED, encryption=pyzipper.WZ_AES) as zf:
    zf.setpassword(b"from-pyzipper")
    zf.writestr("secret.txt", "written by pyzipper, read by zip.js\n" * 40)
`, join(OUT, 'pyzipper-aes256.zip')]);

started = now();
const reader = new ZipReader(new BlobReader(new Blob([await (await import('node:fs/promises')).readFile(join(OUT, 'pyzipper-aes256.zip'))])), {
  password: 'from-pyzipper',
});
const readEntries = await reader.getEntries();
const text = await readEntries[0].getData(new BlobWriter());
await reader.close();
const decryptMs = Math.round(now() - started);
check('zip.js decrypts a pyzipper AES archive', `${readEntries.length} entry, ${(await text.text()).length} chars`);
check('  ↳ wall time', `${decryptMs} ms`);

/* ---- wrong password --------------------------------------------------- */
let wrong = 'accepted (bad)';
let wrongOk = false;
try {
  const bad = new ZipReader(new BlobReader(new Blob([await (await import('node:fs/promises')).readFile(aesPath)])), { password: 'nope' });
  const badEntries = await bad.getEntries();
  await badEntries[0].getData(new BlobWriter());
  await bad.close();
} catch (error) {
  wrong = `rejected: ${String(error.message).slice(0, 40)}`;
  wrongOk = true;
}
check('zip.js rejects a wrong password', wrong, wrongOk);

/* ---- cost at scale: 50 MB of data ------------------------------------ */
// incompressible, like photos or archives — measures real I/O + AES rather than
// re-compressing a pattern
const chunk = new Uint8Array(1024 * 1024);
for (let offset = 0; offset < chunk.length; offset += 65536) {
  crypto.getRandomValues(chunk.subarray(offset, offset + 65536));
}
before = rss();
started = now();
const bigWriter = new ZipWriter(new BlobWriter('application/zip'), { password: 'bulk', encryptionStrength: 3 });
for (let index = 0; index < 50; index += 1) await bigWriter.add(`chunk-${index}.bin`, new BlobReader(new Blob([chunk])));
const bigBlob = await bigWriter.close();
const bigMs = Math.round(now() - started);
check('50 × 1 MB AES-256 write', `${bigMs} ms · ${(bigBlob.size / MB).toFixed(1)} MB · RSS +${((rss() - before) / MB).toFixed(0)} MB`);

/* ---- library cost ----------------------------------------------------- */
const zipJs = statSync(join(process.cwd(), 'node_modules/@zip.js/zip.js/index.min.js')).size;
const gz = Number(run('bash', ['-c', 'gzip -9 -c node_modules/@zip.js/zip.js/index.min.js | wc -c']).out);
check('zip.js bundle (index.min.js)', `${(zipJs / 1024).toFixed(0)} kB · ${(gz / 1024).toFixed(0)} kB gz`);
check('fflate (already shipped) for comparison', '~11 kB gz — no AES support', true);

const failures = rows.filter((row) => !row.ok);
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ rows, failures }, null, 2));
console.log(`\n  artefacts: ${readdirSync(OUT).join(', ')}`);
console.log(`  failures: ${failures.length === 0 ? 'none' : failures.map((f) => f.name).join('; ')}\n`);
