import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CATEGORIES, CATEGORY_MAP } from '../registry/categories';
import { TOOLS } from '../registry/tools';
import { Icon } from '../components/ui/Icon';
import { ToolCard } from '../components/tool/ToolCard';
import { usePageMeta } from '../hooks/usePageMeta';
import { PAGE_META } from '../seo/pages';
import { nearestEntries, searchEntries } from '../lib/search/search';
import { ENABLED_HUBS, hubForTool } from '../registry/groups';
import { FORMATS } from '../lib/capabilities/formats';

/** Same objects the palette searches, so both surfaces answer identically. */
const SEARCHABLE = TOOLS.map((tool) => ({
  tool,
  slug: tool.slug,
  name: tool.name,
  blurb: tool.blurb,
  categoryName: CATEGORY_MAP[tool.category].name,
  tags: tool.tags,
  keywords: tool.keywords,
  aliases: tool.aliases,
}));

const TOOL_BY_SLUG = new Map(TOOLS.map((tool) => [tool.slug, tool]));

export function ToolsPage() {
  usePageMeta(PAGE_META['/tools/'], '/tools/');
  /*
   * `?q=` is how the palette hands over a query it could not finish showing.
   *
   * The parameter is read on mount and re-read when a palette navigation changes
   * it without remounting this page. Typing writes it back with `replace`, so a
   * filtered catalogue can be shared or reloaded, the back button is not filled
   * with one entry per keystroke, and the page never reopens filtered by a query
   * the visitor has already cleared.
   */
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const setQuery = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('q', value);
    else next.delete('q');
    setParams(next, { replace: true });
  };

  const filtered = useMemo(
    () => searchEntries(SEARCHABLE, query).map((hit) => hit.item.tool),
    [query],
  );

  /** Closest tools when a filter matches nothing, so the page is never a dead end. */
  const suggestions = useMemo(
    () =>
      filtered.length === 0 && query.trim()
        ? nearestEntries(SEARCHABLE, query, 3)
            .map((entry) => TOOL_BY_SLUG.get(entry.slug))
            .filter((tool): tool is (typeof TOOLS)[number] => Boolean(tool))
        : [],
    [filtered.length, query],
  );

  const grouped = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        category,
        tools: filtered.filter((tool) => tool.category === category.id),
      })).filter((group) => group.tools.length > 0),
    [filtered],
  );

  return (
    <main id="main" className="page">
      <header className="catalog-head">
        <span className="eyebrow">Tool catalogue</span>
        <h1>Everything runs where your file already is.</h1>
        <p>
          {TOOLS.length} tools for converting, compressing, bundling, protecting, inspecting and encoding files.
          Each one opens straight into a workspace on your device — nothing is uploaded and no account is
          needed.
        </p>
      </header>

      {/*
        * The capability row is the answer to "these are the same job in two
        * places". It sits above the format groups because it cuts across them:
        * a visitor who wants to remove a password does not first think "is this a
        * PDF or a docx?", and the catalogue should not make them.
        */}
      <nav className="capability-strip" aria-label="By capability">
        <span className="capability-strip__label">By job</span>
        <Link to="/tools/workspace/" className="capability-chip capability-chip--start">
          <Icon name="wand" size={12} /> Any file
        </Link>
        {ENABLED_HUBS.map((hub) => (
          <Link key={hub.id} to={`/tools/${hub.id}/`} className="capability-chip">
            {hub.name}
            <span className="capability-chip__formats">
              {hub.formats.slice(0, 4).map((format) => FORMATS[format]?.label ?? format).join(' · ')}
            </span>
          </Link>
        ))}
      </nav>

      <div className="catalog-controls">
        <div className="catalog-search">
          <Icon name="search" size={15} />
          <input
            type="search"
            value={query}
            placeholder="Filter by name, format or action…"
            aria-label="Filter tools"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {/*
         * Each group is a real page, so these are links rather than filters:
         * they can be shared, opened in a new tab and followed by a crawler.
         * The trailing arrow is the visible difference from the segmented
         * controls elsewhere in the app, which filter in place.
         */}
        <nav className="segmented catalog-nav" aria-label="Category pages">
          <Link to="/tools/" className="segmented__option" aria-current="page">
            ALL TOOLS
          </Link>
          {CATEGORIES.map((category) => (
            <Link key={category.id} to={`/tools/${category.id}/`} className="segmented__option">
              {category.name.toUpperCase()}
              <Icon name="arrow-right" size={11} />
            </Link>
          ))}
        </nav>

        <span className="catalog-count" aria-hidden="true">
          {filtered.length} of {TOOLS.length} tools
        </span>
        {/* The visible count is decorative; this is what a screen reader hears. */}
        <span className="visually-hidden" role="status" aria-live="polite">
          {query.trim()
            ? `${filtered.length} of ${TOOLS.length} tools match ${query}`
            : `${TOOLS.length} tools`}
        </span>
      </div>

      {grouped.length === 0 ? (
        <div className="catalog-empty">
          <p>No tools match “{query}”.</p>
          {suggestions.length > 0 ? (
            <>
              <span className="catalog-empty__label">Closest tools</span>
              <div className="catalog-empty__links">
                {suggestions.map((tool) => (
                  <Link key={tool.slug} to={`/tools/${tool.slug}/`} className="link-inline">
                    {tool.name} <Icon name="arrow-right" size={12} />
                  </Link>
                ))}
              </div>
            </>
          ) : null}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setQuery('')}>
            Clear the filter
          </button>
        </div>
      ) : (
        grouped.map(({ category, tools }) => (
          <section key={category.id} className="catalog-group" aria-labelledby={`cat-${category.id}`}>
            <div className="catalog-group__head">
              <Icon name={category.icon} size={15} style={{ color: 'var(--accent)' }} />
              <h2 id={`cat-${category.id}`}>{category.name}</h2>
              <span className="mono">{tools.length.toString().padStart(2, '0')}</span>
              <hr />
            </div>

            <div className="tool-grid">
              {tools.map((tool) => {
                /*
                 * A tool that is part of a cross-format capability says so on its
                 * card. This is the visible half of the grouping: the visitor sees
                 * "Unlock" on both the PDF and the Office card before opening
                 * either, so the pair reads as one job with two formats rather
                 * than two unrelated products.
                 */
                const hub = hubForTool(tool.slug);
                return (
                  <ToolCard
                    key={tool.slug}
                    to={`/tools/${tool.slug}/`}
                    name={tool.name}
                    blurb={tool.blurb}
                    icon={tool.icon}
                    tags={hub ? [...(tool.tags ?? []), hub.name] : tool.tags}
                    showLocal
                  />
                );
              })}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
