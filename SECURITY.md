# Security model

ZeroUpload's promise is narrow and checkable: **file contents are not transmitted**. Everything else about
security is ordinary browser application hygiene, and this document describes what is actually enforced.

## What is guaranteed

* No upload endpoint exists. The application is a static bundle with no API client for file data.
* No analytics, telemetry, remote logging, or third-party scripts are loaded at runtime.
* Fonts are self-hosted and bundled (no Google Fonts request).
* Source maps are disabled in production builds.
* File data lives in memory (and in Blob URLs) inside the tab. Closing the tab discards it.

Verification: open DevTools → Network, process a file, observe that no request carries file bytes. The full
source is public; the build has no server component.

## Threats considered

| Threat | Mitigation |
| --- | --- |
| Extension spoofing (e.g. malware named `.pdf`) | Magic-byte sniffing; declared vs detected type shown; mismatches surfaced to the user |
| Malformed / corrupt files | Decoders wrapped in error handling; failures produce a `ToolError` with a readable message, never a silent no-op |
| Resource exhaustion (huge files) | Per-category size caps, 2D canvas decode guarded by dimension probes, hashing capped at 512 MB |
| ZIP bombs | Entry-count (5,000), expanded-size (512 MB), per-entry (256 MB) and compression-ratio (220×) ceilings |
| Path traversal in archives | Entry names normalised; `..` segments and absolute paths stripped; renames reported |
| Unsafe archive content | Extracted entries are never executed or auto-opened; they are offered as downloads only |
| SVG-borne scripts | SVG input is refused by every image tool |
| DOM injection | React escapes all interpolated strings; no `dangerouslySetInnerHTML` anywhere; file names are rendered as text |
| Object URL leaks | A single `useObjectUrl` hook creates and revokes every blob URL; downloads revoke after the save begins |
| Dependency compromise | Minimal dependency surface (`react`, `react-dom`, `react-router-dom`, `pdf-lib`, `fflate`); versions pinned via lockfile; no build-time remote fetches |
| Worker failure | Errors are propagated to the UI; the worker is terminated and recreated |

## Known limitations

* **Memory, not sandboxing.** A browser tab is a resource-constrained process. A crafted image can still
  exhaust memory within the size caps. The app will report the failure; it cannot prevent the browser from
  being briefly busy.
* **No integrity guarantee of the deployment.** If the hosted bundle were modified by whoever controls the
  host, it could exfiltrate files. Hosting from a fork you control, or building locally, is the mitigation.
* **Password-protected PDFs are rejected**, not cracked.
* **Downloaded content is untrusted.** ZeroUpload does not scan archives or files for malware — it cannot.
* **`File.type` is advisory.** It is derived from the extension by the browser; that is exactly why signature
  checks exist.

## Reporting

Please open a GitHub issue for non-sensitive reports. For anything that could be actively exploited, use
GitHub's private vulnerability reporting on this repository instead of a public issue.
