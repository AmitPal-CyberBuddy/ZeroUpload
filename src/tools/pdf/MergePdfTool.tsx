import { useRef, useState } from 'react';
import { getTool } from '../../registry/tools';
import { RunAction } from '../../components/tool/RunAction';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileManifest, type ManifestItem } from '../../components/file/FileManifest';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { CompareSizes } from '../../components/tool/CompareSizes';
import { Notice } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Progress } from '../../components/ui/Progress';
import { assertWithinSize, toToolError, ToolError } from '../../lib/files/errors';
import { OPERATION_BUDGETS, assertCumulativeBudget } from '../../lib/files/budget';
import { formatBytes, formatCount } from '../../lib/files/format';
import { Outcome } from '../../components/tool/Outcome';
import { triggerDownload } from '../../lib/files/download';
import { useToast } from '../../hooks/useToast';
import { useRunControl } from '../../hooks/useRunControl';

const tool = getTool('merge-pdf')!;

interface MergeResult {
  blob: Blob;
  pages: number;
  bytes: number;
}

export default function MergePdfTool() {
  const [items, setItems] = useState<ManifestItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<'reading' | 'processing' | 'done' | null>(null);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  /*
   * Page counts, per file.
   *
   * `formatBytes` tells you a document is 8 MB; it does not tell you that it is
   * 40 pages, and page count is the number that decides whether this is the file
   * you meant to merge second. Counting costs one parse per document, so it
   * happens once on add, in the background, and a failure is silent — the merge
   * itself will report a broken file properly.
   */
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({});
  const counter = useRef(0);
  const { toast } = useToast();
  const runControl = useRunControl();

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
    if (!accepted.length) return;

    // Check the whole batch against the operation budget before keeping it, so
    // the user never builds a list that can only fail at merge time.
    const combined = [...items, ...accepted];
    try {
      assertCumulativeBudget(
        combined.map((item) => ({ name: item.file.name, size: item.file.size })),
        OPERATION_BUDGETS.pdfMerge,
      );
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
      return;
    }

    setItems(combined);
    setResult(null);
    setError(null);

    // Count pages after the list is accepted, so adding files never waits on it.
    for (const item of accepted) {
      void (async () => {
        try {
          const pdf = await import('../../lib/pdf/pdf');
          const pages = await pdf.describePdf(item.file);
          setPageCounts((prev) => ({ ...prev, [item.id]: pages.length }));
        } catch {
          /* a file the parser rejects will be reported by the merge itself */
        }
      })();
    }
  };

  const totalPages = items.reduce((sum, item) => sum + (pageCounts[item.id] ?? 0), 0);
  const counted = items.filter((item) => pageCounts[item.id] !== undefined).length;

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
    const signal = runControl.begin();
    setError(null);
    setProgress(0);
    setStage('reading');
    try {
      assertCumulativeBudget(
        items.map((item) => ({ name: item.file.name, size: item.file.size })),
        OPERATION_BUDGETS.pdfMerge,
      );
      setStage('processing');
      const { mergePdfs, pdfBytesToBlob } = await import('../../lib/pdf/pdf');
      // Documents are read one at a time inside the worker, not collected here.
      const merged = await mergePdfs(
        items.map((item) => ({ name: item.file.name, blob: item.file })),
        { onProgress: (ratio) => setProgress(ratio), signal },
      );
      const blob = pdfBytesToBlob(merged.bytes);
      setResult({ blob, pages: merged.pageCount, bytes: blob.size });
      setStage('done');
      toast('PDFs merged locally', 'success');
    } catch (err) {
      const toolError = toToolError(err);
      if (toolError.code === 'cancelled') {
        // Cancelling is a choice, not a failure: no error banner, no stale stage.
        setStage(null);
        toast('Cancelled — nothing was saved', 'default');
      } else {
        setError({ message: toolError.message, hint: toolError.hint });
        setStage(null);
      }
    } finally {
      runControl.finish();
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
            <RunAction
              label={items.length >= 2 ? `Merge ${items.length} PDFs` : 'Merge PDFs'}
              busyLabel="Merging…"
              icon="pdf"
              busy={busy}
              disabled={items.length < 2}
              onRun={merge}
              onCancel={runControl.cancel}
              cancellable={runControl.cancellable}
            />
          }
        >
          <Outcome
            rows={[
              { label: 'Documents', value: `${items.length}` },
              {
                label: 'Pages',
                value:
                  counted === items.length
                    ? `${totalPages}`
                    : counted === 0
                      ? 'counting…'
                      : `${totalPages} + ${items.length - counted} counting`,
              },
              {
                label: 'Input size',
                value: formatBytes(items.reduce((sum, item) => sum + item.file.size, 0)),
              },
              { label: 'Output', value: items.length >= 2 ? '1 merged PDF' : 'Add at least two' },
            ]}
            note="Pages are carried over as they are — not flattened into images — so text stays selectable and searchable."
          />
        </Settings>
      }
    >
      <div className="tool-body">
        <FileDrop
              handoffTarget="merge-pdf"
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

        {items.length > 0 ? (
          <Notice tone="warn" title="Check interactive PDFs">
            Form fields, annotations, bookmarks and digital signatures may not be preserved when pages are copied.
            Keep your originals and check the merged file.
          </Notice>
        ) : null}

        <FileManifest items={items} onMove={move} onRemove={(id) => { setItems((p) => p.filter((i) => i.id !== id)); setResult(null); }} />

        {busy ? <Progress value={progress} label="Merge progress" /> : null}

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
