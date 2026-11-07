import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Route changes have to move scroll *and* focus.
 *
 * Scroll-to-top alone leaves a keyboard or screen-reader user on the link they
 * activated, with the next Tab continuing through the previous page's footer and
 * nothing announcing the new one. The hook is the fix; these assertions keep it
 * wired into the app and keep its two deliberate exemptions (first render, and
 * not fighting the scroll reset) from being "simplified" away.
 */

const root = process.cwd();
const hook = readFileSync(join(root, 'src/hooks/useRouteFocus.ts'), 'utf8');
const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');

describe('route focus', () => {
  it('is mounted on every route change', () => {
    expect(app).toContain('useRouteFocus()');
    // and it lives next to the scroll reset, not somewhere else
    expect(app).toMatch(/function RouteChange\(\)[\s\S]*useRouteFocus\(\)/);
  });

  it('skips the first render so deep links keep their initial focus', () => {
    expect(hook).toContain('previous.current === null');
    expect(hook).toMatch(/if \(first\) return;/);
  });

  it('focuses the heading, and does not fight the scroll reset', () => {
    expect(hook).toContain("main#main h1");
    expect(hook).toContain('preventScroll: true');
  });

  it('makes the target focusable without leaving it in the tab order', () => {
    expect(hook).toContain("setAttribute('tabindex', '-1')");
    expect(hook).toContain("removeAttribute('tabindex')");
  });
});
