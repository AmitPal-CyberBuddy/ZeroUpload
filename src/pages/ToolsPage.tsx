import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CATEGORIES, CATEGORY_MAP } from '../registry/categories';
import { TOOLS } from '../registry/tools';
import { Icon } from '../components/ui/Icon';
import { ToolCard } from '../components/tool/ToolCard';
import { usePageMeta } from '../hooks/usePageMeta';
import { PAGE_META } from '../seo/pages';
import { nearestEntries, searchEntries } from '../lib/search/search';
import { TOOL_SEARCH_ENTRIES } from '../lib/search/entries';
import { JOB_GROUPS, JOB_MAP, isJobId, jobHref } from '../registry/jobs';

/**
 * The catalogue, laid out by the job you have.
 *
 * It used to be laid out by file format — Images, PDF, Archives & Office,
 * Inspection, Developer — with four capability chips in a thin strip above it.
 * That strip was the newer, better answer and it covered less than half the
 * tools, so the page still opened with the older structure and read as if the
 * grouping work had not happened here at all. Job is now the first axis and
 * covers all twenty-two tools; the format families are still real pages and still
 * reachable, from the card tags and the row at the end of the page.
 */
export function ToolsPage() {
  /*
   * `?q=` is how the palette hands over a query it could not finish showing, and
   * `?job=` is how a job chip narrows the page without a route of its own.
   *
   * Both are read from the URL and written back with `replace`, so a filtered
   * catalogue can be shared or reloaded, the back button is not filled with one
   * entry per keystroke, and the page never reopens filtered by something the
   * visitor has already cleared.
   */
  const [params, setParams] = useSearchParams();
  const queryParam = params.get('q') ?? '';
  const jobParam = params.get('job') ?? '';

  /*
   * The filter is applied after mount, not during the first render.
   *
   * `/tools/` is prerendered as the full catalogue and then hydrated. Reading
   * `?q=` and `?job=` on the very first pass made the client's first render
   * disagree with that HTML — React error #418 — and it also meant every visit to
   * `/tools/?q=zip` re-rendered the whole page from scratch on the first frame.
   * Empty on the first pass, then read from the URL once hydration is done: the
   * prerendered markup is adopted as-is and the filter arrives one paint later,
   * which is invisible and keeps the craft honest.
   */
  const [query, setQueryState] = useState('');
  const [activeJob, setActiveJob] = useState('');

  useEffect(() => {
    setQueryState(queryParam);
    setActiveJob(isJobId(jobParam) ? jobParam : '');
  }, [queryParam, jobParam]);

  /*
   * A filtered view is still one page. The canonical path never grows the query
   * string — eight `?job=` variants would otherwise be eight indexable duplicates
   * of the same catalogue — but the title does name the job, so a shared link
   * says "Compress tools" in the tab instead of the whole catalogue's name.
   */
  usePageMeta(
    activeJob ? { ...PAGE_META['/tools/?job='], title: `Tools: ${JOB_MAP[activeJob].name} · ZeroUpload` } : PAGE_META['/tools/'],
    '/tools/',
  );

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };
  /* The field is the source of truth while typing; the URL follows it. */
  const setQuery = (value: string) => {
    setQueryState(value);
    update({ q: value || null });
  };
  const setJob = (job: string) => {
    setActiveJob(isJobId(job) ? job : '');
    update({ job: job || null });
  };

  const filtered = useMemo(
    () => searchEntries(TOOL_SEARCH_ENTRIES, query).map((hit) => hit.item),
    [query],
  );

  /** Closest tools when a filter matches nothing, so the page is never a dead end. */
  const suggestions = useMemo(
    () =>
      filtered.length === 0 && query.trim() ? nearestEntries(TOOL_SEARCH_ENTRIES, query, 3) : [],
    [filtered.length, query],
  );

  /*
   * Sections are the jobs, in taxonomy order, each holding the tools that
   * survived the current search. Empty jobs drop out entirely rather than
   * leaving a heading with nothing under it.
   */
  const sections = useMemo(
    () =>
      JOB_GROUPS.filter((job) => !activeJob || job.id === activeJob)
        .map((job) => ({ job, tools: filtered.filter((entry) => entry.job?.id === job.id) }))
        .filter((section) => section.tools.length > 0),
    [activeJob, filtered],
  );

  const shown = sections.reduce((total, section) => total + section.tools.length, 0);
  const narrowing = Boolean(query.trim()) || Boolean(activeJob);

  return (
    <main id="main" className="page">
      <header className="catalog-head">
        <span className="eyebrow">Tool catalogue</span>
        <h1>Every tool, grouped by the job you have.</h1>
        <p>
          {TOOLS.length} tools for converting, compressing, protecting, reshaping, arranging and inspecting
          files. Each one opens straight into a workspace on your device — nothing is uploaded and no account
          is needed.
        </p>
      </header>

      <div className="catalog-controls">
        {/*
          * One field, and everything the visitor needs inside it: the icon says
          * what it is, the count says what happened, and the × says how to undo
          * it. The count is also the live region — it used to be duplicated, with
          * a decorative copy on screen and a hidden copy for screen readers, which
          * is two elements to keep in sync for one fact.
          */}
        <div className="catalog-search" data-filled={query.trim() ? 'true' : undefined}>
          <Icon name="search" size={15} />
          <input
            type="search"
            value={query}
            placeholder="Search by name, format or task…"
            aria-label="Filter tools"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                event.preventDefault();
                setQuery('');
              }
            }}
          />
          {query ? (
            <button
              type="button"
              className="catalog-search__clear"
              aria-label="Clear the search"
              onClick={() => setQuery('')}
            >
              <Icon name="x" size={12} />
            </button>
          ) : null}
          <span className="catalog-search__count mono catalog-count" role="status" aria-live="polite" aria-atomic="true">
            {narrowing ? `${shown} of ${TOOLS.length} tools` : `${TOOLS.length} tools`}
          </span>
        </div>

        {/*
          * Job chips filter this page rather than navigating: eight jobs with
          * two to five tools each do not need eight URLs, and a query parameter
          * keeps the strip one consistent control instead of mixing "filter
          * here" chips with "open a page" chips. The four jobs that *are* pages
          * are linked from their section heading below.
          */}
        <nav className="catalog-jobs" aria-label="Filter by job">
          <button
            type="button"
            className="catalog-job"
            aria-pressed={activeJob === ''}
            onClick={() => setJob('')}
          >
            All jobs
            <span className="mono">{TOOLS.length}</span>
          </button>
          {JOB_GROUPS.map((job) => (
            <button
              key={job.id}
              type="button"
              className="catalog-job"
              aria-pressed={activeJob === job.id}
              onClick={() => setJob(job.id)}
            >
              {job.name}
              <span className="mono">{job.tools.length}</span>
            </button>
          ))}
        </nav>
      </div>

      {sections.length === 0 ? (
        <div className="catalog-empty">
          <p>
            No tools match “{query}”
            {activeJob ? ` in ${JOB_GROUPS.find((job) => job.id === activeJob)?.name}` : ''}.
          </p>
          {suggestions.length > 0 ? (
            <>
              <span className="catalog-empty__label">Closest tools</span>
              <div className="catalog-empty__links">
                {suggestions.map((entry) => (
                  <Link key={entry.slug} to={`/tools/${entry.slug}/`} className="link-inline">
                    {entry.name} <Icon name="arrow-right" size={12} />
                  </Link>
                ))}
              </div>
            </>
          ) : null}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setQuery('')}>
            Clear the search
          </button>
        </div>
      ) : (
        sections.map(({ job, tools }) => (
          <section key={job.id} className="catalog-group" aria-labelledby={`job-${job.id}`}>
            <div className="catalog-group__head">
              <Icon name={job.icon} size={15} style={{ color: 'var(--accent)' }} />
              <h2 id={`job-${job.id}`}>{job.name}</h2>
              <span className="mono">{tools.length.toString().padStart(2, '0')}</span>
              <hr />
              {job.hub ? (
                <Link to={jobHref(job)} className="link-inline catalog-group__more">
                  About {job.name.toLowerCase()} <Icon name="arrow-right" size={11} />
                </Link>
              ) : null}
            </div>

            {/*
              * The blurb explains why the job exists, which is worth a line when
              * the section holds its tools. While a search is narrowing the page
              * the visitor is looking for a match, not a definition, and a
              * paragraph above one card delays it.
              */}
            {query.trim() || activeJob ? null : <p className="catalog-group__blurb">{job.blurb}</p>}

            {/*
              * A plain grid here, on purpose.
              *
              * `gridColumnsClass` exists for a page with one grid on it: it picks
              * a column count that divides the cards and lets a lone straggler
              * span the row. In a catalogue of eight sections that rule fires on
              * every odd count, so Convert's fifth tool became a full-width card
              * and Reshape's third did too — the page read as three different
              * card sizes. A section is scanned top-down, and a gap at the end of
              * a row is quieter than a card twice the width of its neighbours.
              */}
            <div className="tool-grid">
              {tools.map(({ tool }) => {
                /*
                 * The format family is the *second* axis, so it rides on the card
                 * as a tag: "PDF" under Unlock tells you this is the PDF half of
                 * the job, and the same word links the tool to the page that
                 * lists it beside its neighbours. Without it the two Unlock
                 * tools look interchangeable.
                 */
                const family = CATEGORY_MAP[tool.category];
                return (
                  <ToolCard
                    key={tool.slug}
                    to={`/tools/${tool.slug}/`}
                    name={tool.name}
                    blurb={tool.blurb}
                    icon={tool.icon}
                    tags={[family.name, ...(tool.tags ?? [])]}
                    showLocal
                  />
                );
              })}
            </div>
          </section>
        ))
      )}

      {/*
        * The format pages still exist, are still indexed, and still answer "show
        * me everything that takes a PDF". They are the second axis now, so they
        * get one row at the end instead of the segmented control that used to be
        * the first thing under the heading.
        */}
      <section className="catalog-also" aria-labelledby="by-file-type">
        <div className="catalog-group__head">
          <Icon name="layers" size={15} style={{ color: 'var(--accent)' }} />
          <h2 id="by-file-type">Prefer to browse by file type?</h2>
          <hr />
          <Link to="/tools/workspace/" className="link-inline">
            Start from a file instead <Icon name="arrow-right" size={11} />
          </Link>
        </div>
        <div className="catalog-also__row">
          {CATEGORIES.map((category) => {
            const count = TOOLS.filter((tool) => tool.category === category.id).length;
            return (
              <Link key={category.id} to={`/tools/${category.id}/`} className="catalog-also__link">
                <Icon name={category.icon} size={15} />
                <span>
                  <strong>{category.name}</strong>
                  <span className="mono">
                    {count} {count === 1 ? 'tool' : 'tools'}
                  </span>
                </span>
                <Icon name="arrow-right" size={12} />
              </Link>
            );
          })}
        </div>
        <p className="catalog-also__note">
          These pages list the same tools as the jobs above — one axis is the file you are holding, the other
          is the task you have. A ZIP appears under Unpack, Lock and Verify, because the job decides which
          one you want.
        </p>
      </section>
    </main>
  );
}
