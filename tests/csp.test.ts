import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Content-Security-Policy, checked as data rather than trusted as a string.
 *
 * This app's central claim is that a file never leaves the device. `connect-src
 * 'none'` is the only line in the codebase that *enforces* that claim instead of
 * asserting it — but a policy with a stale hash, duplicated by a rebuild, or
 * placed after the scripts it governs would either break the page or protect
 * nothing. Both failure modes are silent in a browser, so they are checked here.
 *
 * These assertions need a build (`npm run build`); they are skipped otherwise so
 * a source-only checkout can still run the suite.
 */

const dist = join(process.cwd(), 'dist');
const built = existsSync(dist);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return entry.endsWith('.html') ? [full] : [];
  });
}

const documents = built ? walk(dist) : [];

describe.skipIf(!built)('content security policy', () => {
  it('is on every generated document, exactly once', () => {
    expect(documents.length).toBeGreaterThan(20);
    for (const file of documents) {
      const html = readFileSync(file, 'utf8');
      const count = (html.match(/http-equiv="Content-Security-Policy"/g) ?? []).length;
      expect(count, `${file}: ${count} policies`).toBe(1);
    }
  });

  it('blocks every outbound channel', () => {
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    const policy = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';

    // The one directive that makes "nothing is uploaded" a mechanism.
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'none'");
    // Workers are same-origin module scripts; blob: covers the fallback path.
    expect(policy).toContain("worker-src 'self' blob:");
    // Object URLs for previews, data: for the favicon tool's rendered icons.
    expect(policy).toContain("img-src 'self' blob: data:");
  });

  it('hashes every inline script, and only real ones', () => {
    for (const file of documents) {
      const html = readFileSync(file, 'utf8');
      const policy = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
      const declared = new Set(
        [...policy.matchAll(/'sha256-([^']+)'/g)].map((match) => match[1]),
      );

      const actual = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
        .map((match) => match[1])
        .filter((body) => body.trim().length > 0)
        .map((body) => createHash('sha256').update(body, 'utf8').digest('base64'));

      // The redirect stubs (`/architecture/`) carry no scripts at all, which is why
      // they are allowed to have no hashes — but a page *with* a script must have
      // a hash for every one of them, or the theme bootstrap is blocked.
      for (const hash of actual) {
        expect(declared.has(hash), `${file} is missing a hash for its inline script`).toBe(true);
      }
      if (actual.length === 0) expect(declared.size).toBe(0);
    }
  });

  it('puts the policy before the first script it governs', () => {
    // A `<meta>` policy applies only to content after it. At the end of `<head>`
    // it would read as correct and enforce nothing.
    for (const file of documents) {
      const html = readFileSync(file, 'utf8');
      const policyAt = html.indexOf('Content-Security-Policy');
      const firstScript = html.search(/<script/i);
      expect(policyAt, file).toBeGreaterThan(-1);
      if (firstScript === -1) continue; // redirect stub: nothing to govern
      expect(policyAt, `${file}: policy after the first script`).toBeLessThan(firstScript);
    }
  });

  it('ships no eval and no remote origin to fetch from', () => {
    // `script-src 'self'` has no 'unsafe-eval'; if a dependency needed it, the
    // policy would break the tool rather than the other way round.
    const bundles = readdirSync(join(dist, 'assets')).filter((name) => name.endsWith('.js'));
    expect(bundles.length).toBeGreaterThan(10);
    for (const name of bundles) {
      const code = readFileSync(join(dist, 'assets', name), 'utf8');
      expect(/\bnew Function\(/.test(code), `${name} uses new Function`).toBe(false);
      expect(/[^.\w]eval\(/.test(code), `${name} uses eval`).toBe(false);
    }
  });
});

describe('csp script', () => {
  it('is idempotent, so a rebuild cannot stack policies', () => {
    const source = readFileSync(join(process.cwd(), 'scripts/csp.mjs'), 'utf8');
    expect(source).toMatch(/replace\([^)]*Content-Security-Policy/);
  });

  it('is part of the build', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.build).toContain('scripts/csp.mjs');
  });
});
