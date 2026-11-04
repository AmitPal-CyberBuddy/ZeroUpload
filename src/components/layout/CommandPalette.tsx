import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import { CATEGORY_MAP } from '../../registry/categories';
import { TOOLS } from '../../registry/tools';
import { nearestEntries, searchEntries, type Searchable } from '../../lib/search/search';
import { onOpenPalette } from './paletteBus';
import { deployBase } from '../../seo/site';

interface Entry extends Searchable {
  href: string;
  icon: (typeof TOOLS)[number]['icon'];
  /** Shown as the result's second line. */
  description: string;
}

const TOOL_ENTRIES: Entry[] = TOOLS.map((tool) => ({
  slug: tool.slug,
  name: tool.name,
  blurb: tool.blurb,
  description: tool.blurb,
  categoryName: CATEGORY_MAP[tool.category].name,
  href: `/tools/${tool.slug}/`,
  icon: tool.icon,
  tags: tool.tags,
  keywords: tool.keywords,
  aliases: tool.aliases,
}));

const STATIC_ENTRIES: Entry[] = [
  {
    slug: 'all-tools',
    name: 'All tools',
    blurb: 'The full catalogue, grouped by what you are working on.',
    description: 'The full catalogue, grouped by what you are working on.',
    categoryName: 'Browse',
    href: '/tools/',
    icon: 'grid',
    keywords: ['all tools', 'catalogue', 'browse', 'index'],
  },
  {
    slug: 'how-it-works',
    name: 'How local processing works',
    blurb: 'What runs in the browser, what the limits are, and why nothing is uploaded.',
    description: 'What runs in the browser, what the limits are, and why nothing is uploaded.',
    categoryName: 'Browse',
    href: '/how-it-works/',
    icon: 'shield',
    keywords: ['architecture', 'privacy', 'security', 'how it works', 'local', 'offline'],
  },
];

const ENTRIES = [...TOOL_ENTRIES, ...STATIC_ENTRIES];

const FOCUSABLE = 'button, [href], input, [tabindex]:not([tabindex="-1"])';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  /** Element that had focus before the dialog opened, so it can be returned. */
  const restoreRef = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    return onOpenPalette(() => {
      restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => {
          if (!value) restoreRef.current = document.activeElement as HTMLElement | null;
          return !value;
        });
      } else if (event.key === 'Escape' && open) {
        // Escape is handled here so it works even when focus has wandered.
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(timer);
    }

    // Returning focus to whatever opened the dialog is the other half of
    // `aria-modal`: without it, a keyboard user lands at the top of the page.
    const restore = restoreRef.current;
    restoreRef.current = null;
    if (restore && document.contains(restore)) restore.focus();
  }, [open]);

  const results = useMemo(() => searchEntries(ENTRIES, query).slice(0, 8), [query]);
  const suggestions = useMemo(
    () => (results.length === 0 && query.trim() ? nearestEntries(ENTRIES, query, 3) : []),
    [results.length, query],
  );

  useEffect(() => setActive(0), [query]);

  const go = useCallback(
    (entry: Entry) => {
      setOpen(false);
      navigate(entry.href);
    },
    [navigate],
  );

  /**
   * Tab stays inside the dialog. The list is one composite widget, so only the
   * input and the footer links are tabbable; wrapping at the ends is enough.
   */
  const onDialogKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
      (node) => node.offsetParent !== null,
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        ref={dialogRef}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search tools"
        onKeyDown={onDialogKeyDown}
      >
        <div className="palette__search">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search tools, formats, actions…"
            aria-label="Search tools"
            aria-describedby="palette-hints"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="palette-results"
            aria-autocomplete="list"
            aria-activedescendant={results[active] ? `palette-${results[active].item.slug}` : undefined}
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
                go(results[active].item);
              }
            }}
          />
          <span className="kbd">ESC</span>
        </div>

        {/* One polite announcement per keystroke: the count, not the whole list. */}
        <p className="visually-hidden" role="status" aria-live="polite">
          {query.trim()
            ? results.length === 0
              ? `No tools match ${query}`
              : `${results.length} ${results.length === 1 ? 'result' : 'results'}`
            : `${ENTRIES.length} tools`}
        </p>

        <div className="palette__list" id="palette-results" role="listbox" aria-label="Results">
          {results.length === 0 ? (
            <div className="palette__empty">
              {suggestions.length > 0 ? (
                <>
                  <p>No exact match for “{query}”.</p>
                  <span className="palette__empty-label">Closest tools</span>
                  <div className="palette__suggestions">
                    {suggestions.map((entry) => (
                      <button
                        key={entry.slug}
                        type="button"
                        className="palette__suggestion"
                        onClick={() => go(entry)}
                      >
                        <Icon name={entry.icon} size={14} />
                        {entry.name}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p>Nothing matches “{query}”.</p>
              )}
              <a className="link-inline" href={`${deployBase()}tools/`} onClick={() => close()}>
                Browse all tools <Icon name="arrow-right" size={12} />
              </a>
            </div>
          ) : (
            results.map(({ item: entry }, index) => (
              <button
                key={entry.slug}
                id={`palette-${entry.slug}`}
                type="button"
                role="option"
                aria-selected={index === active}
                className="palette__item"
                data-active={index === active}
                tabIndex={-1}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(entry)}
              >
                <Icon name={entry.icon} size={15} />
                <span className="palette__item-text">
                  <span className="palette__item-name">{entry.name}</span>
                  <span className="palette__item-desc">{entry.description}</span>
                </span>
                <span className="palette__item-group mono">{entry.categoryName.toUpperCase()}</span>
              </button>
            ))
          )}
        </div>

        <div className="palette__footer" id="palette-hints">
          <span>
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> navigate
          </span>
          <span>
            <span className="kbd">↵</span> open
          </span>
          <span className="palette__footer-note">Search runs locally — no queries are sent anywhere.</span>
        </div>
      </div>
    </div>
  );
}
