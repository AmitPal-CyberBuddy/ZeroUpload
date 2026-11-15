/**
 * The entries the catalogue and the command palette both search.
 *
 * They used to build their own lists from the same registry, which was fine
 * until the taxonomy changed: the palette labelled each result with its *format
 * family* while the catalogue was beginning to group by job, so typing "unlock"
 * and then looking at the catalogue gave two different pictures of the same
 * product. One list, built once, means the group label on a palette row is the
 * heading the same tool sits under on `/tools/`.
 *
 * `Searchable` is unchanged — this only decides what each field *is*:
 *
 *  - `categoryName` is the job ("Unlock"), because that is the group the visitor
 *    is being shown;
 *  - the format family ("Archives & Office") is a keyword instead, so searching
 *    "office" or "images" still finds the tools it used to find, one rank lower
 *    than a job name match.
 */
import { CATEGORY_MAP } from '../../registry/categories';
import { jobForTool, type JobGroup } from '../../registry/jobs';
import { TOOLS, type ToolDefinition } from '../../registry/tools';
import type { Searchable } from './search';

export interface ToolSearchEntry extends Searchable {
  /** The registry row, so a surface can render the card without another lookup. */
  tool: ToolDefinition;
  /** The job it is presented under. Every live tool has one. */
  job: JobGroup | undefined;
}

export const TOOL_SEARCH_ENTRIES: ToolSearchEntry[] = TOOLS.map((tool) => {
  const job = jobForTool(tool.slug);
  const family = CATEGORY_MAP[tool.category];
  return {
    tool,
    job,
    slug: tool.slug,
    name: tool.name,
    blurb: tool.blurb,
    categoryName: job?.name ?? family.name,
    // The family name and its guide phrasing stay searchable even though the
    // catalogue no longer presents them as the primary grouping.
    tags: tool.tags,
    keywords: [...(tool.keywords ?? []), family.name.toLowerCase(), `${family.name.toLowerCase()} tools`],
    aliases: tool.aliases,
  };
});
