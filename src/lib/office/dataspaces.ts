/**
 * The four fixed DataSpaces streams an encrypted OOXML container carries.
 *
 * They are constant byte strings ([MS-OFFCRYPTO] §2.3.4.5 / the "DataSpaces"
 * storage Office writes), copied here base64-encoded so they survive review as
 * data rather than as 300 lines of escaped hex. Office refuses an encrypted
 * package whose DataSpaces do not describe "StrongEncryptionTransform", so these
 * are not optional decoration.
 */
const decode = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
};

const Version_B64 =
  'PAAAAE0AaQBjAHIAbwBzAG8AZgB0AC4AQwBvAG4AdABhAGkAbgBlAHIALgBEAGEAdABhAFMAcABhAGMAZQBzAAEAAAABAAAAAQAAAA==';

const DataSpaceMap_B64 =
  'CAAAAAEAAABoAAAAAQAAAAAAAAAgAAAARQBuAGMAcgB5AHAAdABlAGQAUABhAGMAawBhAGcAZQAyAAAAUwB0AHIAbwBuAGcARQBuAGMAcgB5AHAAdABpAG8AbgBEAGEAdABhAFMAcABhAGMAZQAAAA==';

const StrongEncryptionDataSpace_B64 =
  'CAAAAAEAAAAyAAAAUwB0AHIAbwBuAGcARQBuAGMAcgB5AHAAdABpAG8AbgBUAHIAYQBuAHMAZgBvAHIAbQAAAA==';

const Primary_B64 =
  'WAAAAAEAAABMAAAAewBGAEYAOQBBADMARgAwADMALQA1ADYARQBGAC0ANAA2ADEAMwAtAEIARABEADUALQA1AEEANAAxAEMAMQBEADAANwAyADQANgB9AE4AAABNAGkAYwByAG8AcwBvAGYAdAAuAEMAbwBuAHQAYQBpAG4AZQByAC4ARQBuAGMAcgB5AHAAdABpAG8AbgBUAHIAYQBuAHMAZgBvAHIAbQAAAAEAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAQAAAA=';

export const DATASPACES = {
  version: decode(Version_B64),
  dataSpaceMap: decode(DataSpaceMap_B64),
  strongEncryptionDataSpace: decode(StrongEncryptionDataSpace_B64),
  primary: decode(Primary_B64),
} as const;
