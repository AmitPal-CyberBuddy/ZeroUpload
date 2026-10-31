import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTool } from '../../registry/tools';
import { ToolLayout } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { Notice, CopyButton } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { takeHandoff } from '../../lib/files/handoff';
import { humanFileType, isProbablyText, mimeFromExtension, sniffFileType, type TypeSignature } from '../../lib/files/mime';
import { assertWithinSize, toToolError } from '../../lib/files/errors';
import { formatBytes, formatCount, formatDuration } from '../../lib/files/format';
import { probeImage } from '../../lib/image/capabilities';
import { hashBuffer, MAX_HASH_BYTES } from '../../lib/hash/hash';
import { useToast } from '../../hooks/useToast';

const tool = getTool('file-inspector')!;

interface Inspection {
  file: File;
  signature: TypeSignature | null;
  declaredType: string;
  image?: { width: number; height: number };
  pdfPages?: number;
  zipEntries?: number;
  textPreview?: string;
  lineCount?: number;
  mismatch: boolean;
}

function suggestTools(inspection: Inspection): { slug: string; label: string }[] {
  const type = inspection.signature?.type ?? inspection.declaredType;
  const suggestions: { slug: string; label: string }[] = [];
  if (type.startsWith('image/')) {
    suggestions.push({ slug: 'image-compressor', label: 'Compress this image' });
    suggestions.push({ slug: 'image-converter', label: 'Convert format' });
    suggestions.push({ slug: 'resize', label: 'Resize' });
  } else if (type === 'application/pdf') {
    suggestions.push({ slug: 'merge-pdf', label: 'Merge with another PDF' });
    suggestions.push({ slug: 'split-pdf', label: 'Split or extract pages' });
    suggestions.push({ slug: 'rotate-pdf', label: 'Rotate pages' });
  } else if (type === 'application/zip') {
    suggestions.push({ slug: 'extract-zip', label: 'Open this archive' });
  } else if (inspection.textPreview !== undefined) {
    suggestions.push({ slug: 'json-formatter', label: 'Format JSON' });
    suggestions.push({ slug: 'hash-generator', label: 'Hash its text' });
    suggestions.push({ slug: 'base64', label: 'Base64 encode' });
  } else {
    suggestions.push({ slug: 'create-zip', label: 'Bundle it into a ZIP' });
  }
  return suggestions;
}

export default function FileInspectorTool() {
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [hash, setHash] = useState<{ value: string; ms: number } | null>(null);
  const [hashing, setHashing] = useState(false);
  const handoffConsumed = useRef(false);
  const { toast } = useToast();

  const inspect = async (file: File) => {
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
          next.pdfPages = (await describePdf(await file.arrayBuffer())).length;
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

      setInspection(next);
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
    } finally {
      setBusy(false);
    }
  };

  // Files dropped on the homepage land here.
  useEffect(() => {
    if (handoffConsumed.current) return;
    const pending = takeHandoff();
    handoffConsumed.current = true;
    if (pending[0]) void inspect(pending[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewUrl = useObjectUrl(inspection?.image ? inspection.file : null);

  const computeHash = async () => {
    if (!inspection) return;
    if (inspection.file.size > MAX_HASH_BYTES) {
      setError({
        message: 'This file is too large to hash in a tab.',
        hint: 'WebCrypto has no streaming digest, so the whole file must fit in memory. Split the file first.',
      });
      return;
    }
    setHashing(true);
    try {
      const started = performance.now();
      const value = await hashBuffer(await inspection.file.arrayBuffer(), 'SHA-256');
      setHash({ value, ms: performance.now() - started });
      toast('SHA-256 computed on-device', 'success');
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
    } finally {
      setHashing(false);
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
              onFiles={(files) => inspect(files[0])}
              title={busy ? 'Reading file locally…' : 'Drop any file to inspect it'}
              hint="Type is determined from the file's bytes, not its extension. Hashing is optional and uses WebCrypto."
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
            <div className="tool-notes">
              <div>
                <Icon name="shield" size={15} />
                <strong>Extension spoofing</strong>
                <p>
                  A file named <code>invoice.pdf</code> that is really an executable will be reported as such,
                  because the first bytes are checked directly.
                </p>
              </div>
              <div>
                <Icon name="lock" size={15} />
                <strong>WebCrypto hashing</strong>
                <p>
                  SHA-256 runs through <code>crypto.subtle</code>. The digest is displayed and copied locally,
                  never transmitted.
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="row row--between row--wrap">
              <span className="section-title">File</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setInspection(null); setHash(null); }}>
                <Icon name="x" size={13} /> Inspect another
              </button>
            </div>

            <FileCard
              file={inspection.file}
              onRemove={() => { setInspection(null); setHash(null); }}
              subtitle={inspection.image ? `${inspection.image.width} × ${inspection.image.height}px` : undefined}
            />

            {inspection.mismatch ? (
              <Notice tone="warn" title="Extension does not match content">
                The browser reports {inspection.file.type}, but the bytes are {inspection.signature?.type}.
              </Notice>
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
                    <span className="hint">Computed in {formatDuration(hash.ms)} using SHA-256 via WebCrypto.</span>
                  </>
                ) : (
                  <div className="row row--between row--wrap">
                    <span className="hint" style={{ maxWidth: '52ch' }}>
                      SHA-256 needs the whole file in memory, so files above 512 MB are refused rather than
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

            {inspection.textPreview !== undefined ? (
              <div className="editor-pane">
                <div className="editor-pane__head">
                  <span>Text preview</span>
                  <span>first 2 KB</span>
                </div>
                <pre className="textarea" style={{ height: 180, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                  {inspection.textPreview}
                </pre>
              </div>
            ) : null}

            <div className="settings">
              <div className="settings__head">
                <Icon name="wand" size={13} /> Next steps
              </div>
              <div className="settings__body">
                <div className="row row--wrap">
                  {suggestions.map((suggestion) => (
                    <Link key={suggestion.slug} to={`/tools/${suggestion.slug}`} className="btn btn--secondary btn--sm">
                      {suggestion.label} <Icon name="arrow-right" size={12} />
                    </Link>
                  ))}
                </div>
                <span className="hint">Suggested tools open empty — the file is not carried across automatically.</span>
              </div>
            </div>

            {error ? <Notice tone="danger" title="Something failed">{error.message}</Notice> : null}
          </>
        )}
      </div>
    </ToolLayout>
  );
}
