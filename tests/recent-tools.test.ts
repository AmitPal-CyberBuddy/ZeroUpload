import { describe, expect, it } from 'vitest';
import {
  RECENT_KEY,
  RECENT_LIMIT,
  clearRecent,
  readRecent,
  recordRecent,
  type KeyValueStore,
} from '../src/lib/recent/recentTools';

/**
 * The recent-tools store, tested against a fake rather than a browser.
 *
 * The module's whole job is surviving bad state, so most of these cases are
 * things that only happen to real users: a privacy mode that throws on write, a
 * value another version of the site wrote, a tool slug that no longer exists.
 */

const KNOWN = ['merge-pdf', 'split-pdf', 'base64', 'hash-generator', 'crop'];

/** A store that behaves like `localStorage`, with an optional failure mode. */
function fakeStore(options: { failRead?: boolean; failWrite?: boolean; failRemove?: boolean } = {}) {
  const data = new Map<string, string>();
  const store: KeyValueStore = {
    getItem(key) {
      if (options.failRead) throw new Error('SecurityError');
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (options.failWrite) throw new Error('QuotaExceededError');
      data.set(key, value);
    },
    removeItem(key) {
      if (options.failRemove) throw new Error('SecurityError');
      data.delete(key);
    },
  };
  return { store, data };
}

describe('reading recent tools', () => {
  it('returns nothing when nothing was recorded', () => {
    expect(readRecent(fakeStore().store, KNOWN)).toEqual([]);
  });

  it('returns nothing from a missing store', () => {
    expect(readRecent(null, KNOWN)).toEqual([]);
    expect(readRecent(undefined, KNOWN)).toEqual([]);
  });

  it('preserves the recorded order', () => {
    const { store } = fakeStore();
    recordRecent(store, 'base64', KNOWN);
    recordRecent(store, 'crop', KNOWN);
    expect(readRecent(store, KNOWN)).toEqual(['crop', 'base64']);
  });

  it('drops slugs the catalogue no longer has', () => {
    const { store, data } = fakeStore();
    data.set(RECENT_KEY, JSON.stringify(['retired-tool', 'behaves-normally', 'crop']));
    expect(readRecent(store, KNOWN)).toEqual(['crop']);
  });

  it('survives a value that is not JSON, not an array, or the wrong shape', () => {
    const cases = ['not json at all', '{"a":1}', 'null', '"crop"', '[1,2,3]', '[{"slug":"crop"}]'];
    for (const value of cases) {
      const { store, data } = fakeStore();
      data.set(RECENT_KEY, value);
      expect(readRecent(store, KNOWN), `bad value ${value}`).toEqual([]);
    }
  });

  it('de-duplicates and caps a list written by another version', () => {
    const { store, data } = fakeStore();
    data.set(RECENT_KEY, JSON.stringify(['crop', 'crop', 'base64', ...KNOWN, 'split-pdf']));
    const result = readRecent(store, KNOWN);
    expect(result.length).toBe(RECENT_LIMIT);
    expect(new Set(result).size).toBe(result.length);
    expect(result.slice(0, 2)).toEqual(['crop', 'base64']);
  });

  it('ignores a store that throws on read', () => {
    expect(readRecent(fakeStore({ failRead: true }).store, KNOWN)).toEqual([]);
  });
});

describe('recording a visit', () => {
  it('moves an existing tool to the front instead of duplicating it', () => {
    const { store } = fakeStore();
    recordRecent(store, 'crop', KNOWN);
    recordRecent(store, 'base64', KNOWN);
    expect(recordRecent(store, 'crop', KNOWN)).toEqual(['crop', 'base64']);
    expect(readRecent(store, KNOWN)).toEqual(['crop', 'base64']);
  });

  it('keeps the newest four and forgets the rest', () => {
    const { store } = fakeStore();
    for (const slug of KNOWN) recordRecent(store, slug, KNOWN);
    const stored = readRecent(store, KNOWN);
    expect(stored).toEqual(['crop', 'hash-generator', 'base64', 'split-pdf']);
  });

  it('returns the new order even when the write fails', () => {
    // A read-only store is a real case (Safari private mode). The visit still
    // counts for this session; it simply does not survive a reload.
    const { store } = fakeStore({ failWrite: true });
    expect(recordRecent(store, 'crop', KNOWN)).toEqual(['crop']);
    expect(readRecent(store, KNOWN)).toEqual([]);
  });

  it('does not throw without a store', () => {
    expect(recordRecent(null, 'crop', KNOWN)).toEqual(['crop']);
  });

  it('stores slugs only — never anything about the file', () => {
    const { store, data } = fakeStore();
    recordRecent(store, 'merge-pdf', KNOWN);
    const raw = data.get(RECENT_KEY);
    expect(raw).toBeTypeOf('string');
    expect(JSON.parse(raw as string)).toEqual(['merge-pdf']);
  });
});

describe('clearing', () => {
  it('empties the list', () => {
    const { store } = fakeStore();
    recordRecent(store, 'crop', KNOWN);
    clearRecent(store);
    expect(readRecent(store, KNOWN)).toEqual([]);
  });

  it('does not throw when the store refuses or is missing', () => {
    expect(() => clearRecent(fakeStore({ failRemove: true }).store)).not.toThrow();
    expect(() => clearRecent(null)).not.toThrow();
  });
});
