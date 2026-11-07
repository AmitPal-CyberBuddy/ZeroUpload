#!/usr/bin/env node
/**
 * Adds a Content-Security-Policy to every generated document.
 *
 * Why this belongs in the build rather than in a header: GitHub Pages cannot set
 * response headers, and this project deploys as a static export. `<meta
 * http-equiv>` is the only channel available, so the policy is written into each
 * document after prerendering, when the final set of inline scripts is known.
 *
 * The policy is the strongest one this app can actually run under, and every
 * directive below is a claim about how the app works:
 *
 *   connect-src 'none'   The product says nothing is uploaded. This is the
 *                        mechanism: no fetch, no XHR, no WebSocket, no beacon, no
 *                        EventSource. An injected script would find nowhere to send
 *                        anything. (`connect-src` is also the fallback for
 *                        `prefetch-src` and blocks ping.)
 *   script-src 'self'    Only the bundles this build emitted — plus one sha256 per
 *   + hashes             inline script (the pre-paint theme application).
 *   worker-src 'self'    The three engines run in module workers fetched from the
 *   blob:                same origin; `blob:` covers the fallback path that builds
 *                        a worker from a Blob URL if `new URL(..., import.meta.url)`
 *                        is not supported.
 *   img-src 'self'       Object URLs for previews, `data:` for the favicon tool's
 *   blob: data:          generated icons. No remote images anywhere.
 *   style-src 'self'     React writes inline `style` attributes (progress widths,
 *   'unsafe-inline'      inline SVG transforms). Inline *styles* cannot execute
 *                        script, so this is a formatting concession, not a hole;
 *                        the script directives above are the ones that matter.
 *   object-src 'none'    No plugins.
 *   form-action 'none'   There is no form to submit, and no endpoint to submit to.
 *   base-uri 'self'      Nobody can retarget relative URLs with an injected <base>.
 *
 * Two things are deliberately absent. `frame-ancestors` is ignored in a `<meta>`
 * policy, so including it would only look like protection — clickjacking framing
 * needs a real header from the host. `upgrade-insecure-requests` is unnecessary
 * when every URL in the app is same-origin and relative, and it would force the
 * HTTPS upgrade on a local `vite preview` over plain HTTP.
 *
 * Run: node scripts/csp.mjs   (last step of `npm run build`)
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
const MARKER = '<!--csp-->';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

/** Hash the contents of every inline `<script>` (no `src`) in a document. */
function inlineHashes(html) {
  const hashes = [];
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1];
    if (!body.trim()) continue;
    const digest = createHash('sha256').update(body, 'utf8').digest('base64');
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

function buildPolicy(hashes) {
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ');
}

const files = walk(DIST);
if (files.length === 0) {
  console.error('csp: no HTML documents found in dist — run the build first');
  process.exit(1);
}

let applied = 0;
let inlineTotal = 0;

for (const file of files) {
  let html = readFileSync(file, 'utf8');

  // Idempotent: a rebuild must not stack duplicate policies.
  html = html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/gi, '');

  const hashes = inlineHashes(html);
  inlineTotal = Math.max(inlineTotal, hashes.length);
  const policy = buildPolicy(hashes);
  const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;

  /*
   * Placement matters, and not in the way it first appears: a `<meta>` policy only
   * governs what comes *after* it in the document. Putting the tag at the end of
   * `<head>` — where it reads as "the last meta" — would leave the module script and
   * the theme bootstrap above it unenforced. It goes straight after `<meta charset>`,
   * which is the earliest legal spot and the one convention that keeps it ahead of
   * every script in the file.
   */
  const charset = /<meta charset="[^"]*"[^>]*>\s*/i.exec(html);
  if (!charset) {
    console.error(`csp: ${file} has no <meta charset> to anchor the policy to`);
    process.exit(1);
  }
  const at = charset.index + charset[0].length;
  html = `${html.slice(0, at)}    ${tag}\n${html.slice(at)}`;

  writeFileSync(file, html);
  applied += 1;
}

// A policy that silently matched no inline script would be a broken build: the
// theme script would then be blocked and every page would flash the wrong theme.
if (inlineTotal === 0) {
  console.error('csp: no inline scripts were hashed — the policy would break the theme bootstrap');
  process.exit(1);
}

console.log(`csp ok · ${applied} documents · up to ${inlineTotal} inline script hashes each · connect-src 'none'`);
void MARKER;
