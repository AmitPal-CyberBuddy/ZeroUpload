import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CATEGORIES, CATEGORY_MAP, type CategoryId } from '../registry/categories';
import { TOOLS } from '../registry/tools';
import { Icon } from '../components/ui/Icon';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const ALL = 'all';

export function ToolsPage() {
  useDocumentTitle('Tool catalogue');
  const [params, setParams] = useSearchParams();
  const activeParam = params.get('c');
  const active = CATEGORIES.some((c) => c.id === activeParam) ? (activeParam as CategoryId) : ALL;
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TOOLS.filter((tool) => {
      if (active !== ALL && tool.category !== active) return false;
      if (!q) return true;
      const haystack = [
        tool.name,
        tool.blurb,
        tool.description,
        ...(tool.tags ?? []),
        ...(tool.keywords ?? []),
        ...(tool.aliases ?? []),
        CATEGORY_MAP[tool.category].name,
      ]
        .join(' ')
        .toLowerCase();
      return q.split(/\s+/).every((word) => haystack.includes(word));
    });
  }, [active, query]);

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
          {TOOLS.length} tools across seven categories. Each one is a separate module, loaded only when you
          open it — and none of them can reach a server, because the build has no server to reach.
        </p>
      </header>

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

        <div className="segmented" role="group" aria-label="Filter by category">
          <button
            type="button"
            className="segmented__option"
            aria-pressed={active === ALL}
            onClick={() => setParams({})}
          >
            ALL
          </button>
          {CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              className="segmented__option"
              aria-pressed={active === category.id}
              onClick={() => setParams({ c: category.id })}
            >
              {category.name.toUpperCase()}
            </button>
          ))}
        </div>

        <span className="catalog-count">
          {filtered.length} / {TOOLS.length}
        </span>
      </div>

      {grouped.length === 0 ? (
        <div className="catalog-empty">
          <p>No tools match “{query}”.</p>
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
              {tools.map((tool) => (
                <Link key={tool.slug} to={`/tools/${tool.slug}`} className="tool-card">
                  <div className="tool-card__top">
                    <span className="tool-card__icon">
                      <Icon name={tool.icon} size={16} />
                    </span>
                    <h3>{tool.name}</h3>
                  </div>
                  <p>{tool.blurb}</p>
                  <div className="tool-card__foot">
                    <span className="tool-card__tags">
                      {tool.tags?.slice(0, 2).map((tag) => (
                        <span key={tag} className="badge">
                          {tag}
                        </span>
                      ))}
                    </span>
                    <span className="badge badge--accent">
                      <i className="dot" aria-hidden="true" />
                      Local
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
