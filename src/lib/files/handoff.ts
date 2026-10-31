/**
 * In-memory handoff between screens (e.g. homepage drop zone → inspector).
 *
 * Files are held in a module-level slot only — never in storage, never sent
 * anywhere — and the slot is consumed and cleared on the next mount.
 */
let pending: File[] | null = null;

export function setHandoff(files: File[]): void {
  pending = files;
}

export function takeHandoff(): File[] {
  const files = pending ?? [];
  pending = null;
  return files;
}

export function peekHandoff(): File[] {
  return pending ?? [];
}
