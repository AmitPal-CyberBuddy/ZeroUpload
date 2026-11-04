/**
 * One search model for both surfaces.
 *
 * The command palette and the catalogue filter used to score queries
 * differently, so the same words gave two different answers. This module is the
 * single scorer: pure, framework-free, and unit-tested against the queries
 * people actually type.
 *
 * Ranking is intentionally coarse — a handful of buckets rather than points
 * invented per match — because a stable order matters more than a clever one:
 *
 *   1000  the tool name is the query
 *    900  the name starts with the query
 *    800  the name contains the query
 *    700  a keyword or alias is the query
 *    650  a keyword or alias starts with the query
 *    600  a keyword or alias contains the query
 *    500  every query word appears somewhere (name, terms, blurb, group)
 *    300  a word is one typo away from a name word or term
 *    100  the query is a subsequence of the name (fuzzy fallback)
 *
 * Ties fall back to the order the registry declares, so results never reshuffle
 * between keystrokes for no reason.
 */

export interface Searchable {
  slug: string;
  name: string;
  blurb: string;
  /** Display name of the group this entry belongs to. */
  categoryName: string;
  tags?: string[];
  keywords?: string[];
  aliases?: string[];
}

export interface SearchHit<T extends Searchable> {
  item: T;
  score: number;
}

/** Every phrase an entry can legitimately be found by. */
function termsOf(item: Searchable): string[] {
  return [...(item.keywords ?? []), ...(item.aliases ?? []), ...(item.tags ?? [])].map((term) =>
    term.toLowerCase(),
  );
}

function haystack(item: Searchable): string {
  return [item.name, item.blurb, item.categoryName, ...(item.keywords ?? []), ...(item.aliases ?? []), ...(item.tags ?? [])]
    .join(' ')
    .toLowerCase();
}

/** Levenshtein distance, abandoned above `max` so it stays cheap on long words. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

/** True when every character of `needle` appears in `haystack`, in order. */
export function isSubsequence(needle: string, haystackText: string): boolean {
  let index = 0;
  for (const char of haystackText) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

/**
 * Filler people type when they describe a task rather than a feature. Dropped
 * before matching so "make my photo smaller" is compared on "photo smaller",
 * not on six words where four match nothing.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'my', 'me', 'i', 'to', 'of', 'for', 'in', 'on', 'with', 'and', 'or',
  'how', 'do', 'can', 'is', 'be', 'it', 'make', 'get', 'want', 'need', 'please',
  'file', 'files', 'tool', 'tools', 'online', 'free', 'best', 'app', 'site', 'website',
]);

/** Content words of a query, falling back to the raw words if it is all filler. */
function contentWords(query: string): string[] {
  const words = query.split(/\s+/).filter(Boolean);
  const kept = words.filter((word) => !STOP_WORDS.has(word));
  return kept.length > 0 ? kept : words;
}

/** Words long enough that a typo is plausible; short words are matched exactly. */
const MIN_FUZZY_WORD = 4;

export function scoreEntry(item: Searchable, rawQuery: string): number {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return 1;

  const name = item.name.toLowerCase();
  const terms = termsOf(item);

  if (name === query) return 1000;
  if (name.startsWith(query)) return 900;
  if (name.includes(query)) return 800;

  for (const term of terms) {
    if (term === query) return 700;
  }
  for (const term of terms) {
    if (term.startsWith(query)) return 650;
  }
  for (const term of terms) {
    if (term.includes(query)) return 600;
  }

  const words = contentWords(query);
  const pool = haystack(item);
  if (words.every((word) => pool.includes(word))) {
    // Whole-word matches beat incidental substrings, so "pdf password" puts the
    // tool that *is* a PDF password tool first.
    const wholeWords = words.filter((word) => new RegExp(`\\b${escapeRegExp(word)}`).test(pool)).length;
    return 500 + Math.round((wholeWords / words.length) * 60);
  }

  // One typo away, word by word — but only when *every* content word is either
  // present or one edit away, or a single stray word would match half the site.
  const candidates = [...name.split(/\s+/), ...terms.flatMap((term) => term.split(/\s+/))];
  const typo = words.every(
    (word) =>
      pool.includes(word) ||
      (word.length >= MIN_FUZZY_WORD &&
        candidates.some(
          (candidate) => candidate.length >= MIN_FUZZY_WORD && editDistance(word, candidate, 1) <= 1,
        )),
  );
  if (typo) return 300;

  if (isSubsequence(query, name)) return 100;
  return 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ranked results. An empty query returns everything in registry order, which is
 * what both surfaces want to show before anything is typed.
 */
export function searchEntries<T extends Searchable>(items: readonly T[], query: string): SearchHit<T>[] {
  return items
    .map((item, index) => ({ item, index, score: scoreEntry(item, query) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item, score }) => ({ item, score }));
}

/**
 * Recovery for a query that matched nothing: the closest entries by *partial*
 * signal, so an empty palette suggests a next step instead of dead-ending.
 */
export function nearestEntries<T extends Searchable>(items: readonly T[], query: string, limit = 3): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items.slice(0, limit);

  const scored = items
    .map((item, index) => {
      const pool = haystack(item);
      const hits = words.filter((word) => word.length > 2 && pool.includes(word.slice(0, 3))).length;
      return { item, index, hits };
    })
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.index - b.index)
    .map((entry) => entry.item);

  return scored.slice(0, limit);
}
