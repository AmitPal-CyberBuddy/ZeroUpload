/**
 * Recently opened tools, remembered on this device and nowhere else.
 *
 * The store holds tool *slugs* — `merge-pdf`, `base64` — and nothing else. No
 * filenames, no counts, no timestamps: a file utility that remembered which
 * documents you opened would undo the one promise the site makes, so the shape of
 * the record is part of the design rather than an implementation detail.
 *
 * Everything here is defensive because the storage it talks to is not ours to
 * trust. `localStorage` throws on read and write in some privacy modes, the value
 * can be anything a previous version or another script left behind, and a slug
 * can outlive the tool it names. Every one of those cases degrades to "no
 * recents", never to a broken palette.
 */

/** Storage-shaped interface, so tests can use a plain object. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const RECENT_KEY = 'zeroupload.recent-tools';

/** Four is enough to cover "where was I" without turning the palette into history. */
export const RECENT_LIMIT = 4;

/**
 * The browser's `localStorage`, or null where touching it throws.
 *
 * The property access itself throws in Safari's private mode on older versions,
 * which is why this is wrapped rather than reading `window.localStorage` at the
 * call site.
 */
export function browserStore(): KeyValueStore | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Stored slugs that still name a tool, most recent first.
 *
 * `known` is passed in rather than imported so this module stays free of the
 * registry and testable without it — and so a slug that was renamed or removed
 * between visits is dropped instead of producing a dead link.
 */
export function readRecent(store: KeyValueStore | null | undefined, known: readonly string[]): string[] {
  if (!store) return [];
  const valid = new Set(known);

  let parsed: unknown;
  try {
    const raw = store.getItem(RECENT_KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of parsed) {
    if (typeof value !== 'string' || !valid.has(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length === RECENT_LIMIT) break;
  }
  return result;
}

/**
 * Moves `slug` to the front of the list and returns the new order.
 *
 * Returns the list even when writing fails, so the palette can show what the
 * visitor just did in this session; the next visit simply starts without it.
 */
export function recordRecent(
  store: KeyValueStore | null | undefined,
  slug: string,
  known: readonly string[],
): string[] {
  const next = [slug, ...readRecent(store, known).filter((entry) => entry !== slug)].slice(0, RECENT_LIMIT);
  if (!store) return next;
  try {
    store.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage full or read-only: the session still works, the next one forgets.
  }
  return next;
}

export function clearRecent(store: KeyValueStore | null | undefined): void {
  if (!store) return;
  try {
    store.removeItem(RECENT_KEY);
  } catch {
    // Nothing to recover from: an unreadable entry is ignored on read anyway.
  }
}
