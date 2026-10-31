import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import { CATEGORY_MAP } from '../../registry/categories';
import { TOOLS } from '../../registry/tools';
import { onOpenPalette } from './paletteBus';

interface Entry {
  slug: string;
  name: string;
  category: string;
  icon: (typeof TOOLS)[number]['icon'];
  href: string;
  search: string;
}

const ENTRIES: Entry[] = [
  ...TOOLS.map((tool) => ({
    slug: tool.slug,
    name: tool.name,
    category: CATEGORY_MAP[tool.category].name,
    icon: tool.icon,
    href: `/tools/${tool.slug}/`,
    search: [tool.name, tool.blurb, ...(tool.tags ?? []), ...(tool.keywords ?? [])].join(' ').toLowerCase(),
  })),
  {
    slug: 'all-tools',
    name: 'All tools',
    category: 'Browse',
    icon: 'grid',
    href: '/tools/',
    search: 'all tools catalogue browse',
  },
  {
    slug: 'how-it-works',
    name: 'How local processing works',
    category: 'Browse',
    icon: 'shield',
    href: '/how-it-works/',
    search: 'architecture privacy security how it works local',
  },
];

function score(entry: Entry, query: string): number {
  if (!query) return 1;
  const name = entry.name.toLowerCase();
  if (name === query) return 100;
  if (name.startsWith(query)) return 80;
  if (name.includes(query)) return 60;
  const words = query.split(/\s+/).filter(Boolean);
  if (words.every((word) => entry.search.includes(word))) return 40;
  return 0;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => onOpenPalette(() => setOpen(true)), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ENTRIES.map((entry) => ({ entry, score: score(entry, q) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((item) => item.entry);
  }, [query]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const go = (entry: Entry) => {
    setOpen(false);
    navigate(entry.href);
  };

  return (
    <div className="palette-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search tools">
        <div className="palette__search">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search tools, formats, actions…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, results.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter' && results[active]) {
                event.preventDefault();
                go(results[active]);
              }
            }}
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-${results[active].slug}` : undefined}
          />
          <span className="kbd">ESC</span>
        </div>

        <div className="palette__list" id="palette-results" role="listbox">
          {results.length === 0 ? (
            <div className="palette__empty">No tool matches “{query}”.</div>
          ) : (
            results.map((entry, index) => (
              <button
                key={entry.slug}
                id={`palette-${entry.slug}`}
                type="button"
                role="option"
                aria-selected={index === active}
                className="palette__item"
                data-active={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(entry)}
              >
                <Icon name={entry.icon} size={15} />
                <span className="grow">{entry.name}</span>
                <span className="mono" style={{ fontSize: 10.5, opacity: 0.55, letterSpacing: '0.06em' }}>
                  {entry.category.toUpperCase()}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="palette__footer">
          <span>
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> navigate
          </span>
          <span>
            <span className="kbd">↵</span> open
          </span>
          <span style={{ marginLeft: 'auto' }}>Search runs locally — no queries are sent anywhere.</span>
        </div>
      </div>
    </div>
  );
}
