# Project review: pages, tools and presentation

Review date: 7 November 2026. Status: working review, not a release approval. See `ux-polish-plan.md` for the checkpoint list and test evidence.

## Overall assessment

The local-first premise is clear, the catalogue and categories expose 20 available tools, and the shared workspace, related links, limits and FAQs give each tool a consistent structure. The main opportunity is not simply adding more tools: it is helping people choose a compatible action, understand the output, and move between tasks without losing context. Tool pages also need their loaded, error and result states checked as carefully as their empty states.

## Findings addressed in this review

- **Responsive workspace:** the settings footer cascade showed two primary actions on desktop and accidentally overrode mobile dock spacing. Tall sticky sidebars could extend beyond a laptop viewport. Corrected the cascade and put settings in normal document flow so controls remain reachable.
- **Mobile discovery and controls:** catalogue category links now wrap rather than disappearing inside a scrollbar-free strip; the tall mobile catalogue controls no longer remain sticky. Header actions and file-manifest actions have larger phone targets, with file actions placed below the filename when needed.
- **Clarity and consistency:** the search count says “x of y tools”; crop and rotate no longer present two competing primary actions before processing. Equal-size results no longer say “0% smaller,” and small image-to-PDF outputs use meaningful byte units and singular page labels.
- **Accessibility and trust:** fixed low-contrast file-order numbers and category-guide links, labelled the Base64 file-output preview, made the architecture diagram keyboard-scrollable, and aligned the search trigger's visible label and accessible name. Clarified that opening tools can load code over the network, while file contents stay local; corrected overly broad image-quality wording.
- **Regression coverage:** added `npm run test:browser-layout` for repeatable initial-route and representative loaded-state viewport checks, as well as targeted DOM and CSS tests. The browser binary is supplied separately.

## Suggested additions, not implemented

1. **Result-to-next-tool handoff:** offer an explicit “Use result in…” action where the output is compatible (for example, convert then compress). Explain which version is passed, keep it in memory only, and don't silently change the original. This extends the existing inspector handoff rather than creating a background file history.
2. **Format and capability guide:** a concise, searchable compatibility matrix for input formats, output formats, size limits, batch support and browser-dependent encoders. Generate it from shared metadata where practical to prevent marketing text drifting from real validation.
3. **PDF page management:** investigate visual page reordering/removal with accessible keyboard alternatives and bounded thumbnail rendering. It fills a gap between whole-document merge and page-range extraction, but needs careful memory limits and document-structure testing.
4. **Metadata privacy tools:** explore a local metadata viewer/stripper with an explicit before/after report. Start with formats that can be handled reliably and document that re-encoding can affect quality, orientation or colour profiles.
5. **Useful local preferences:** consider remembering non-sensitive choices such as a preferred image output format, with a clear reset. Do not persist files, passwords, or file contents by default.

Prioritise validation and user research before committing to any new tool. Feature ideas above are proposals, not claims that the project currently supports them.

## Remaining quality risks and checks

- Chromium checks do not substitute for Safari, Firefox, actual iOS/Android touch devices, browser zoom, keyboard-only workflows across all tools, or screen-reader testing. Automated accessibility scans cannot certify accessibility or visual contrast in every dynamic state.
- Not every result, password variant, large/batch job, cancellation, malformed file, drag-and-drop path, clipboard permission failure, or downloaded artifact has been exercised at every size. Continue representative failure/recovery and cross-browser testing before release.
- Review responsive layout and visual hierarchy with the user in the live preview. Keep final readiness and deployment checkpoints open until all outstanding checks and explicit agreement are complete.

## Repeating the responsive check

Run `npm run build`, start the site with `npm run dev`, then run `BROWSER_PATH=/path/to/chromium npm run test:browser-layout`. Set `BASE_URL` if the server is not at `http://localhost:5173`; optional comma-separated `BROWSER_ARGS` are passed to Chromium. The script checks the sitemap routes and 404 at 13 viewport/device-scale combinations through 4K and loads long-named fixture files in representative tools at five sizes. It checks viewport boundaries, visible category links, duplicate settings footers and uncaught page errors; it does not judge aesthetics, all nested clipping, or all interactions.
