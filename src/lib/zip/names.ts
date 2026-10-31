/**
 * Entry-name rules, in one place.
 *
 * `create.ts` (which also runs inside the worker) and `zip.ts` (extraction) must
 * agree on what a safe name is; two copies of a sanitiser is exactly how a
 * traversal bug gets reintroduced. This module is tiny and dependency-free, so it
 * can be imported from the eager path without pulling fflate anywhere.
 */

/** Makes an arbitrary label safe to use as a ZIP entry name. */
export function sanitizeEntryName(name: string): string {
  return (
    name
      .replace(/\\/g, '/')
      .split('/')
      .filter((segment) => segment && segment !== '.' && segment !== '..')
      .join('/')
      // Strip a Windows drive prefix ("C:") — invalid on Windows, pointless in a
      // download name.
      .replace(/^[A-Za-z]:\/?/, '')
      .replace(/^\/+/, '')
  );
}

/**
 * Resolves a collision by appending " (1)", " (2)" … before the extension. A
 * second entry with the same name would otherwise silently overwrite the first
 * when the archive is opened.
 */
export function uniqueEntryName(name: string, used: Map<string, number>): string {
  const count = used.get(name) ?? 0;
  used.set(name, count + 1);
  if (count === 0) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
}
