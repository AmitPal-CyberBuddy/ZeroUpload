import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Lazy tool registry. Every tool is its own chunk; heavy dependencies (pdf-lib,
 * fflate) are imported *inside* the tool module so they are only fetched when
 * that tool is opened.
 *
 * The import functions are kept in `TOOL_LOADERS` and the components are derived
 * from them, rather than the other way round, because a hint that someone is
 * about to open a tool needs the *function*. `React.lazy` keeps its promise
 * private, so before this split there was no way to warm a tool without mounting
 * it — and every card click paid for the chunk with a spinner.
 */
const TOOL_LOADERS: Record<string, () => Promise<{ default: ComponentType }>> = {
  'image-converter': () => import('../tools/convert/ImageConverterTool'),
  'favicon': () => import('../tools/convert/FaviconTool'),
  'image-compressor': () => import('../tools/compress/ImageCompressorTool'),
  'resize': () => import('../tools/transform/ResizeTool'),
  'crop': () => import('../tools/transform/CropTool'),
  'rotate': () => import('../tools/transform/RotateTool'),
  'merge-pdf': () => import('../tools/pdf/MergePdfTool'),
  'split-pdf': () => import('../tools/pdf/SplitPdfTool'),
  'rotate-pdf': () => import('../tools/pdf/RotatePdfTool'),
  'images-to-pdf': () => import('../tools/pdf/ImagesToPdfTool'),
  'protect-pdf': () => import('../tools/pdf/ProtectPdfTool'),
  'unlock-pdf': () => import('../tools/pdf/UnlockPdfTool'),
  'create-zip': () => import('../tools/archive/CreateZipTool'),
  'extract-zip': () => import('../tools/archive/ExtractZipTool'),
  'unlock-office': () => import('../tools/archive/UnlockOfficeTool'),
  // Compiled in, but the registry hides the route unless
  // VITE_ENABLE_OFFICE_ENCRYPTION is set — see src/lib/office/features.ts.
  'encrypt-office': () => import('../tools/archive/ProtectOfficeTool'),
  'file-inspector': () => import('../tools/inspect/FileInspectorTool'),
  'json-formatter': () => import('../tools/dev/JsonFormatterTool'),
  'base64': () => import('../tools/dev/Base64Tool'),
  'url-encoder': () => import('../tools/dev/UrlEncoderTool'),
  'hash-generator': () => import('../tools/dev/HashGeneratorTool'),
};

export const TOOL_COMPONENTS: Record<string, LazyExoticComponent<ComponentType>> = Object.fromEntries(
  Object.entries(TOOL_LOADERS).map(([slug, load]) => [slug, lazy(load)]),
);

/** Chunks that have been asked for, so intent does not fire the same request twice. */
const warming = new Set<string>();

/**
 * Fetches a tool's chunk before it is opened.
 *
 * Called on pointer-over, focus and touch-down of a card. It is deliberately
 * cheap and silent: no state, no render, and a rejection is swallowed — if the
 * network is gone, the click will fail in the ordinary way and the tool's own
 * error path will explain it.
 *
 * Two situations are skipped on purpose: Save-Data, and the 2G/3G connection
 * classes. Fetching ~240 kB of pdf-lib because a cursor crossed a card is a bad
 * trade on a metered connection, and the click still works, just slower.
 */
export function preloadTool(slug: string): void {
  if (!(slug in TOOL_LOADERS)) return;
  if (warming.has(slug)) return;

  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;

  if (connection?.saveData) return;
  if (connection?.effectiveType && /(^|-)2g$/.test(connection.effectiveType)) return;

  warming.add(slug);
  TOOL_LOADERS[slug]().catch(() => {
    // Allow a later attempt if this one failed (offline, flaky network).
    warming.delete(slug);
  });
}

/** `/tools/merge-pdf/` → `merge-pdf`. Returns undefined for anything else. */
export function toolSlugFromPath(path: string): string | undefined {
  const match = /^\/tools\/([\w-]+)\/?$/.exec(path.split('?')[0].split('#')[0]);
  if (!match) return undefined;
  return match[1] in TOOL_LOADERS ? match[1] : undefined;
}
