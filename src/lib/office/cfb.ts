/**
 * A minimal Compound File Binary (OLE/CFB) writer — exactly enough for an
 * encrypted OOXML container.
 *
 * An encrypted .docx is not a ZIP: it is a CFB container holding
 * `EncryptionInfo` (the Agile descriptor) and `EncryptedPackage` (the encrypted
 * ZIP), plus the four fixed DataSpaces streams Office expects. Writing that
 * container is the one part of "protect a document" that no crypto library can
 * do for us, so it lives here, ported from the reference implementation
 * (`msoffcrypto-tool`, MIT, itself ported from herumi/msoffice, BSD-3) whose
 * output Office accepts.
 *
 * Deliberately **not** a general-purpose CFB writer: the directory tree, stream
 * order and red-black links are the fixed shape of an encrypted OOXML file, and
 * a smaller writer is a smaller thing to get wrong. The algorithm below is the
 * reference one — mini-stream for small content, regular sectors for the
 * payload, one FAT chain, no DIFAT sectors (a 64 MB payload needs ~1 050 FAT
 * sectors, well under the 109 DIFAT entries the header carries).
 *
 * Verified by reading the result back with `office-crypto`'s independent OLE
 * reader and with msoffcrypto-tool (see tests and docs/v2-proofs.md).
 */

const SECTOR_SIZE = 512;
const MINI_SECTOR_SIZE = 64;
const MINI_STREAM_CUTOFF = 4096;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;
const NOSTREAM = 0xffffffff;

export const CFB_MAGIC = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const DIR_EMPTY = 0;
const DIR_STORAGE = 1;
const DIR_STREAM = 2;
const DIR_ROOT = 5;

const RED = 0;
const BLACK = 1;

interface DirEntry {
  name: string;
  type: number;
  color: number;
  left: number;
  right: number;
  child: number;
  content: Uint8Array;
}

/** Index order matters: it is what makes the red-black links below valid. */
export const ENTRY = {
  root: 0,
  encryptedPackage: 1,
  dataSpaces: 2,
  version: 3,
  dataSpaceMap: 4,
  dataSpaceInfo: 5,
  strongEncryptionDataSpace: 6,
  transformInfo: 7,
  strongEncryptionTransform: 8,
  primary: 9,
  encryptionInfo: 10,
} as const;

const ENTRIES = 11;

/** FILETIME: 100 ns ticks since 1601-01-01. `Date.now()` is ms since 1970. */
const FILETIME_EPOCH_OFFSET_MS = 11_644_473_600_000;

function filetime(now = Date.now()): number {
  return Math.round((now + FILETIME_EPOCH_OFFSET_MS) * 10_000);
}

const u16 = (value: number): Uint8Array => Uint8Array.from([value & 0xff, (value >> 8) & 0xff]);

const u32 = (value: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
};

const u64 = (value: number): Uint8Array => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(Math.round(value)), true);
  return out;
};

function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    out[index * 2] = code & 0xff;
    out[index * 2 + 1] = code >> 8;
  }
  return out;
}

const blocks = (size: number, block: number) => Math.ceil(size / block);

/**
 * @param encryptionInfo the `EncryptionInfo` stream (8-byte Agile header + XML)
 * @param encryptedPackage the `EncryptedPackage` stream (8-byte length + AES blocks)
 * @param dataspaces the four fixed DataSpaces streams, base64-free
 */
