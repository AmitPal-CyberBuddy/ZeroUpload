/**
 * In-memory handoff between screens (e.g. homepage drop zone → inspector).
 *
 * Files are held in a module-level slot only — never in storage, never sent
 * anywhere — and the slot is consumed and cleared on the next mount.
 */
let pending: { files: File[]; target: string } | null = null;

export function setHandoff(files: File[], target: string): void {
  pending = { files, target };
}

export function takeHandoff(target: string): File[] {
  if (!pending || pending.target !== target) return [];
  const files = pending.files;
  pending = null;
  return files;
}

/** Drop abandoned handoffs on a different route, never revive them later. */
export function discardHandoffExcept(pathname: string): void {
  if (pending && pathname.replace(/\/+$/, '') !== `/tools/${pending.target}`) pending = null;
}
