/**
 * Which modifier to *print* on a keyboard hint.
 *
 * The handler has always accepted `metaKey || ctrlKey`, so the shortcut worked
 * everywhere — but the header printed `⌘K` to every visitor, which is wrong for
 * roughly two thirds of them. The label should match the keyboard in front of the
 * person reading it.
 *
 * Detection is deliberately cheap and synchronous: this runs during render, and
 * the answer only changes the glyph on a `<kbd>`.
 */
export function isApplePlatform(): boolean {
  // No `navigator` means this is the prerenderer, not a browser. It defaults to
  // the Ctrl label, which the header then corrects after mount.
  if (typeof navigator === 'undefined') return false;

  // userAgentData is Chromium-only and still low-entropy enough to be reliable here.
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform) return /mac|iphone|ipad|ipod/i.test(uaData.platform);

  // iPadOS 13+ reports "MacIntel" with a touch screen; either way the ⌘ glyph is right.
  const platform = navigator.platform ?? '';
  if (/mac|iphone|ipad|ipod/i.test(platform)) return true;

  // Fall back to the user agent string when `platform` is absent (some privacy modes).
  return /mac os x|iphone|ipad/i.test(navigator.userAgent ?? '');
}

/** The two keycaps to render for "open the command palette". */
export function searchShortcut(): { modifier: string; key: string; label: string } {
  return isApplePlatform()
    ? { modifier: '⌘', key: 'K', label: 'Command K' }
    : { modifier: 'Ctrl', key: 'K', label: 'Control K' };
}
