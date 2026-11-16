import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { ToolLayout } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { Notice, CopyButton } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { setHandoff, takeHandoff } from '../../lib/files/handoff';
import { humanFileType, isProbablyText, mimeFromExtension, sniffFileType, type TypeSignature } from '../../lib/files/mime';
import { assertWithinSize, toToolError } from '../../lib/files/errors';
import { formatBytes, formatCount, formatDuration } from '../../lib/files/format';
import { probeImage } from '../../lib/image/capabilities';
import { detectFile } from '../../lib/capabilities/detect';
import { MAX_STREAM_HASH_BYTES, streamHash } from '../../lib/hash/stream';
import { useToast } from '../../hooks/useToast';
import { CompareFiles } from './CompareFiles';
import { FindingList } from '../../components/tool/FindingList';
import { type Insight } from '../../lib/inspect/findings';
import { toolDefinition } from '../../registry/useToolDefinition';

const tool = toolDefinition('file-inspector');

export interface Inspection {
  file: File;
  signature: TypeSignature | null;
  declaredType: string;
  image?: { width: number; height: number };
  pdfPages?: number;
  zipEntries?: number;
  textPreview?: string;
  lineCount?: number;
  mismatch: boolean;
  /**
   * What the byte scan found. Optional because the type is also constructed in
   * tests and by the handoff path, where no scan has run — `suggestTools` then
   * falls back to the type-based ladder it always had.
   */
  insight?: Insight;
}

/**
 * What this file makes worth doing next.
 *
 * Two layers, in that order:
 *
 *  1. The scan's own `next` list. It knows things the type does not — that a PDF
 *     carries an /OpenAction script, that an archive has a traversal path, that an
 *     image has bytes appended after its end marker — so its suggestions are
 *     specific to *this* file and carry a reason.
 *  2. A type-based ladder, used when no scan has run (a test, a handoff) or when
 *     the scan produced nothing actionable. Kept identical to what it was, because
 *     `tests/dom/handoff.test.tsx` asserts it.
 *
 * A slug is emitted once: the first claim wins, which is why the scan comes first.
 */
export function suggestTools(inspection: Inspection): { slug: string; label: string; why?: string }[] {
  const fromScan = inspection.insight?.next ?? [];
  const seen = new Set(fromScan.map((step) => step.slug));
  const suggestions: { slug: string; label: string; why?: string }[] = fromScan.map((step) => ({
    slug: step.slug,
    label: step.label,
    why: step.why,
  }));

  const type = inspection.signature?.type ?? inspection.declaredType;
  const push = (slug: string, label: string) => {
    if (seen.has(slug)) return;
    seen.add(slug);
    suggestions.push({ slug, label });
  };

  if (/\.xlsx$/i.test(inspection.file.name) && inspection.file.size <= 10 * 1024 * 1024 && inspection.signature?.type === 'application/zip') {
    push('xlsx-to-csv', 'Export a sheet to CSV');
  } else if (['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/bmp'].includes(type) && (inspection.file.type || mimeFromExtension(inspection.file.name)).startsWith('image/')) {
    push('image-compressor', 'Compress this image');
    push('image-converter', 'Convert format');
    push('resize', 'Resize');
  } else if (type === 'application/pdf' && (inspection.file.type === 'application/pdf' || /\.pdf$/i.test(inspection.file.name))) {
    push('pdf-editor', 'Edit this PDF');
    push('merge-pdf', 'Merge with another PDF');
    push('split-pdf', 'Split or extract pages');
    push('rotate-pdf', 'Rotate pages');
  } else if (type === 'application/zip' && (inspection.file.type === 'application/zip' || /\.zip$/i.test(inspection.file.name))) {
    push('extract-zip', 'Open this archive');
  } else {
    if (inspection.textPreview !== undefined && inspection.file.size <= 512 * 1024 &&
        (type === 'application/json' || /\.json$/i.test(inspection.file.name))) {
      push('json-formatter', 'Format this JSON');
    }
    if (inspection.textPreview !== undefined && inspection.file.size <= 10 * 1024 * 1024) {
      push('base64', 'Encode this file as Base64');
    }
    push('create-zip', 'Bundle it into a ZIP');
  }
  return suggestions.slice(0, inspection.insight ? 5 : 4);
}

