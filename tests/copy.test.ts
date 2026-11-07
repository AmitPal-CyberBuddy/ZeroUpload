import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, TOOLS } from '../src/registry/tools';
import { TOOL_CONTENT } from '../src/seo/toolContent';
import { BATCH_BUDGETS, OPERATION_BUDGETS } from '../src/lib/files/budget';
import { formatBytes } from '../src/lib/files/format';
import { DEFAULT_LIMITS } from '../src/lib/zip/limits';

/**
 * The prose under each tool has to describe the tool that exists.
 *
 * This file exists because it stopped being true: the image converter, resizer
 * and rotator gained batch mode and their pages carried on saying "One image up to
 * 120 MB" for two releases. Nothing failed, because nothing was checking. These
 * assertions are cheap and they fail on exactly that class of drift: a capability
 * in the code that the page does not mention, or a limit on the page that the
 * code no longer uses.
 *
 * They read source text rather than importing components, so they stay in the
 * Node suite and do not need a DOM.
 */

const ROOT = process.cwd();

/** `src/registry/toolComponents.ts` is the one place that maps a slug to a file. */
function componentFiles(): Map<string, string> {
  const source = readFileSync(join(ROOT, 'src/registry/toolComponents.ts'), 'utf8');
  const map = new Map<string, string>();
  for (const match of source.matchAll(/'([a-z0-9-]+)':\s*\(\)\s*=>\s*import\('([^']+)'\)/g)) {
    map.set(match[1], `src/${match[2].replace(/^\.\.\//, '')}.tsx`);
  }
  return map;
}

const FILES = componentFiles();
const prose = (slug: string) =>
  [TOOL_CONTENT[slug].summary, ...TOOL_CONTENT[slug].does, ...TOOL_CONTENT[slug].limits].join(' ');

