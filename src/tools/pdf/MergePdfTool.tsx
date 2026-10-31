import { useRef, useState } from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileManifest, type ManifestItem } from '../../components/file/FileManifest';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { CompareSizes } from '../../components/tool/CompareSizes';
import { Notice } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { assertWithinSize, toToolError, ToolError } from '../../lib/files/errors';
import { formatCount } from '../../lib/files/format';
import { triggerDownload } from '../../lib/files/download';
import { pdfBytesToBlob } from '../../lib/pdf/pdf';
import { useToast } from '../../hooks/useToast';

const tool = getTool('merge-pdf')!;

interface MergeResult {
  blob: Blob;
  pages: number;
  bytes: number;
}

export default function MergePdfTool() {
  const [items, setItems] = useState<ManifestItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'reading' | 'processing' | 'done' | null>(null);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const counter = useRef(0);
  const { toast } = useToast();

  const addFiles = (files: File[]) => {
    const accepted: ManifestItem[] = [];
    for (const file of files) {
      try {
        assertWithinSize(file, 'pdf');
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        if (!isPdf) {
          throw new ToolError('unsupported-type', `${file.name} is not a PDF.`);
        }
        counter.current += 1;
        accepted.push({ id: `f${counter.current}`, file });
      } catch (err) {
        const toolError = toToolError(err);
        setError({ message: toolError.message, hint: toolError.hint });
      }
    }
    if (accepted.length) {
      setItems((prev) => [...prev, ...accepted]);
      setResult(null);
      setError(null);
    }
  };

  const move = (index: number, direction: -1 | 1) => {
    setItems((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setResult(null);
  };

  const merge = async () => {
    if (items.length < 2) {
      setError({ message: 'Add at least two PDFs to merge.', hint: 'A single file can be rotated or split instead.' });
      return;
    }
    setBusy(true);
    setError(null);
    setStage('reading');
    try {
      const payload = [];
      for (const item of items) {
        payload.push({ name: item.file.name, data: await item.file.arrayBuffer() });
      }
      setStage('processing');
      const { mergePdfs } = await import('../../lib/pdf/pdf');
      const bytes = await mergePdfs(payload);
      const blob = pdfBytesToBlob(bytes);
      const { PDFDocument } = await import('pdf-lib');
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      setResult({ blob, pages: doc.getPageCount(), bytes: blob.size });
      setStage('done');
      toast('PDFs merged locally', 'success');
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
      setStage(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolLayout
      tool={tool}
      aside={
        <Settings
          title="Output"
          footer={
            <button type="button" className="btn btn--primary btn--block" onClick={merge} disabled={busy || items.length < 2}>
              {busy ? <Spinner /> : <Icon name="pdf" size={14} />}
              {busy ? 'Merging…' : `Merge ${items.length || ''} PDFs`}
            </button>
          }
        >
          <div className="setting-row">
            <span className="field__hint">Documents</span>
            <span className="setting-value">{items.length}</span>
          </div>
          <div className="setting-row">
            <span className="field__hint">Total input</span>
            <span className="setting-value">{formatCount(items.length, 'file')}</span>
          </div>
          <Notice tone="default" icon="info">
            Pages are copied structurally — no rasterising, so text stays selectable and searchable.
          </Notice>
        </Settings>
      }
    >
      <div className="tool-body">
        <FileDrop
          accept="application/pdf,.pdf"
          multiple
          onFiles={addFiles}
          onError={(message) => setError({ message })}
          title={items.length ? 'Add more PDFs' : 'Drop PDFs to merge'}
          hint="Drop two or more documents. Use the arrows to set their order."
          icon="pdf"
          compact={items.length > 0}
          disabled={busy}
        />

        {error ? (
          <Notice tone="danger" title="Could not continue">
            {error.message}
            {error.hint ? <div className="hint">{error.hint}</div> : null}
          </Notice>
        ) : null}

        <FileManifest items={items} onMove={move} onRemove={(id) => { setItems((p) => p.filter((i) => i.id !== id)); setResult(null); }} />

        {stage ? (
          <StageTimeline
            stages={['Reading', 'Merging', 'Complete']}
            states={
              stage === 'reading'
                ? ['active', 'idle', 'idle']
                : stage === 'processing'
                  ? ['done', 'active', 'idle']
                  : ['done', 'done', 'done']
            }
          />
        ) : null}

        {result ? (
          <div className="result">
            <div className="result__head">
              <span className="result__title">
                <i className="dot" aria-hidden="true" />
                Merged · {result.pages} pages
              </span>
              <span className="badge">{formatCount(items.length, 'document')}</span>
            </div>
            <CompareSizes
              original={items.reduce((sum, item) => sum + item.file.size, 0)}
              output={result.bytes}
              originalLabel="Inputs"
              outputLabel="Merged"
            />
            <div className="result__actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => triggerDownload(result.blob, 'zeroupload-merged.pdf')}
              >
                <Icon name="download" size={15} /> Download merged PDF
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => { setItems([]); setResult(null); }}>
                Start over
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </ToolLayout>
  );
}
