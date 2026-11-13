import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('shared visual polish', () => {
  it('loads the shared layer before accessibility overrides', () => {
    const entry = read('src/main.tsx');
    expect(entry.indexOf("./styles/polish.css")).toBeGreaterThan(entry.indexOf("./styles/batch.css"));
    expect(entry.indexOf("./styles/polish.css")).toBeLessThan(entry.indexOf("./styles/a11y.css"));
  });

  it('keeps the card affordance decorative and the link label intact', () => {
    const card = read('src/components/tool/ToolCard.tsx');
    expect(card).toContain('className="tool-card__arrow" aria-hidden="true"');
    expect(card).toContain('<h3>{name}</h3>');
  });

  it('provides named, keyboard-scrollable regions for documentation tables', () => {
    const page = read('src/pages/ArchitecturePage.tsx');
    expect(page.match(/className="doc-table-wrap" role="region"/g)).toHaveLength(2);
    expect(page.match(/className="doc-table-wrap" role="region"[^>]*tabIndex=\{0\}/g)).toHaveLength(2);
    expect(page).toMatch(/<pre role="region"[^>]*tabIndex=\{0\}/);
    expect(read('src/styles/polish.css')).toMatch(/\.doc-table-wrap\s*\{[^}]*overflow-x:\s*auto/s);
    const favicon = read('src/tools/convert/FaviconTool.tsx');
    expect(favicon).toMatch(/<pre role="region" aria-label="HTML snippet[^>]*tabIndex=\{0\}/);
    expect(favicon).toMatch(/<pre role="region" aria-label="Web manifest[^>]*tabIndex=\{0\}/);
    expect(read('src/tools/inspect/FileInspectorTool.tsx')).toMatch(/<pre className="textarea" role="region"[^>]*tabIndex=\{0\}/);
  });
});
