import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, TOOLS, TOOL_MAP, TOOLS_BY_CATEGORY, getTool, getToolAny } from '../src/registry/tools';
import { TOOL_COMPONENTS } from '../src/registry/toolComponents';
import { CATEGORIES } from '../src/registry/categories';
import { OFFICE_ENCRYPTION_ENABLED } from '../src/lib/office/features';
import { OPERATION_BUDGETS } from '../src/lib/files/budget';
import { CAPABILITY_HUBS, ENABLED_HUBS, isHubId } from '../src/registry/groups';
import { CAPABILITY_TABLE, CAPABILITIES } from '../src/lib/capabilities/table';
import { FORMATS, type FileFamily } from '../src/lib/capabilities/formats';
import { JOB_GROUPS, jobForTool, jobsForCategory } from '../src/registry/jobs';
import { TOOL_SEARCH_ENTRIES } from '../src/lib/search/entries';

/**
 * The registry is the extension point, so the invariants it must hold are worth
 * asserting: a tool without a component renders a dead route, a duplicated slug
 * silently shadows one of the two, and a flag that fails open would ship an
 * unverified encryption writer.
 */
describe('tool registry', () => {
  it('has a component for every tool', () => {
    const missing = TOOLS.filter((tool) => !TOOL_COMPONENTS[tool.slug]).map((tool) => tool.slug);
    expect(missing).toEqual([]);
  });

  it('has no duplicate slugs', () => {
    const slugs = TOOLS.map((tool) => tool.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('assigns every tool to a real category, and leaves no category empty', () => {
    for (const tool of TOOLS) {
      expect(CATEGORIES.map((category) => category.id)).toContain(tool.category);
    }
    for (const category of CATEGORIES) {
      expect(TOOLS_BY_CATEGORY[category.id]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('keeps the protection and inspection tools reachable', () => {
    for (const slug of ['protect-pdf', 'unlock-pdf', 'unlock-office', 'create-zip', 'extract-zip']) {
      expect(getTool(slug), slug).toBeDefined();
    }
  });

  it('hides Office encryption unless the interoperability flag is set', () => {
    if (OFFICE_ENCRYPTION_ENABLED) {
      expect(getTool('encrypt-office')).toBeDefined();
    } else {
      // Not merely "disabled": there is no route, no catalogue entry, no palette
      // entry. A tool that exists but refuses to work is worse than an absent one.
      expect(getTool('encrypt-office')).toBeUndefined();
      expect(TOOLS.some((tool) => tool.slug === 'encrypt-office')).toBe(false);
      expect(TOOL_MAP['encrypt-office']).toBeUndefined();
    }
  });

  it('can still describe a hidden tool to its own component', () => {
    // The components for flagged tools are compiled in even when routing hides
    // the route. `getToolAny` is what they read, so their shell renders either
    // way; `getTool` remains the routing answer and stays undefined. Reading
    // `getTool(...)!` in a component instead turned a hidden tool into a null
    // dereference the moment anything mounted it outside the router.
    for (const tool of ALL_TOOLS) {
      expect(getToolAny(tool.slug), tool.slug).toBeDefined();
    }
    if (!OFFICE_ENCRYPTION_ENABLED) {
      expect(getToolAny('encrypt-office')).toBeDefined();
      expect(getTool('encrypt-office')).toBeUndefined();
    }
  });

  it('budgets encrypted archives below plain ones, because the writer costs ~3.8x', () => {
    const plain = OPERATION_BUDGETS.zipCreate;
    const encrypted = OPERATION_BUDGETS.zipCreateEncrypted;
    expect(encrypted.maxBytes).toBeLessThan(plain.maxBytes);
    expect(encrypted.maxItems).toBeLessThan(plain.maxItems ?? Number.POSITIVE_INFINITY);
  });

  /*
   * The capability layer is data, and data drifts. Every edge is asserted against
   * the registry rather than trusted: a capability that names a tool which does
   * not exist would render an action that 404s, and a format id that is not in
   * FORMATS would print "undefined" in a chip.
   */
  it('only names tools that exist in every capability edge', () => {
    const missing: string[] = [];
    for (const [family, edges] of Object.entries(CAPABILITY_TABLE)) {
      for (const edge of edges) {
        if (!getToolAny(edge.tool)) missing.push(`${family}.${edge.capability} -> ${edge.tool}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('only names formats that exist in every capability edge', () => {
    const unknown: string[] = [];
    for (const [family, edges] of Object.entries(CAPABILITY_TABLE)) {
      for (const edge of edges) {
        for (const format of [...(edge.accepts ?? []), ...(edge.produces ?? [])]) {
          if (!FORMATS[format]) unknown.push(`${family}.${edge.capability} -> ${format}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it('keeps hub ids, category ids and tool slugs in separate namespaces', () => {
    /*
     * All three live under `/tools/<segment>/`. A hub that shares a name with a
     * tool would be unreachable — the router checks hubs first — and nothing else
     * would fail, which is the worst kind of collision.
     */
    for (const hub of CAPABILITY_HUBS) {
      expect(getToolAny(hub.id), `hub "${hub.id}" shadows a tool slug`).toBeUndefined();
      expect(CATEGORIES.some((category) => category.id === hub.id), `hub "${hub.id}" shadows a category`).toBe(
        false,
      );
      expect(hub.id, `hub "${hub.id}" would collide with the workspace route`).not.toBe('workspace');
    }
  });

  it('gives every enabled hub at least two tools and a real format list', () => {
    // A "capability" with one tool is a tool page with extra steps; the whole
    // point is that it spans the format families the old catalogue split apart.
    expect(ENABLED_HUBS.length).toBeGreaterThan(0);
    for (const hub of ENABLED_HUBS) {
      expect(hub.tools.length, `${hub.id} has one tool`).toBeGreaterThan(1);
      expect(hub.formats.length, `${hub.id} lists no formats`).toBeGreaterThan(1);
      for (const format of hub.formats) expect(FORMATS[format], `${hub.id} -> ${format}`).toBeDefined();
      for (const slug of hub.tools) expect(getTool(slug), `${hub.id} -> ${slug}`).toBeDefined();
    }
  });

  it('presents the duplicate jobs as one capability', () => {
    // The specific complaint: "Unlock PDF" and "Unlock Office" were two entries
    // for one task, with no visible relationship.
    const unlock = CAPABILITY_HUBS.find((hub) => hub.id === 'unlock');
    expect(unlock).toBeDefined();
    expect(unlock!.tools).toEqual(expect.arrayContaining(['unlock-pdf', 'unlock-office']));

    // And it is searchable as a capability, not only as two tools.
    expect(isHubId('unlock')).toBe(true);
  });

  it('puts every live tool in exactly one job', () => {
    /*
     * The catalogue's primary grouping is the job, so the two failure modes are
     * both visible on `/tools/`: a tool in two jobs renders twice, and a tool in
     * none is missing from the page that claims to list everything. Neither is
     * caught by the type checker, so it is caught here.
     */
    const counted = new Map<string, string[]>();
    for (const job of JOB_GROUPS) {
      for (const slug of job.tools) {
        counted.set(slug, [...(counted.get(slug) ?? []), job.id]);
        expect(getTool(slug), `${job.id} names a tool that does not exist: ${slug}`).toBeDefined();
      }
    }

    const doubled = [...counted.entries()].filter(([, jobs]) => jobs.length > 1);
    expect(doubled, 'tools listed under more than one job').toEqual([]);

    const missing = TOOLS.filter((tool) => !counted.has(tool.slug)).map((tool) => tool.slug);
    expect(missing, 'tools with no job, invisible in the catalogue').toEqual([]);
  });

  it('does not call a job a route unless the route exists', () => {
    // `jobHref` sends a job with a `hub` to `/tools/<id>/` and everything else to
    // `?job=<id>`. A job that claims a hub the router does not serve is a 404 in
    // the middle of the catalogue.
    for (const job of JOB_GROUPS) {
      if (!job.hub) {
        expect(isHubId(job.id), `${job.id} has no hub but would resolve to one`).toBe(false);
        continue;
      }
      expect(isHubId(job.id), `${job.id} claims a hub page that is not enabled`).toBe(true);
      // The job's tools must be the hub's tools, or the chip count on `/tools/`
      // would disagree with the page it links to.
      const hub = CAPABILITY_HUBS.find((entry) => entry.id === job.id);
      expect(hub?.tools, `${job.id} lists different tools from its hub page`).toEqual(job.tools);
    }
  });

  it('keeps the job ids out of the routing namespaces', () => {
    // A job id becomes `?job=<id>`, so it could collide with a route segment and
    // make `/tools/?job=pdf` look like it means the PDF page.
    for (const job of JOB_GROUPS) {
      expect(getToolAny(job.id), `job "${job.id}" shadows a tool slug`).toBeUndefined();
    }
    for (const category of CATEGORIES) {
      expect(
        JOB_GROUPS.some((job) => job.id === category.id),
        `job "${category.id}" collides with the category page of the same name`,
      ).toBe(false);
    }
  });

  it('derives the job of a tool the same way the catalogue does', () => {
    for (const tool of TOOLS) {
      const job = jobForTool(tool.slug);
      expect(job, tool.slug).toBeDefined();
      expect(job!.tools).toContain(tool.slug);
    }
    // A file-type page lists only the jobs its own tools belong to.
    const pdfJobs = jobsForCategory(TOOLS_BY_CATEGORY.pdf.map((tool) => tool.slug));
    expect(pdfJobs.map((job) => job.id)).toEqual(expect.arrayContaining(['lock', 'unlock', 'pages']));
    expect(pdfJobs.map((job) => job.id)).not.toContain('unpack');
  });

  it('labels every search entry with its job, not its file type', () => {
    /*
     * Both search surfaces read this list. If the label drifts back to the format
     * family, the palette and the catalogue describe the same tool two ways — the
     * inconsistency this workstream set out to remove.
     */
    expect(TOOL_SEARCH_ENTRIES).toHaveLength(TOOLS.length);
    for (const entry of TOOL_SEARCH_ENTRIES) {
      expect(entry.categoryName, entry.slug).toBe(jobForTool(entry.slug)!.name);
    }
  });

  it('gives every capability a name and a verb', () => {
    for (const [id, capability] of Object.entries(CAPABILITIES)) {
      expect(capability.id, id).toBe(id);
      expect(capability.name.length, id).toBeGreaterThan(2);
      expect(capability.verb.length, id).toBeGreaterThan(2);
    }
  });

  it('assigns a capability to each supported family, and never to an unknown one silently', () => {
    const families: FileFamily[] = ['image', 'pdf', 'archive', 'spreadsheet', 'office', 'text'];
    for (const family of families) {
      expect(CAPABILITY_TABLE[family].length, family).toBeGreaterThan(0);
    }
    // `unknown` and the media families must still say *something* — "inspect" is
    // the honest answer for a file nothing else understands.
    for (const family of ['video', 'audio', 'unknown'] as FileFamily[]) {
      expect(CAPABILITY_TABLE[family].some((edge) => edge.capability === 'inspect')).toBe(true);
    }
  });
});
