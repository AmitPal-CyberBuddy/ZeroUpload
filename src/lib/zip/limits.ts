/**
 * The extraction budget, in one place.
 *
 * These numbers used to live in `zip.ts`, which meant every module that needed
 * to talk about a limit — the encrypted reader, the extraction routine, the
 * worker protocol — had to import the module that also owns the public API. Split
 * out so `read.ts`, `encrypted.ts` and `protocol.ts` can depend on the numbers
 * without a cycle, and so `zip.ts` stays the only public surface.
 */

export interface ZipLimits {
  maxEntries: number;
  /** Total uncompressed budget for the whole archive. */
  maxTotalBytes: number;
  maxEntryBytes: number;
}

/**
 * Absolute ceilings, not heuristics.
 *
 * There is deliberately no compression-ratio test: real archives of text, logs
 * or JSON legitimately compress 300–500×, and refusing them is worse than the
 * protection the test pretends to offer. These numbers are deterministic, and
 * they are enforced against the *declared* sizes before anything is inflated.
 */
export const DEFAULT_LIMITS: ZipLimits = {
  maxEntries: 5_000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxEntryBytes: 256 * 1024 * 1024,
};

/** Standard copy for a run the user stopped. */
export const CANCELLED_ERROR = {
  code: 'cancelled' as const,
  message: 'Reading this archive was cancelled.',
  hint: 'Nothing was kept: the partial listing was discarded, and the file is untouched.',
};
