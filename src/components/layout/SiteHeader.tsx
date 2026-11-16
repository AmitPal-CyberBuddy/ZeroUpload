import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ZeroMark } from '../brand/ZeroMark';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../hooks/useTheme';
import { openPalette } from './paletteBus';
import { searchShortcut } from '../../lib/platform';

const NAV = [
  { to: '/tools/', label: 'Tools' },
  { to: '/how-it-works/', label: 'How it works' },
];

const GITHUB_URL = 'https://github.com/AmitPal-CyberBuddy/ZeroUpload';

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const location = useLocation();
  /*
   * The prerendered HTML is built in Node, where there is no `navigator` — so the
   * markup always ships "Ctrl K" and the label is corrected after mount. Sniffing
   * during render instead would make the server and the browser disagree about
   * the same element, which is exactly the hydration mismatch React warns about.
   */
  const [shortcut, setShortcut] = useState(() => searchShortcut());
  useEffect(() => setShortcut(searchShortcut()), []);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  /*
   * An open menu has to be dismissable the way a menu is: Escape closes it and
   * returns focus to the button that opened it, and a tap outside closes it too.
   * Without the first, a keyboard user can open the menu and then be stuck with
   * it covering the page.
   */
  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
      burgerRef.current?.focus();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || burgerRef.current?.contains(target)) return;
      setMenuOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [menuOpen]);

  /*
   * The menu is an overlay, so the page under it must not move.
   *
   * It did: the menu is `position: fixed` and only as tall as its links, so
   * scrolling carried the hero heading up behind the semi-transparent sheet and
   * out the other side — the menu looked like it was dissolving into the page.
   * Locking the body while it is open is the same thing a modal does, and it also
   * stops a touch drag from dismissing the menu by accident.
   *
   * The previous value is restored rather than cleared to `''`, so this cannot
   * fight another component that has already locked scrolling.
   */
  useEffect(() => {
    /*
     * Release the lock unconditionally on cleanup, including when the component
     * unmounts with the menu still open. `useEffect(() => setMenuOpen(false),
     * [pathname])` closes the menu on navigation, but a full unmount — the header
     * going away with the route, or the app being torn down — never runs the
     * effect body again, so the restore has to live in the cleanup.
     *
     * The test caught this: navigating with the menu open left the document
     * scroll-locked with nothing on screen to explain it.
     */
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  return (
    <header className={`site-header ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="page site-header__inner">
        <Link to="/" className="brand" aria-label="ZeroUpload home">
          <ZeroMark size={26} className="brand__mark" />
          <span className="brand__word">
            Zero<span>Upload</span>
          </span>
        </Link>

        <nav className="site-nav" aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="header-actions">
          {/* The hint follows the keyboard: ⌘ on Apple, Ctrl everywhere else. */}
          <button
            type="button"
            className="search-trigger"
            onClick={openPalette}
            aria-keyshortcuts="Control+K Meta+K"
            title={`Search tools (${shortcut.label})`}
          >
            <Icon name="search" size={15} />
            <span className="search-trigger__label">Search tools</span>
            <kbd className="mono" aria-hidden="true">
              <span className="kbd">{shortcut.modifier}</span>
              <span className="kbd">{shortcut.key}</span>
            </kbd>
          </button>

          <button
            type="button"
            className="theme-toggle"
            onClick={toggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
          </button>

          <a
            className="btn btn--icon header-github"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="ZeroUpload on GitHub"
            title="Source on GitHub"
          >
            <Icon name="github" size={17} />
          </a>

          <button
            ref={burgerRef}
            type="button"
            className="btn btn--icon header-burger"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? 'x' : 'menu'} size={18} />
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div className="mobile-menu" id="mobile-menu" ref={menuRef}>
          {NAV.map((item) => (
            <Link key={item.to} to={item.to}>
              {item.label}
              <Icon name="chevron" size={14} />
            </Link>
          ))}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
            Source on GitHub
            <Icon name="external" size={14} />
          </a>
        </div>
      ) : null}
    </header>
  );
}
