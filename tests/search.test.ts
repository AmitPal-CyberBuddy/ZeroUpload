import { describe, expect, it } from 'vitest';
import { CATEGORY_MAP } from '../src/registry/categories';
import { TOOLS } from '../src/registry/tools';
import { editDistance, isSubsequence, nearestEntries, scoreEntry, searchEntries } from '../src/lib/search/search';

/**
 * The queries below are the ones from the UX audit's search section — what a
 * person types, not what the registry happens to be called.
 */
const entries = TOOLS.map((tool) => ({
  slug: tool.slug,
  name: tool.name,
  blurb: tool.blurb,
  categoryName: CATEGORY_MAP[tool.category].name,
  tags: tool.tags,
  keywords: tool.keywords,
  aliases: tool.aliases,
}));

const top = (query: string, count = 3): string[] =>
  searchEntries(entries, query)
    .slice(0, count)
    .map((hit) => hit.item.slug);

describe('search: exact names win', () => {
  it('finds a tool by its own name first', () => {
    expect(top('image compressor')[0]).toBe('image-compressor');
    expect(top('merge pdf')[0]).toBe('merge-pdf');
    expect(top('json formatter')[0]).toBe('json-formatter');
    expect(top('base64')[0]).toBe('base64');
  });
});

describe('search: task phrasing', () => {
  it('maps "compress image" and "reduce jpg size" to the compressor', () => {
    expect(top('compress image')[0]).toBe('image-compressor');
    expect(top('reduce jpg size')[0]).toBe('image-compressor');
  });

  it('maps "make my photo smaller" to the compressor', () => {
    expect(top('make my photo smaller')[0]).toBe('image-compressor');
  });

  it('maps "resize image" to the resizer', () => {
    expect(top('resize image')[0]).toBe('resize');
  });

  it('maps password phrasing to protect and unlock', () => {
    expect(top('pdf password', 2)).toEqual(expect.arrayContaining(['protect-pdf', 'unlock-pdf']));
    expect(top('protect pdf', 2)).toContain('protect-pdf');
    expect(top('unlock pdf', 2)).toContain('unlock-pdf');
    expect(top('remove pdf password', 2)).toContain('unlock-pdf');
    expect(top('password protect pdf', 2)).toContain('protect-pdf');
  });

  it('maps archive phrasing to the archive tools', () => {
    expect(top('zip', 2)).toEqual(expect.arrayContaining(['create-zip', 'extract-zip']));
    expect(top('extract archive', 2)).toContain('extract-zip');
    expect(top('unzip file', 2)).toContain('extract-zip');
  });

  it('maps "hash file" to the tool that hashes files, not strings', () => {
    const hits = top('hash file', 2);
    expect(hits).toContain('file-inspector');
  });

  it('maps "split pdf" to the splitter', () => {
    expect(top('split pdf', 2)).toContain('split-pdf');
  });

  it('maps a group name to that group', () => {
    expect(top('developer tools', 4)).toEqual(
      expect.arrayContaining(['json-formatter', 'base64', 'url-encoder', 'hash-generator']),
    );
  });
});

describe('search: tolerance', () => {
  it('survives a one-letter typo', () => {
    expect(top('compresor')).toContain('image-compressor');
    expect(top('formater')[0]).toBe('json-formatter');
  });

  it('still matches by subsequence when characters are dropped', () => {
    expect(top('mgpdf', 3)).toContain('merge-pdf');
  });

  it('returns nothing rather than noise for unrelated text', () => {
    expect(searchEntries(entries, 'zzzzqqq')).toHaveLength(0);
  });
});

describe('search: ranking rules', () => {
  it('never puts a fuzzy match above an exact one', () => {
    const results = searchEntries(entries, 'rotate');
    expect(results[0].item.name.toLowerCase()).toMatch(/rotate/);
    for (let index = 1; index < results.length; index += 1) {
      expect(results[index - 1].score).toBeGreaterThanOrEqual(results[index].score);
    }
  });

  it('keeps registry order for ties, so results do not shuffle', () => {
    const first = searchEntries(entries, '').map((hit) => hit.item.slug);
    const second = searchEntries(entries, '').map((hit) => hit.item.slug);
    expect(first).toEqual(second);
    expect(first).toEqual(TOOLS.map((tool) => tool.slug));
  });

  it('scores an empty query as a pass-through', () => {
    expect(scoreEntry(entries[0], '')).toBe(1);
  });
});

describe('search: helpers', () => {
  it('measures edit distance with an early exit', () => {
    expect(editDistance('compressor', 'compresor')).toBe(1);
    expect(editDistance('pdf', 'pdf')).toBe(0);
    expect(editDistance('a', 'zzzzzz', 2)).toBeGreaterThan(2);
  });

  it('detects subsequences', () => {
    expect(isSubsequence('mgpdf', 'merge pdf')).toBe(true);
    expect(isSubsequence('zzz', 'merge pdf')).toBe(false);
    expect(isSubsequence('', 'anything')).toBe(true);
  });

  it('suggests something useful when nothing matches', () => {
    const suggestions = nearestEntries(entries, 'imag stuff').map((item) => item.slug);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions).toContain('image-compressor');
  });

  it('suggests nothing when the query shares no signal at all', () => {
    expect(nearestEntries(entries, 'zzzzqqq')).toHaveLength(0);
  });
});
