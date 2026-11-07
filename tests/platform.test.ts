import { afterEach, describe, expect, it, vi } from 'vitest';
import { isApplePlatform, searchShortcut } from '../src/lib/platform';

/**
 * The header prints a keyboard hint next to "Search tools". It used to print ⌘K
 * to everyone while the handler accepted ⌘ *or* Ctrl — true for the shortcut,
 * false for the label. These cases pin the label to the platform.
 */

function stubNavigator(shape: { platform?: string; userAgent?: string; userAgentData?: { platform?: string } }) {
  vi.stubGlobal('navigator', shape);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('search shortcut label', () => {
  it('prints ⌘ on macOS', () => {
    stubNavigator({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' });
    expect(isApplePlatform()).toBe(true);
    expect(searchShortcut()).toEqual({ modifier: '⌘', key: 'K', label: 'Command K' });
  });

  it('prints Ctrl on Windows and Linux', () => {
    stubNavigator({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    expect(isApplePlatform()).toBe(false);
    expect(searchShortcut().modifier).toBe('Ctrl');

    stubNavigator({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
    expect(searchShortcut().modifier).toBe('Ctrl');
  });

  it('trusts userAgentData when present', () => {
    stubNavigator({ userAgentData: { platform: 'macOS' }, platform: '', userAgent: 'Mozilla/5.0 (X11)' });
    expect(isApplePlatform()).toBe(true);
  });

  it('treats iPad as Apple, including the desktop-class user agent', () => {
    stubNavigator({ platform: 'iPad', userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' });
    expect(isApplePlatform()).toBe(true);

    // iPadOS 13+ reports MacIntel; the ⌘ glyph is still the right one.
    stubNavigator({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)' });
    expect(isApplePlatform()).toBe(true);
  });

  it('defaults to Ctrl where there is no navigator, so the prerender is stable', () => {
    vi.stubGlobal('navigator', undefined);
    expect(isApplePlatform()).toBe(false);
    expect(searchShortcut()).toEqual({ modifier: 'Ctrl', key: 'K', label: 'Control K' });
  });

  it('falls back to Ctrl when the platform cannot be read at all', () => {
    stubNavigator({ platform: '', userAgent: '' });
    expect(isApplePlatform()).toBe(false);
    expect(searchShortcut().modifier).toBe('Ctrl');
  });

  it('describes the shortcut in words for the accessible name', () => {
    stubNavigator({ platform: 'MacIntel' });
    expect(searchShortcut().label).toBe('Command K');
    stubNavigator({ platform: 'Win32' });
    expect(searchShortcut().label).toBe('Control K');
  });
});
