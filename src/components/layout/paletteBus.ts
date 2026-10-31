/** Tiny event bus so the header button and keyboard shortcut can open the palette. */
const EVENT = 'zeroupload:open-palette';

export function openPalette(): void {
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onOpenPalette(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
