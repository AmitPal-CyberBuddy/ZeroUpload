/**
 * Interoperability flags.
 *
 * Office *encryption* is complete and spec-conformant, but "conformant" is not
 * the same claim as "opens in Word". Until the output has been round-tripped
 * through real Word, Excel and PowerPoint installations, the tool is compiled
 * in but switched off: `VITE_ENABLE_OFFICE_ENCRYPTION=1` turns it on for a
 * build, and the default build ships without it.
 *
 * Deliberately a build-time constant rather than a runtime toggle: a flipped
 * localStorage key would let an unverified writer loose on someone's only copy
 * of a document.
 */
const RAW = (import.meta.env.VITE_ENABLE_OFFICE_ENCRYPTION ?? '') as string;

/** True only when the build explicitly opted in. */
export const OFFICE_ENCRYPTION_ENABLED = RAW === '1' || RAW === 'true';
