import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * "Show me what comes out before I run it."
 *
 * Every tool used to be write-only: options in, button pressed, result revealed.
 * The fix is a shared panel rather than twenty bespoke implementations, so what is
 * worth pinning is the *consistency* — a tool that quietly drops the panel is the
 * regression this test exists to catch — plus the honesty rule that distinguishes
 * a measured number from an extrapolated one.
 *
 * The estimate hook itself is checked for the three properties that make a live
 * preview acceptable: it debounces, it discards superseded passes, and it refuses
 * to auto-measure an enormous source.
 */

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const IMAGE_TOOLS = [
  'src/tools/compress/ImageCompressorTool.tsx',
  'src/tools/convert/ImageConverterTool.tsx',
  'src/tools/transform/ResizeTool.tsx',
  'src/tools/transform/RotateTool.tsx',
  'src/tools/transform/CropTool.tsx',
];

const FILE_TOOLS = [
  'src/tools/pdf/SplitPdfTool.tsx',
  'src/tools/pdf/MergePdfTool.tsx',
  'src/tools/pdf/ImagesToPdfTool.tsx',
  'src/tools/pdf/RotatePdfTool.tsx',
  'src/tools/pdf/ProtectPdfTool.tsx',
  'src/tools/archive/CreateZipTool.tsx',
  'src/tools/archive/ExtractZipTool.tsx',
  'src/tools/convert/FaviconTool.tsx',
];

describe('outcome panel', () => {
  it('is present on every tool that has options', () => {
    const missing = [...IMAGE_TOOLS, ...FILE_TOOLS].filter((file) => !read(file).includes('<Outcome'));
    expect(missing).toEqual([]);
  });

  it('measures images rather than guessing at them', () => {
    for (const file of IMAGE_TOOLS) {
      const source = read(file);
      expect(source, file).toContain('useOutputEstimate');
      // The panel must be able to say "measuring" instead of showing a stale number.
      expect(source, file).toContain('estimate.measuring');
    }
  });

  it('offers a manual measure for sources above the automatic budget', () => {
    for (const file of IMAGE_TOOLS) {
      expect(read(file), file).toContain('estimate.needsManual');
    }
  });

  it('marks estimates as estimates', () => {
    // `approximate` renders a leading "≈"; a measured byte count does not use it.
    const panel = read('src/components/tool/Outcome.tsx');
    expect(panel).toContain('outcome__approx');
    expect(panel).toContain('approximate');
  });

  it('keeps one row order between states so nothing jumps', () => {
    // Rows are built into an array and replaced wholesale; the measuring state
    // fills the same slot rather than appending a new one.
    const panel = read('src/components/tool/Outcome.tsx');
    expect(panel).toContain('rows.map');
    expect(panel).not.toContain('rows.unshift');
  });

  it('announces changes politely, on the values only', () => {
    const panel = read('src/components/tool/Outcome.tsx');
    expect(panel).toMatch(/aria-live="polite"/);
    // The live region must not wrap the whole panel: the title and the icon would
    // be re-read on every slider tick. It starts at the <dl>.
    // It is on the <dl class="outcome__rows"> element — not on the panel, where the
    // title and icon would be re-announced on every change.
    expect(panel).toMatch(/<dl className="outcome__rows" aria-live="polite"/);
  });
});

describe('live image estimate', () => {
  const hook = read('src/hooks/useOutputEstimate.ts');

  it('debounces the slider', () => {
    expect(hook).toMatch(/DEBOUNCE_MS\s*=\s*\d{3}/);
    expect(hook).toContain('clearTimeout');
  });

  it('triggers on serialised options, not object identity', () => {
    // Tools rebuild their job literal on every render. Depending on the object
    // would restart the timer forever and the panel would never resolve.
    expect(hook).toContain('signature');
    expect(hook).toMatch(/\[enabled, input, needsManual, signature\]/);
  });

  it('discards a pass that finished after a newer one started', () => {
    expect(hook).toContain('token');
    expect(hook).toMatch(/if \(current !== token\.current\) return;/);
  });

  it('refuses to auto-measure an enormous source', () => {
    expect(hook).toMatch(/AUTO_LIMIT_PIXELS\s*=\s*[\d_]+/);
    expect(hook).toContain('needsManual');
  });

  it('does not report a failed preview as a tool error', () => {
    // A preview that cannot be measured is silence, not a red box: the real run
    // owns error reporting.
    expect(hook).toMatch(/catch\s*\{/);
    expect(hook).not.toContain('setError');
  });
});
