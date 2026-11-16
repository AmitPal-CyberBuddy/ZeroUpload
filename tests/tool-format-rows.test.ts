import { describe, expect, it } from 'vitest';
import { toolFormatRows } from '../src/lib/capabilities/table';
import { TOOLS } from '../src/registry/tools';

/**
 * The format rows in a tool's header.
 *
 * `ToolLayout` derives those rows from the capability table. The first version
 * rendered one row per edge, and the inspector is listed against all nine
 * families with no formats on any of them — "any file" is not a list — so its own
 * page carried nine empty "Inspect" rows above the drop zone. Nothing in the
 * markup was invalid, which is why the DOM-shaped tests and the type checker were
 * all happy; it was obvious the moment the page was rendered.
 *
 * These assert the behaviour of the function that produces the rows.
 */

describe('tool header format rows', () => {
  it('gives a catch-all tool no rows at all', () => {
    expect(toolFormatRows('file-inspector')).toEqual([]);
    expect(toolFormatRows('create-zip')).toEqual([]);
  });

  it('gives a converter the formats it actually reads and writes', () => {
    const rows = toolFormatRows('image-converter');
    expect(rows).toHaveLength(1);
    expect(rows[0].capability).toBe('Convert');
    expect(rows[0].from).toEqual(expect.arrayContaining(['JPG', 'PNG', 'WEBP', 'AVIF']));
    expect(rows[0].to).toEqual(expect.arrayContaining(['JPG', 'PNG', 'WEBP']));
  });

  it('never emits a row that names no format', () => {
    for (const tool of TOOLS) {
      for (const row of toolFormatRows(tool.slug)) {
        expect(
          row.from.length + row.to.length,
          `${tool.slug} produced an empty "${row.capability}" row`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('lists each capability once per tool, with the formats merged', () => {
    for (const tool of TOOLS) {
      const names = toolFormatRows(tool.slug).map((row) => row.capability);
      expect(new Set(names).size, `${tool.slug} repeats a capability`).toBe(names.length);
    }
  });

  it('covers enough tools to be worth having', () => {
    const withRows = TOOLS.filter((tool) => toolFormatRows(tool.slug).length > 0);
    expect(withRows.length).toBeGreaterThan(5);
  });
});