export function writeEncryptedOoxmlContainer(
  encryptionInfo: Uint8Array,
  encryptedPackage: Uint8Array,
  dataspaces: { version: Uint8Array; dataSpaceMap: Uint8Array; strongEncryptionDataSpace: Uint8Array; primary: Uint8Array },
): Uint8Array {
  const stamp = filetime();
  const empty = new Uint8Array(0);

  const dirs: DirEntry[] = [];
  const entry = (
    name: string,
    type: number,
    color: number,
    options: { left?: number; right?: number; child?: number; content?: Uint8Array } = {},
  ) => {
    dirs.push({
      name,
      type,
      color,
      left: options.left ?? NOSTREAM,
      right: options.right ?? NOSTREAM,
      child: options.child ?? NOSTREAM,
      content: options.content ?? empty,
    });
  };

  entry('Root Entry', DIR_ROOT, RED, { child: ENTRY.encryptionInfo });
  entry('EncryptedPackage', DIR_STREAM, RED, { content: encryptedPackage });
  entry('\u0006DataSpaces', DIR_STORAGE, RED, { child: ENTRY.dataSpaceMap });
  entry('Version', DIR_STREAM, BLACK, { content: dataspaces.version });
  entry('DataSpaceMap', DIR_STREAM, BLACK, { left: ENTRY.version, right: ENTRY.dataSpaceInfo, content: dataspaces.dataSpaceMap });
  entry('DataSpaceInfo', DIR_STORAGE, BLACK, { right: ENTRY.transformInfo, child: ENTRY.strongEncryptionDataSpace });
  entry('StrongEncryptionDataSpace', DIR_STREAM, BLACK, { content: dataspaces.strongEncryptionDataSpace });
  entry('TransformInfo', DIR_STORAGE, RED, { child: ENTRY.strongEncryptionTransform });
  entry('StrongEncryptionTransform', DIR_STORAGE, BLACK, { child: ENTRY.primary });
  entry('\u0006Primary', DIR_STREAM, BLACK, { content: dataspaces.primary });
  entry('EncryptionInfo', DIR_STREAM, BLACK, { left: ENTRY.dataSpaces, right: ENTRY.encryptedPackage, content: encryptionInfo });

  /* ---- layout: everything except the payload lives in the mini stream ---- */
  const isMini = (dir: DirEntry) => dir.type === DIR_STREAM && dir.content.length > 0 && dir.content.length <= MINI_STREAM_CUTOFF;
  const miniStreams = dirs.filter(isMini);

  let miniSectors = 0;
  for (const stream of miniStreams) miniSectors += blocks(stream.content.length, MINI_SECTOR_SIZE);

  const miniFatDataSectorNum = blocks(miniSectors * MINI_SECTOR_SIZE, SECTOR_SIZE);
  const directoryEntrySectorNum = blocks(ENTRIES, SECTOR_SIZE / 128);
  const packageSectorNum = blocks(encryptedPackage.length, SECTOR_SIZE);
  const numMiniFatSectors = 1;

  // Sector order: [miniFAT][directory][mini stream][encrypted package].
  const contentSectorNum = numMiniFatSectors + directoryEntrySectorNum + miniFatDataSectorNum + packageSectorNum;

  // One FAT sector describes 128 sectors, itself included, so the count has to
  // be solved rather than divided once.
  let fatSectorNum = blocks(contentSectorNum, 128);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const needed = blocks(contentSectorNum + fatSectorNum, 128);
    if (needed === fatSectorNum) break;
    fatSectorNum = needed;
  }
  if (fatSectorNum > 109) {
    // Beyond this the header's DIFAT cannot list the FAT on its own. An Office
    // document that reaches it is far past the size budget anyway.
    throw new Error('Document too large for this container writer.');
  }

  const fatPos = 0;
  const miniFatPos = fatPos + fatSectorNum;
  const directoryEntryPos = miniFatPos + numMiniFatSectors;
  const miniFatDataPos = directoryEntryPos + directoryEntrySectorNum;
  const packagePos = miniFatDataPos + miniFatDataSectorNum;

  const totalSectors = fatSectorNum + numMiniFatSectors + directoryEntrySectorNum + miniFatDataSectorNum + packageSectorNum;
  const buffer = new Uint8Array(SECTOR_SIZE + totalSectors * SECTOR_SIZE);

  /* ------------------------------ header ------------------------------- */
  const header: Uint8Array[] = [];
  header.push(CFB_MAGIC);
  header.push(new Uint8Array(16)); // CLSID
  header.push(u16(0x003e)); // minor version
  header.push(u16(3)); // major version
  header.push(u16(0xfffe)); // little endian
  header.push(u16(9)); // sector shift (512)
  header.push(u16(6)); // mini sector shift (64)
  header.push(u16(0), u16(0), u16(0)); // reserved
  header.push(u32(0)); // number of directory sectors (v3: must be 0)
  header.push(u32(fatSectorNum));
  header.push(u32(directoryEntryPos)); // first directory sector
  header.push(u32(0)); // transaction signature
  header.push(u32(MINI_STREAM_CUTOFF));
  header.push(u32(miniFatPos)); // first mini FAT sector
  header.push(u32(numMiniFatSectors));
  header.push(u32(ENDOFCHAIN)); // first DIFAT sector — none
  header.push(u32(0)); // number of DIFAT sectors

  // DIFAT: the first 109 FAT sector ids, then FREESECT.
  const difat = new Uint32Array(109).fill(FREESECT);
  for (let index = 0; index < Math.min(fatSectorNum, 109); index += 1) difat[index] = index;
  header.push(new Uint8Array(difat.buffer.slice(0)));

  let cursor = 0;
  for (const part of header) {
    buffer.set(part, cursor);
    cursor += part.length;
  }
  if (cursor !== SECTOR_SIZE) throw new Error(`CFB header is ${cursor} bytes, expected ${SECTOR_SIZE}`);

  const sectorOffset = (sector: number) => SECTOR_SIZE + sector * SECTOR_SIZE;

  /* -------------------------------- FAT -------------------------------- */
  // Entries: FAT sectors are FATSECT, the four content chains follow each other.
  const fat = new Uint32Array(fatSectorNum * 128).fill(FREESECT);
  for (let index = 0; index < fatSectorNum; index += 1) fat[index] = FATSECT;
  const chain = (start: number, count: number) => {
    for (let index = 0; index < count; index += 1) {
      fat[start + index] = index === count - 1 ? ENDOFCHAIN : start + index + 1;
    }
  };
  chain(miniFatPos, numMiniFatSectors);
  chain(directoryEntryPos, directoryEntrySectorNum);
  chain(miniFatDataPos, miniFatDataSectorNum);
  chain(packagePos, packageSectorNum);
  buffer.set(new Uint8Array(fat.buffer), sectorOffset(fatPos));

  /* ------------------------------ mini FAT ----------------------------- */
  // One entry per mini sector: chain within each stream, ENDOFCHAIN at the end.
  const miniFatEntries = SECTOR_SIZE / 4;
  const miniFat = new Uint32Array(miniFatEntries).fill(FREESECT);
  let miniCursor = 0;
  for (const stream of miniStreams) {
    const count = blocks(stream.content.length, MINI_SECTOR_SIZE);
    for (let step = 0; step < count; step += 1) {
      miniFat[miniCursor + step] = step === count - 1 ? ENDOFCHAIN : miniCursor + step + 1;
    }
    miniCursor += count;
  }
  buffer.set(new Uint8Array(miniFat.buffer).slice(0, SECTOR_SIZE), sectorOffset(miniFatPos));

  /* ---------------------------- directories ---------------------------- */
  const miniStart = new Map<DirEntry, number>();
  let miniSectorStart = 0;
  for (const stream of miniStreams) {
    miniStart.set(stream, miniSectorStart);
    miniSectorStart += blocks(stream.content.length, MINI_SECTOR_SIZE);
  }

  const miniData = new Uint8Array(miniFatDataSectorNum * SECTOR_SIZE);
  for (const stream of miniStreams) {
    miniData.set(stream.content, (miniStart.get(stream) ?? 0) * MINI_SECTOR_SIZE);
  }

  for (let index = 0; index < dirs.length; index += 1) {
    const dir = dirs[index];
    const name = utf16le(dir.name);
    const nameSize = name.length + 2;

    // Directory entries point at the *start* of their chain: the mini sector for
    // small streams, the package sector for the payload, the mini-stream sectors
    // for the root entry.
    const startSector =
      dir.type === DIR_ROOT
        ? miniFatDataPos
        : dir.content === encryptedPackage
          ? packagePos
          : miniStart.get(dir) ?? ENDOFCHAIN;
    const size = dir.type === DIR_ROOT ? miniData.length : dir.content.length;

    const chunk: Uint8Array[] = [
      name,
      new Uint8Array(2), // null terminator
      new Uint8Array(64 - nameSize),
      u16(nameSize > 2 ? nameSize : 0),
      Uint8Array.from([dir.type, dir.color]),
      u32(dir.left),
      u32(dir.right),
      u32(dir.child),
      new Uint8Array(16), // CLSID
      u32(0), // state bits
      u64(stamp),
      u64(stamp),
      u32(startSector),
      u64(size),
    ];

    const offset = sectorOffset(directoryEntryPos) + index * 128;
    let written = 0;
    for (const part of chunk) {
      buffer.set(part, offset + written);
      written += part.length;
    }
    if (written !== 128) throw new Error(`CFB directory entry is ${written} bytes, expected 128`);
  }

  buffer.set(miniData, sectorOffset(miniFatDataPos));
  if (encryptedPackage.length > 0) buffer.set(encryptedPackage, sectorOffset(packagePos));

  return buffer;
}

export const CFB_DIR_EMPTY = DIR_EMPTY;
export { SECTOR_SIZE, MINI_STREAM_CUTOFF };