export default function FileInspectorTool() {
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState(false);
  /** True while the byte scan is running, after the facts are already on screen. */
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [hash, setHash] = useState<{ value: string; ms: number } | null>(null);
  const [hashing, setHashing] = useState(false);
  const [comparisonFile, setComparisonFile] = useState<File | null>(null);
  const hashRequest = useRef(0);
  const handoffConsumed = useRef(false);
  const { toast } = useToast();

  const inspect = async (file: File, second: File | null = null) => {
    hashRequest.current += 1; setHashing(false); setComparisonFile(second);
    setError(null);
    setHash(null);
    setInspection(null);
    setBusy(true);
    try {
      assertWithinSize(file, file.type.startsWith('text/') || isProbablyText(file) ? 'text' : 'zip');
      const signature = await sniffFileType(file);
      const declaredType = file.type || mimeFromExtension(file.name);
      const next: Inspection = {
        file,
        signature,
        declaredType,
        mismatch: !!signature && !!file.type && signature.type !== file.type,
      };

      if ((signature?.type ?? declaredType).startsWith('image/')) {
        const size = await probeImage(file);
        if (size) next.image = size;
      }

      if (signature?.type === 'application/pdf' || declaredType === 'application/pdf') {
        try {
          const { describePdf } = await import('../../lib/pdf/pdf');
          next.pdfPages = (await describePdf(file)).length;
        } catch {
          next.pdfPages = undefined;
        }
      }

      if (signature?.type === 'application/zip') {
        try {
          const { readZip } = await import('../../lib/zip/zip');
          const archive = await readZip(file);
          next.zipEntries = archive.entries.length;
        } catch {
          next.zipEntries = undefined;
        }
      }

      if (isProbablyText(file) && file.size <= 512 * 1024) {
        const text = await file.slice(0, 2048).text();
        next.textPreview = text;
        next.lineCount = (await file.text()).split('\n').length;
      }

      /*
       * Facts first, scan second.
       *
       * The panel that matters — name, size, type, hash — is known before the
       * scan starts, and the scan can take a second on a large PDF. Painting the
       * facts immediately and patching the findings in when they arrive keeps the
       * page honest about progress instead of showing the drop zone for a second
       * after the file has clearly been accepted.
       */
      setInspection(next);
      setScanning(true);

      const family = await detectFile(file).then((detected) => detected.family).catch(() => 'unknown' as const);
      const { scanFile } = await import('../../lib/inspect/scan');
      const insight = await scanFile({
        name: file.name,
        size: file.size,
        family,
        declaredType,
        imageSize: next.image,
        readHead: async (limit) => new Uint8Array(await file.slice(0, limit).arrayBuffer()),
        readTail: async (limit) => new Uint8Array(await file.slice(Math.max(0, file.size - limit)).arrayBuffer()),
      });
      // Only if this is still the file on screen: a second drop while the first
      // scan is running must not attach its findings to the wrong report.
      setInspection((current) => (current && current.file === file ? { ...current, insight } : current));
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
    } finally {
      setBusy(false);
      setScanning(false);
    }
  };

  // Files dropped on the homepage land here.
  useEffect(() => {
    if (handoffConsumed.current) return;
    const pending = takeHandoff('file-inspector');
    handoffConsumed.current = true;
    if (pending[0]) void inspect(pending[0]);
    /*
     * Mount-only on purpose: a handoff is a one-shot event, and re-running this
     * for a new `inspect` identity would consume an empty slot and be a no-op.
     * `inspect` is defined in this component and reads only state setters, so it
     * is stable in practice even though it is not memoised. Without a linter in
     * the project (see docs/platform-review.md) this note is the guard.
     */
  }, []);

  const previewUrl = useObjectUrl(inspection?.image ? inspection.file : null);

  const computeHash = async () => {
    if (!inspection) return;
    if (inspection.file.size > MAX_STREAM_HASH_BYTES) {
      setError({
        message: 'This file is too large to hash here.',
        hint: `Hashing is limited to ${MAX_STREAM_HASH_BYTES / (1024 * 1024 * 1024)} GB per file. Split it first, then hash the parts.`,
      });
      return;
    }
    const request = ++hashRequest.current;
    setHashing(true);
    try {
      const started = performance.now();
      const value = await streamHash(inspection.file, 'SHA-256');
      if (request !== hashRequest.current) return;
      setHash({ value, ms: performance.now() - started });
      toast('SHA-256 computed on-device', 'success');
    } catch (err) {
      if (request !== hashRequest.current) return;
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
    } finally {
      if (request === hashRequest.current) setHashing(false);
    }
  };

  const rows = useMemo(() => {
    if (!inspection) return [];
    const { file, signature, declaredType } = inspection;
    return [
      { key: 'Name', value: file.name },
      { key: 'Size', value: `${formatBytes(file.size)} · ${file.size.toLocaleString()} bytes` },
      { key: 'Detected type', value: signature ? `${signature.label} (${signature.type})` : `${humanFileType(declaredType)} — signature not recognised` },
      { key: 'Declared type', value: declaredType || 'none' },
      { key: 'Extension', value: file.name.includes('.') ? `.${file.name.split('.').pop()}` : 'none' },
      { key: 'Last modified', value: new Date(file.lastModified).toLocaleString() },
      ...(inspection.image
        ? [{ key: 'Dimensions', value: `${inspection.image.width} × ${inspection.image.height} px · ${(inspection.image.width * inspection.image.height / 1_000_000).toFixed(1)} MP` }]
        : []),
      ...(inspection.pdfPages !== undefined ? [{ key: 'PDF pages', value: formatCount(inspection.pdfPages, 'page') }] : []),
      ...(inspection.zipEntries !== undefined ? [{ key: 'ZIP entries', value: formatCount(inspection.zipEntries, 'entry', 'entries') }] : []),
      ...(inspection.lineCount !== undefined ? [{ key: 'Text lines', value: inspection.lineCount.toLocaleString() }] : []),
    ];
  }, [inspection]);

  const suggestions = inspection ? suggestTools(inspection) : [];

  return (
    <ToolLayout tool={tool}>
      <div className="tool-body">
        {!inspection ? (
          <>
            <FileDrop
              accept={undefined}
              multiple
              maxFiles={2}
              onFiles={(files) => inspect(files[0], files[1] ?? null)}
              title={busy ? 'Reading file locally…' : 'Drop any file to inspect it'}
              hint="Choose one file to inspect, or two to compare. If you select more, only the first two are used. Everything stays on your device."
              icon="inspect"
              disabled={busy}
            />
            {busy ? <div className="progress progress--indeterminate"><div className="progress__bar" /></div> : null}
            {error ? (
              <Notice tone="danger" title="Could not inspect this file">
                {error.message}
                {error.hint ? <div className="hint">{error.hint}</div> : null}
              </Notice>
            ) : null}
            <div className="workspace-notes">
              <div>
                <Icon name="shield" size={15} />
                <strong>Names can lie</strong>
                <p>
                  A file called <code>invoice.pdf</code> that is really something else is reported as what it
                  is, because the contents are checked rather than the name.
                </p>
              </div>
              <div>
                <Icon name="lock" size={15} />
                <strong>Digest stays with you</strong>
                <p>
                  A SHA-256 digest is computed on your device for comparison and copying. It is never
                  transmitted.
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="row row--between row--wrap">
              <span className="section-title">File</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => { hashRequest.current += 1; setHashing(false); setInspection(null); setHash(null); setComparisonFile(null); }}>
                <Icon name="x" size={13} /> Inspect another
              </button>
            </div>

            <FileCard
              file={inspection.file}
              onRemove={() => { hashRequest.current += 1; setHashing(false); setInspection(null); setHash(null); setComparisonFile(null); }}
              subtitle={inspection.image ? `${inspection.image.width} × ${inspection.image.height}px` : undefined}
            />

            {inspection.mismatch ? (
              <Notice tone="warn" title="Extension does not match content">
                The browser reports {inspection.file.type}, but the bytes are {inspection.signature?.type}.
              </Notice>
            ) : null}

            {/* The report sits above the facts: severity first, details after. */}
            {inspection.insight ? (
              <FindingList insight={inspection.insight} title="What this file tells a reader to do" />
            ) : scanning ? (
              <div className="findings findings--pending" role="status">
                <div className="settings__head findings__head">
                  <Spinner />
                  <span>Scanning the bytes</span>
                </div>
                <div className="settings__body findings__body">
                  <p className="findings__clean">
                    Reading the structure — objects, streams, entry names — for behaviour that runs when the file
                    is opened. This happens on your device.
                  </p>
                </div>
              </div>
            ) : null}

            {previewUrl ? (
              <div className="result__preview" style={{ maxHeight: 280 }}>
                <img src={previewUrl} alt="File preview" style={{ maxHeight: 280 }} />
              </div>
            ) : null}

            <div className="kv">
              {rows.map((row) => (
                <div className="kv__row" key={row.key}>
                  <span className="kv__key">{row.key}</span>
                  <span className="kv__value">{row.value}</span>
                </div>
              ))}
            </div>

            <div className="settings">
              <div className="settings__head">
                <Icon name="hash" size={13} /> Integrity
              </div>
              <div className="settings__body">
                {hash ? (
                  <>
                    <div className="hash-block">
                      <span>{hash.value}</span>
                      <CopyButton value={hash.value} label="Copy digest" />
                    </div>
                    <span className="hint">Computed in {formatDuration(hash.ms)} with SHA-256, on your device.</span>
                  </>
                ) : (
                  <div className="row row--between row--wrap">
                    <span className="hint" style={{ maxWidth: '52ch' }}>
                      Hashing needs the whole file in memory, so files above 512 MB are refused rather than
                      risking a crash.
                    </span>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={computeHash} disabled={hashing}>
                      {hashing ? <Spinner /> : <Icon name="hash" size={13} />}
                      {hashing ? 'Hashing…' : 'Compute SHA-256'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <CompareFiles first={inspection.file} initial={comparisonFile} />

            {inspection.textPreview !== undefined ? (
              <div className="editor-pane">
                <div className="editor-pane__head">
                  <span>Text preview</span>
                  <span>first 2 KB</span>
                </div>
                <pre className="textarea" role="region" aria-label="File text preview" tabIndex={0} style={{ height: 180, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                  {inspection.textPreview}
                </pre>
              </div>
            ) : null}

            <div className="settings">
              <div className="settings__head">
                <Icon name="wand" size={13} /> Next steps
              </div>
              <div className="settings__body">
                <ul className="next-steps">
                  {suggestions.map((suggestion) => (
                    <li key={suggestion.slug} className="next-step">
                      <Link to={`/tools/${suggestion.slug}/`} className="btn btn--secondary btn--sm"
                        onClick={(event) => {
                          if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                            setHandoff([inspection.file], suggestion.slug);
                          }
                        }}
                      >
                        {suggestion.label} <Icon name="arrow-right" size={12} />
                      </Link>
                      {suggestion.why ? <span className="next-step__why">{suggestion.why}</span> : null}
                    </li>
                  ))}
                </ul>
                <Link to="/tools/" className="link-inline">Browse all tools <Icon name="arrow-right" size={12} /></Link>
                <span className="hint">Open a suggested action in this tab to carry your file over. Browsing all tools starts a fresh workspace.</span>
              </div>
            </div>

            {error ? <Notice tone="danger" title="Something failed">{error.message}</Notice> : null}
          </>
        )}
      </div>
    </ToolLayout>
  );
}
