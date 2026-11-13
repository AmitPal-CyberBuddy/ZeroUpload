/**
 * The one constant that decides how much of an archive has to be read to answer
 * "is this encrypted?".
 *
 * The end-of-central-directory record is guaranteed to be inside the last
 * 65,557 bytes: a 22-byte fixed record plus a comment field bounded to 65,535.
 * `inspectZipEncryption` already scans only that window, so reading the whole
 * file to hand it the bytes did the work twice — once in the read, once in the
 * scan — on exactly the path (large, encrypted) where memory is tightest.
 */
export const ZIP_TAIL_BYTES = 65_557;

/**
 * Reads only the tail of an archive, positioned so that a scan working back from
 * the end of the returned buffer lands where it would in the whole file.
 *
 * Returns the tail *and* how many bytes were skipped, because a caller that
 * reports a file offset needs the bias; `inspectZipEncryption` does not.
 */
export async function readZipTail(file: Blob): Promise<Uint8Array> {
  const start = Math.max(0, file.size - ZIP_TAIL_BYTES);
  return new Uint8Array(await file.slice(start).arrayBuffer());
}
