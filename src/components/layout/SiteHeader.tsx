import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ZeroMark } from '../brand/ZeroMark';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../hooks/useTheme';
import { openPalette } from './paletteBus';

const NAV = [
  { to: '/tools', label: 'Tools' },
  { to: '/how-it-works', label: 'How it works' },
];

const GITHUB_URL = 'https://github.com/AmitPal-CyberBuddy/ZeroUpload';

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => setMenuOpen(false), [location.pathname]);

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
          <button type="button" className="search-trigger" onClick={openPalette} aria-label="Search tools">
            <Icon name="search" size={15} />
            <span className="search-trigger__label">Search tools</span>
            <kbd className="mono">
              <span className="kbd">⌘</span>
              <span className="kbd">K</span>
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
            className="btn btn--icon"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="ZeroUpload on GitHub"
            title="Source on GitHub"
          >
            <Icon name="github" size={17} />
          </a>

          <button
            type="button"
            className="btn btn--icon header-burger"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label="Menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? 'x' : 'menu'} size={18} />
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div className="mobile-menu" id="mobile-menu">
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
