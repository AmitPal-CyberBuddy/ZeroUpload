import { useRef, useState } from 'react';
import { getTool } from '../../registry/tools';
import { RunAction } from '../../components/tool/RunAction';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileManifest, type ManifestItem } from '../../components/file/FileManifest';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { Field, Notice, RangeField, Segmented } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Progress } from '../../components/ui/Progress';
import { assertWithinSize, toToolError, ToolError } from '../../lib/files/errors';
import { OPERATION_BUDGETS, assertCumulativeBudget } from '../../lib/files/budget';
import { Outcome, type OutcomeRow } from '../../components/tool/Outcome';
import { triggerDownload } from '../../lib/files/download';
import { formatBytes } from '../../lib/files/format';
import { useToast } from '../../hooks/useToast';
import { useRunControl } from '../../hooks/useRunControl';

const tool = getTool('images-to-pdf')!;

export default function ImagesToPdfTool() {
  const [items, setItems] = useState<ManifestItem[]>([]);
  const [pageSize, setPageSize] = useState<'fit' | 'a4'>('fit');
  const [margin, setMargin] = useState(24);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<'reading' | 'building' | 'done' | null>(null);
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const counter = useRef(0);
  const { toast } = useToast();
  const runControl = useRunControl();

  const addFiles = (files: File[]) => {
    const accepted: ManifestItem[] = [];
    for (const file of files) {
      try {
        assertWithinSize(file, 'image');
        const type = file.type;
        if (type !== 'image/jpeg' && type !== 'image/png') {
          throw new ToolError(
            'unsupported-type',
            `${file.name} is ${type || 'an unknown type'}.`,
            'Only JPEG and PNG can be embedded directly. Convert WebP or AVIF with the image converter first.',
          );
        }
        counter.current += 1;
        accepted.push({ id: `i${counter.current}`, file });
      } catch (err) {
        const toolError = toToolError(err);
        setError({ message: toolError.message, hint: toolError.hint });
      }
    }
    if (!accepted.length) return;

    const combined = [...items, ...accepted];
    try {
      assertCumulativeBudget(
        combined.map((item) => ({ name: item.file.name, size: item.file.size })),
        OPERATION_BUDGETS.imagesToPdf,
      );
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
      return;
    }

    setItems(combined);
    setResult(null);
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

  const run = async () => {
    if (items.length === 0) return;
    setBusy(true);
    const signal = runControl.begin();
    setError(null);
    setProgress(0);
    setStage('reading');
    try {
      assertCumulativeBudget(
        items.map((item) => ({ name: item.file.name, size: item.file.size })),
        OPERATION_BUDGETS.imagesToPdf,
      );
      const { imagesToPdf, pdfBytesToBlob } = await import('../../lib/pdf/pdf');
      setStage('building');
      const bytes = await imagesToPdf(
        items.map((item) => ({ blob: item.file, type: item.file.type, name: item.file.name })),
        { pageSize, margin },
        { onProgress: setProgress, signal },
      );
      setResult(pdfBytesToBlob(bytes));
      setStage('done');
      toast(`Built a ${items.length}-page PDF locally`, 'success');
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

  /*
   * Image order is page order, so the count is the one fact worth stating up
   * front — with the page geometry, since "Fit" and "A4" produce very different
   * documents from the same six photos.
   */
  const imagePlan: OutcomeRow[] = [
    { label: 'Pages', value: `${items.length}` },
    { label: 'Page size', value: pageSize === 'a4' ? 'A4 · 595 × 842 pt' : 'Fit to each image' },
  ];
  if (pageSize === 'a4') {
    imagePlan.push({ label: 'Margin', value: `${margin} pt` });
  }
  imagePlan.push({
    label: 'Content',
    value: items.length ? formatBytes(items.reduce((sum, item) => sum + item.file.size, 0)) : '—',
  });

  return (
    <ToolLayout
      tool={tool}
      aside={
        <Settings
          title="Page setup"
          footer={
            <RunAction
              label={`Build PDF (${items.length})`}
              busyLabel="Building…"
              icon="pdf"
              busy={busy}
              disabled={items.length === 0}
              onRun={run}
              onCancel={runControl.cancel}
              cancellable={runControl.cancellable}
            />
          }
        >
          <Field label="Page size" hint={pageSize === 'fit' ? 'Each page matches its image at 72 DPI.' : 'Images are centred on A4 with margins.'}>
            <Segmented
              label="Page size"
              value={pageSize}
              onChange={setPageSize}
              options={[
                { value: 'fit', label: 'Fit image' },
                { value: 'a4', label: 'A4' },
              ]}
            />
          </Field>

          <RangeField
            label="Margin"
            min={0}
            max={72}
            value={margin}
            onChange={setMargin}
            format={(value) => `${value} pt`}
            hint="Only applies to A4 pages."
          />

          <Outcome
            rows={imagePlan}
            note="Images are embedded as they are — no re-encoding, so nothing loses quality."
          />
        </Settings>
      }
    >
      <div className="tool-body">
        <FileDrop
          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
          multiple
          onFiles={addFiles}
          onError={(message) => setError({ message })}
          title={items.length ? 'Add more images' : 'Drop JPEG or PNG images'}
          hint="Order becomes page order. Use the arrows to rearrange."
          icon="layers"
          compact={items.length > 0}
          disabled={busy}
        />

        {error ? (
          <Notice tone="danger" title="Some files were skipped">
            {error.message}
            {error.hint ? <div className="hint">{error.hint}</div> : null}
          </Notice>
        ) : null}

        <FileManifest
          items={items}
          onMove={move}
          onRemove={(id) => { setItems((prev) => prev.filter((item) => item.id !== id)); setResult(null); }}
          emptyLabel="Add images to start building a document."
        />

        {busy ? <Progress value={progress} label="Build progress" /> : null}

        {stage ? (
          <StageTimeline
            stages={['Reading', 'Building', 'Complete']}
            states={
              stage === 'reading' ? ['active', 'idle', 'idle'] : stage === 'building' ? ['done', 'active', 'idle'] : ['done', 'done', 'done']
            }
          />
        ) : null}

        {result ? (
          <div className="result">
            <div className="result__head">
              <span className="result__title">
                <i className="dot" aria-hidden="true" />
                PDF ready · {items.length} pages
              </span>
              <span className="badge">{(result.size / 1024 / 1024).toFixed(2)} MB</span>
            </div>
            <div className="result__actions">
              <button type="button" className="btn btn--primary" onClick={() => triggerDownload(result, 'zeroupload-images.pdf')}>
                <Icon name="download" size={15} /> Download PDF
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