describe('the copy under a tool page', () => {
  it('exists for every tool in the registry, and only those', () => {
    // ALL_TOOLS, not TOOLS: a flagged tool is still a page the moment the flag is
    // switched on, and its prose should be waiting for it.
    const slugs = new Set(TOOLS.map((tool) => tool.slug));
    for (const slug of slugs) expect(TOOL_CONTENT[slug], `no prose for "${slug}"`).toBeTruthy();

    const all = new Set(ALL_TOOLS.map((tool) => tool.slug));
    for (const slug of Object.keys(TOOL_CONTENT)) expect(all.has(slug), `prose for unknown "${slug}"`).toBe(true);
  });

  it('has all four parts, none of them empty', () => {
    for (const [slug, content] of Object.entries(TOOL_CONTENT)) {
      expect(content.summary.length, slug).toBeGreaterThan(40);
      expect(content.does.length, slug).toBeGreaterThanOrEqual(2);
      expect(content.limits.length, slug).toBeGreaterThanOrEqual(2);
      expect(content.faq.length, slug).toBeGreaterThanOrEqual(2);
    }
  });

  it('states the batch ceiling wherever the tool actually supports a batch', () => {
    const budget = BATCH_BUDGETS.image;
    // "50 images" and "300 MB", the same numbers the queue enforces.
    const ceiling = `${budget.maxItems} images`;
    const bytes = formatBytes(budget.maxBytes);

    const batchTools = [...FILES.entries()]
      .filter(([, file]) => {
        try {
          return readFileSync(join(ROOT, file), 'utf8').includes('useImageBatch');
        } catch {
          return false;
        }
      })
      .map(([slug]) => slug)
      .filter((slug) => TOOL_CONTENT[slug]);

    // Not a hard-coded list: if a tool gains batch mode, this test starts
    // requiring the sentence. If it loses it, the sentence is caught by the
    // length check above only if the tool were edited — which is the point.
    expect(batchTools.length).toBeGreaterThan(0);
    for (const slug of batchTools) {
      const text = prose(slug);
      expect(text, `${slug} supports batch but never says how many`).toMatch(/\bbatch\b/i);
      expect(text, `${slug} does not state ${ceiling}`).toContain(ceiling);
      expect(text, `${slug} does not state ${bytes}`).toContain(bytes);
    }
  });

  it('does not promise a batch to a tool that has none', () => {
    const batchTools = new Set(
      [...FILES.entries()]
        .filter(([, file]) => readFileSync(join(ROOT, file), 'utf8').includes('useImageBatch'))
        .map(([slug]) => slug),
    );
    for (const slug of Object.keys(TOOL_CONTENT)) {
      if (batchTools.has(slug)) continue;
      expect(prose(slug), `${slug} mentions a batch it does not have`).not.toMatch(/\bbatch\b/i);
    }
  });

  it('quotes the ZIP limits the reader enforces', () => {
    const text = prose('extract-zip');
    expect(text).toContain(DEFAULT_LIMITS.maxEntries.toLocaleString('en-US'));
    expect(text).toContain(formatBytes(DEFAULT_LIMITS.maxTotalBytes));
    expect(text).toContain(formatBytes(DEFAULT_LIMITS.maxEntryBytes));
  });

  it('writes numbers the way the app writes them', () => {
    /*
     * `formatBytes` and `toLocaleString` produce "2,000" and "512 MB"; the prose
     * used to produce "2 000" with a thin space. Same site, two ways of writing
     * one number — which reads as two different numbers at a glance.
     */
    for (const [slug, content] of Object.entries(TOOL_CONTENT)) {
      const text = [content.summary, ...content.does, ...content.limits, ...content.faq.flatMap((f) => [f.q, f.a])].join(' ');
      expect(text, `${slug} groups digits with a space`).not.toMatch(/\d\s\d{3}\b/);
    }
  });

  it('quotes the PDF merge and images-to-PDF budgets', () => {
    const merge = prose('merge-pdf');
    expect(merge).toContain(String(OPERATION_BUDGETS.pdfMerge.maxItems));
    expect(merge).toContain(formatBytes(OPERATION_BUDGETS.pdfMerge.maxBytes));

    const images = prose('images-to-pdf');
    expect(images).toContain(String(OPERATION_BUDGETS.imagesToPdf.maxItems));
    expect(images).toContain(formatBytes(OPERATION_BUDGETS.imagesToPdf.maxBytes));
  });

  it('quotes the encrypted-archive budget as well as the plain one', () => {
    // The number that changes when someone tunes memory use: both must move
    // together, or the warning before creation describes the wrong ceiling.
    const text = prose('create-zip');
    expect(text).toContain(formatBytes(OPERATION_BUDGETS.zipCreateEncrypted.maxBytes));
    expect(text).toContain(String(OPERATION_BUDGETS.zipCreateEncrypted.maxItems));
    expect(text).toContain(formatBytes(OPERATION_BUDGETS.zipCreate.maxBytes));
  });

  it('asks each question once per page', () => {
    for (const [slug, content] of Object.entries(TOOL_CONTENT)) {
      const questions = content.faq.map((entry) => entry.q.toLowerCase());
      expect(new Set(questions).size, `${slug} repeats a question`).toBe(questions.length);
    }
  });

  it('writes FAQ answers that are longer than the question', () => {
    // Catches the placeholder that reads fine in review and useless in a page.
    for (const [slug, content] of Object.entries(TOOL_CONTENT)) {
      for (const entry of content.faq) {
        expect(entry.a.length, `${slug}: "${entry.q}"`).toBeGreaterThan(entry.q.length);
      }
    }
  });
});

describe('claims on the marketing pages', () => {
  const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

  it('does not describe hash routing, which the app does not use', () => {
    for (const file of ['src/pages/ArchitecturePage.tsx', 'README.md', 'docs/architecture.md']) {
      const text = read(file);
      expect(text, file).not.toMatch(/hash rout|HashRouter|hash history/i);
    }
  });

  it('describes the deployment the workflow actually performs', () => {
    const workflow = read('.github/workflows/deploy.yml');
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm run build');
    // The order matters: the tests that read `dist` must run after the build.
    expect(workflow.indexOf('npm run build')).toBeLessThan(workflow.indexOf('npm test'));
  });

  it('says where a visitor can check the privacy claim', () => {
    expect(read('src/pages/ArchitecturePage.tsx')).toContain('Watch the network tab');
  });
});
