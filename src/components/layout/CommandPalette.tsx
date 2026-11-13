import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import { CATEGORY_MAP } from '../../registry/categories';
import { TOOLS } from '../../registry/tools';
import { nearestEntries, searchEntries, type Searchable } from '../../lib/search/search';
import { onOpenPalette } from './paletteBus';
import { preloadTool, toolSlugFromPath } from '../../registry/toolComponents';
import { deployBase } from '../../seo/site';
import { browserStore, clearRecent, readRecent } from '../../lib/recent/recentTools';
import { TOOL_SLUGS } from '../../hooks/useRecordToolVisit';
import { ENABLED_HUBS } from '../../registry/groups';

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

/**
 * Capability hubs are searchable in their own right.
 *
 * Someone who types "unlock" is not looking for a format — they are looking for
 * the job, and which tool does it for their file is the question the hub answers.
 * Without these entries the palette sent them to whichever tool happened to rank
 * first, which is how "Unlock PDF" came to look like the only answer.
 */
const HUB_ENTRIES: Entry[] = ENABLED_HUBS.map((hub) => ({
  slug: `capability-${hub.id}`,
  name: hub.name,
  blurb: hub.blurb,
  description: hub.blurb,
  categoryName: 'Capability',
  href: `/tools/${hub.id}/`,
  icon: 'layers' as Entry['icon'],
  keywords: [hub.id, hub.name.toLowerCase(), 'capability', ...hub.formats],
  aliases: hub.tools.flatMap((slug) => {
    const tool = TOOLS.find((entry) => entry.slug === slug);
    return tool ? [tool.name] : [];
  }),
}));

const STATIC_ENTRIES: Entry[] = [
  {
    slug: 'workspace',
    name: 'Workspace — drop a file and see what it can become',
    blurb: 'Drop any file; the actions that apply to it are the only ones offered.',
    description: 'Drop any file and see every action that applies to it, chosen from the file itself.',
    categoryName: 'Start here',
    href: '/tools/workspace/',
    icon: 'wand',
    keywords: ['workspace', 'drop', 'any file', 'convert', 'what can i do', 'start', 'detect'],
    aliases: ['open a file', 'i have a file', 'auto detect'],
  },
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

const ENTRIES = [...TOOL_ENTRIES, ...HUB_ENTRIES, ...STATIC_ENTRIES];

const ENTRY_BY_SLUG = new Map(ENTRIES.map((entry) => [entry.slug, entry]));

/** Results the palette will show before it offers the catalogue instead. */
const VISIBLE_RESULTS = 8;

const FOCUSABLE = 'button, [href], input, [tabindex]:not([tabindex="-1"])';

/**
 * True where a keystroke belongs to the field, not to the app.
 *
 * `isContentEditable` matters as much as the tag names: the JSON formatter's
 * editor and the base64 panel are plain inputs, but a future rich editor would be
 * a contenteditable div, and typing `/` into it must stay a slash.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
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
      } else if (event.key === '/' && !open && !isTypingTarget(event.target)) {
        /*
         * `/` opens the palette, the way it does in most tools a developer
         * already has open in another tab. The guard is the point: a slash typed
         * into a filename field, a page-range box or the palette's own input is a
         * slash, not a command.
         */
        event.preventDefault();
        restoreRef.current = document.activeElement as HTMLElement | null;
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Read on open rather than on mount: a tool visited in another tab should
      // be here, and the palette outlives any single route.
      setRecent(readRecent(browserStore(), TOOL_SLUGS));
      const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(timer);
    }

    // Returning focus to whatever opened the dialog is the other half of
    // `aria-modal`: without it, a keyboard user lands at the top of the page.
    const restore = restoreRef.current;
    restoreRef.current = null;
    if (restore && document.contains(restore)) restore.focus();
  }, [open]);

  const trimmed = query.trim();
  const matches = useMemo(() => searchEntries(ENTRIES, query), [query]);

  /*
   * Recents are shown once, in their own row, so they are removed from the list
   * underneath rather than duplicated into it. Duplication would be worse than
   * cosmetic: two rows for one tool means two arrow-key stops for one page, and
   * the second one looks like a different result.
   */
  const recentEntries = useMemo(
    () => (trimmed ? [] : recent.map((slug) => ENTRY_BY_SLUG.get(slug)).filter((entry): entry is Entry => Boolean(entry))),
    [trimmed, recent],
  );
  const recentSlugs = useMemo(() => new Set(recentEntries.map((entry) => entry.slug)), [recentEntries]);

  const results = useMemo(() => {
    const pool = trimmed ? matches : matches.filter((hit) => !recentSlugs.has(hit.item.slug));
    return pool.slice(0, VISIBLE_RESULTS);
  }, [matches, trimmed, recentSlugs]);

  const suggestions = useMemo(
    () => (results.length === 0 && trimmed ? nearestEntries(ENTRIES, query, 3) : []),
    [results.length, trimmed, query],
  );

  useEffect(() => setActive(0), [query]);

  /*
   * Arrow-key navigation is a click that has already been decided. Warming the
   * highlighted entry's chunk means Enter lands on a mounted tool instead of a
   * spinner — and unlike a hover, this also covers the keyboard-only visitor who
   * never produces a pointer event at all.
   */
  useEffect(() => {
    const slug = results[active] ? toolSlugFromPath(results[active].item.href) : undefined;
    if (slug) preloadTool(slug);
  }, [active, results]);

  /** Everything that matched, including the ones the palette did not have room for. */
  const hiddenMatches = trimmed ? Math.max(0, matches.length - results.length) : 0;
  // Router-relative: `Link` adds the deploy prefix itself, unlike the plain
  // `<a href>` in the empty state above, which must build it by hand.
  const catalogueHref = `/tools/?q=${encodeURIComponent(trimmed)}`;

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
          {trimmed
            ? results.length === 0
              ? `No tools match ${query}`
              : `${matches.length} ${matches.length === 1 ? 'result' : 'results'}`
            : `${ENTRIES.length} tools`}
        </p>

        {recentEntries.length > 0 ? (
          <div className="palette__recent" role="group" aria-label="Recently opened tools">
            <span className="palette__recent-label">Recent</span>
            {recentEntries.map((entry) => (
              <button key={entry.slug} type="button" className="palette__chip" onClick={() => go(entry)}>
                <Icon name={entry.icon} size={13} />
                {entry.name}
              </button>
            ))}
            <button
              type="button"
              className="palette__recent-clear"
              onClick={() => {
                clearRecent(browserStore());
                setRecent([]);
              }}
            >
              Clear
            </button>
          </div>
        ) : null}

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

        {hiddenMatches > 0 ? (
          <Link className="palette__more" to={catalogueHref} onClick={() => close()}>
            See all {matches.length} matches in the catalogue
            <Icon name="arrow-right" size={12} />
          </Link>
        ) : null}

        <div className="palette__footer" id="palette-hints">
          <span>
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> navigate
          </span>
          <span>
            <span className="kbd">↵</span> open
          </span>
          <span>
            <span className="kbd">/</span> anywhere
          </span>
          <span className="palette__footer-note">Search runs locally — no queries are sent anywhere.</span>
        </div>
      </div>
    </div>
  );
}
