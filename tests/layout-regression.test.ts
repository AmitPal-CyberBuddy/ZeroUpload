import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('readable content layouts', () => {
  it('does not apply compact note-card grid rules to prose and FAQs', () => {
    const css = read('src/styles/tools.css');
    expect(css).toContain('.workspace-notes > div');
    expect(css).toContain('.workspace-notes p');
    expect(css).not.toMatch(/\.tool-notes(?:\s|\{|>)/);
    const layout = read('src/components/tool/ToolLayout.tsx');
    const category = read('src/pages/CategoryPage.tsx');
    expect(layout).toContain('className="tool-notes"');
    expect(category).toContain('className="tool-notes"');
    expect(layout).toContain('className="tool-notes__faq"');
  });

  it('keeps compact note cards independently sized and long badge content able to wrap', () => {
    const tools = read('src/styles/tools.css');
    const pages = read('src/styles/pages.css');
    const ui = read('src/styles/ui.css');
    expect(tools).toMatch(/\.workspace-notes\s*\{[^}]*align-items:\s*start/s);
    expect(pages).toMatch(/\.tool-grid\s*\{[^}]*align-items:\s*start/s);
    expect(ui).toMatch(/\.badge\s*\{[^}]*white-space:\s*normal/s);
  });

  /*
   * The category cards are the one grid where cards *should* share a height.
   *
   * They used to be `align-items: start`, which let each card size to its own
   * description; with descriptions of one and two lines the home page rendered a
   * row of visibly different heights and the "verb" link sat at a different
   * height on every card. Stretching the row and pushing the verb down with
   * `margin-top: auto` aligns both edges. This is asserted rather than left to
   * review because it is the kind of rule a later "tidy up the grid" edit
   * reverts without noticing.
   */
  it('gives the home category cards a shared row height and one verb baseline', () => {
    const pages = read('src/styles/pages.css');
    expect(pages).toMatch(/\.category-grid\s*\{[^}]*align-items:\s*stretch/s);
    expect(pages).toMatch(/\.category-card__verb\s*\{[^}]*margin-top:\s*auto/s);
  });

  it('uses the compact notes class in every tool that contains note cards', () => {
    const all = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? all(join(dir, entry.name)) : entry.name.endsWith('.tsx') ? [join(dir, entry.name)] : [],
    );
    const toolSources = all('src/tools').map(read);
    expect(toolSources.filter(source => source.includes('className="workspace-notes"')).length).toBeGreaterThan(0);
    expect(toolSources.some(source => source.includes('className="tool-notes"'))).toBe(false);
  });
});

describe('nested workspace constraints', () => {
  it('allows nested settings and result grids to shrink for long content', () => {
    const css = read('src/styles/workspace.css');
    expect(css).toMatch(/\.settings__body, \.settings__foot\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(css).toMatch(/\.workspace__main, \.tool-body, \.result\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(css).toMatch(/\.compare\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/s);
  });
});


describe('responsive primary action', () => {
  it('gives the docked footer precedence over the base footer rules', () => {
    const css = read('src/styles/workspace.css');
    expect(css).toMatch(/\.settings__foot\.settings__foot--docked\s*\{\s*display:\s*none/s);
    expect(css).toMatch(/@media \(max-width:\s*980px\)\s*\{\s*\.settings__foot\.settings__foot--docked\s*\{\s*display:\s*grid/s);
    expect(css).toContain('.settings__foot:not(.settings__foot--docked)');
    expect(css).toMatch(/\.workspace__side\s*\{[^}]*position:\s*static/s);
  });
});

describe('small-screen discoverability', () => {
  it('wraps catalogue navigation and avoids a tall sticky filter on smaller viewports', () => {
    const css = read('src/styles/pages.css');
    expect(css).toMatch(/@media \(max-width:\s*860px\)[\s\S]*?\.catalog-controls\s*\{\s*position:\s*static/);
    expect(css).toMatch(/\.catalog-nav\s*\{\s*flex-wrap:\s*wrap/);
  });
  it('gives mobile header and manifest actions larger touch targets', () => {
    const header = read('src/styles/layout.css');
    const tools = read('src/styles/tools.css');
    expect(header).toMatch(/\.search-trigger, \.theme-toggle, \.header-burger\s*\{[^}]*min-width:\s*44px;\s*min-height:\s*44px/);
    expect(tools).toMatch(/\.manifest__actions \.btn--icon\s*\{\s*width:\s*44px;\s*height:\s*44px/);
    expect(read('src/components/file/FileManifest.tsx')).not.toContain('opacity: 0.45');
  });
});

describe('large monitor layouts', () => {
  it('grows the shell gradually but caps it and keeps documentation readable', () => {
    expect(read('src/styles/tokens.css')).toContain('--page-max: clamp(1180px, 75vw, 1440px)');
    const pages = read('src/styles/pages.css');
    expect(pages).toMatch(/\.doc\s*\{[^}]*max-width:\s*780px;[^}]*margin-inline:\s*auto/s);
    expect(pages).toMatch(/\.tool-grid--featured\s*\{[^}]*repeat\(auto-fit/s);
    expect(pages).toMatch(/@media \(min-width:\s*1600px\)[\s\S]*?\.tool-grid\s*\{\s*grid-template-columns:\s*repeat\(4,\s*minmax\(0, 1fr\)\)/);
  });
  it('allows larger image previews only when the viewport is wide and tall', () => {
    expect(read('src/styles/tools.css')).toMatch(/@media \(min-width:\s*1600px\) and \(min-height:\s*900px\)[\s\S]*?\.preview-frame img\s*\{\s*max-height:\s*clamp\(360px, 35vh, 520px\)/);
    expect(read('src/styles/workspace.css')).toMatch(/\.result__preview, \.result__preview img\s*\{\s*max-height:\s*clamp\(320px, 32vh, 480px\)/);
  });
});
