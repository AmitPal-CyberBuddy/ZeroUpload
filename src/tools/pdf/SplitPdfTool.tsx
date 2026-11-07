import { useEffect, useMemo, useState } from 'react';
import { getTool } from '../../registry/tools';
import { RunAction } from '../../components/tool/RunAction';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { Field, Notice, Segmented } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Progress } from '../../components/ui/Progress';
import { assertWithinSize, toToolError, ToolError } from '../../lib/files/errors';
import { formatBytes, formatCount } from '../../lib/files/format';
import { Outcome, type OutcomeRow } from '../../components/tool/Outcome';
import { triggerDownload } from '../../lib/files/download';
import { useToast } from '../../hooks/useToast';
import { useRunControl } from '../../hooks/useRunControl';
// Value import only: lib/pdf/pdf loads pdf-lib dynamically, so this costs nothing.
import { MAX_PAGES_FOR_PER_PAGE_SPLIT, summarisePageSelection, type PageInfo } from '../../lib/pdf/pdf';

const tool = getTool('split-pdf')!;

type Mode = 'extract' | 'chunks' | 'every';

export default function SplitPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [mode, setMode] = useState<Mode>('extract');
  const [range, setRange] = useState('1-');
  const [chunkSize, setChunkSize] = useState(2);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<'reading' | 'processing' | 'done' | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [outputs, setOutputs] = useState<{ name: string; blob: Blob }[]>([]);
  const { toast } = useToast();
  const runControl = useRunControl();

  useEffect(() => {
    setRange(pages.length ? `1-${pages.length}` : '');
  }, [pages]);

  const load = async (next: File) => {
    setError(null);
    setOutputs([]);
    setPages([]);
    try {
      assertWithinSize(next, 'pdf');
      setBusy(true);
      setStage('reading');
      const { describePdf } = await import('../../lib/pdf/pdf');
      const info = await describePdf(next);
      setPages(info);
      setFile(next);
      setStage(null);
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
      setFile(null);
      setStage(null);
    } finally {
      setBusy(false);
    }
  };

  // Shares the real parser's rules instead of duplicating them (and drifting).
  const selected = useMemo(
    () => summarisePageSelection(range, pages.length).map((index) => index + 1),
    [pages.length, range],
  );

  /*
   * "How many files will I get?" is the question this tool is actually asked, and
   * the only way to answer it used to be to run it and count. Each mode produces a
   * different shape — one document, N documents, a ZIP — so the plan states which.
   */
  const plan: OutcomeRow[] = [];
  if (file) {
    if (mode === 'extract') {
      plan.push({
        label: 'Pages',
        value: selected.length ? `${selected.length} of ${pages.length}` : 'none selected',
        tone: selected.length ? undefined : 'warn',
      });
      plan.push({ label: 'Files', value: selected.length ? '1 PDF' : '—' });
    } else if (mode === 'chunks') {
      const perFile = Math.max(1, chunkSize);
      const count = Math.max(1, Math.ceil(pages.length / perFile));
      plan.push({ label: 'Pages', value: `${pages.length} · ${perFile} per file` });
      plan.push({ label: 'Files', value: `${count} PDF${count === 1 ? '' : 's'}` });
    } else {
      plan.push({ label: 'Pages', value: String(pages.length) });
      plan.push({
        label: 'Files',
        value: `${pages.length} PDFs · one ZIP`,
        tone: pages.length > MAX_PAGES_FOR_PER_PAGE_SPLIT ? 'warn' : undefined,
      });
    }
    plan.push({ label: 'Source', value: `${formatBytes(file.size)}` });
  }

  const run = async () => {
    if (!file) return;
    setBusy(true);
    const signal = runControl.begin();
    setError(null);
    setOutputs([]);
    setProgress(0);
    setStage('processing');

    try {
      const pdf = await import('../../lib/pdf/pdf');
      const base = file.name.replace(/\.pdf$/i, '');

      if (mode === 'extract') {
        const indices = pdf.parsePageRanges(range, pages.length);
        const bytes = await pdf.extractPages(file, indices, {}, { signal });
        setOutputs([
          {
            name: `${base}-pages-${indices[0] + 1}-${indices[indices.length - 1] + 1}.pdf`,
            blob: pdf.pdfBytesToBlob(bytes),
          },
        ]);
      } else if (mode === 'chunks') {
        // One parse, N cheap copies — not N full parses of the source.
        const groups = pdf.chunkPageIndices(pages.length, chunkSize);
        const documents = await pdf.splitPdf(file, groups, { onProgress: setProgress, signal });
        setOutputs(
          documents.map((bytes, index) => ({
            name: `${base}-part-${index + 1}.pdf`,
            blob: pdf.pdfBytesToBlob(bytes),
          })),
        );
      } else {
        if (pages.length > MAX_PAGES_FOR_PER_PAGE_SPLIT) {
          throw new ToolError(
            'limit-exceeded',
            `Splitting every page is disabled above ${MAX_PAGES_FOR_PER_PAGE_SPLIT} pages.`,
            'One document per page gets heavy on long files and can exhaust the browser\'s memory. Use “Every N” instead.',
          );
        }
        const groups = pdf.everyPageIndices(pages.length);
        const documents = await pdf.splitPdf(file, groups, { onProgress: setProgress, signal });
        setOutputs(
          documents.map((bytes, index) => ({
            name: `${base}-page-${String(index + 1).padStart(3, '0')}.pdf`,
            blob: pdf.pdfBytesToBlob(bytes),
          })),
        );
      }
      setStage('done');
      toast('Pages extracted locally', 'success');
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

  const downloadAll = async () => {
    if (outputs.length === 0) return;
    if (outputs.length === 1) {
      triggerDownload(outputs[0].blob, outputs[0].name);
      return;
    }
    const { createZip } = await import('../../lib/zip/zip');
    const zip = await createZip(outputs.map((entry) => ({ name: entry.name, blob: entry.blob })));
    triggerDownload(zip, `${file?.name.replace(/\.pdf$/i, '') ?? 'zeroupload'}-split.zip`);
  };

  return (
    <ToolLayout
      tool={tool}
      aside={
        file ? (
          <Settings
            title="Split options"
            footer={
              <RunAction
                label={mode === 'extract' ? 'Extract pages' : 'Split document'}
                busyLabel="Working…"
                icon="scissors"
                busy={busy}
                onRun={run}
                onCancel={runControl.cancel}
                cancellable={runControl.cancellable}
              />
            }
          >
            <Field label="Mode">
              <Segmented
                label="Mode"
                value={mode}
                onChange={(value) => setMode(value)}
                options={[
                  { value: 'extract', label: 'Extract' },
                  { value: 'chunks', label: 'Every N' },
                  { value: 'every', label: 'Each page' },
                ]}
              />
            </Field>

            {mode === 'extract' ? (
              <Field
                label="Pages"
                hint="Use commas and ranges, e.g. 1-3, 7, 10-"
                trailing={<span className="setting-value">{selected.length} selected</span>}
              >
                <input
                  className="input input--mono"
                  value={range}
                  onChange={(event) => setRange(event.target.value)}
                  placeholder={`1-${pages.length}`}
                  aria-label="Pages to extract"
                />
              </Field>
            ) : mode === 'chunks' ? (
              <Field label="Pages per file" trailing={<span className="setting-value">{chunkSize}</span>}>
                <input
                  className="input input--mono"
                  type="number"
                  min={1}
                  max={Math.max(1, pages.length)}
                  value={chunkSize}
                  onChange={(event) => setChunkSize(Math.max(1, Number(event.target.value) || 1))}
                />
              </Field>
            ) : (
              <Notice tone="default" icon="info">
                One PDF per page, delivered as a ZIP. Limited to {MAX_PAGES_FOR_PER_PAGE_SPLIT} pages, because
                each output is a complete document in its own right.
              </Notice>
            )}

            <div className="setting-row">
              <span className="field__hint">Document</span>
              <span className="setting-value">{formatCount(pages.length, 'page')}</span>
            </div>

            <Outcome rows={plan} />
          </Settings>
        ) : null
      }
    >
      <div className="tool-body">
        {!file ? (
          <>
            <FileDrop
              accept="application/pdf,.pdf"
              onFiles={(files) => load(files[0])}
              title="Drop a PDF to split"
              hint="Your document is opened on your device, so you can pick exactly what to extract."
              icon="scissors"
            />
            {busy ? <StageTimeline stages={['Reading', 'Processing', 'Complete']} states={['active', 'idle', 'idle']} /> : null}
          </>
        ) : (
          <>
            <div className="row row--between row--wrap">
              <span className="section-title">Document</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setFile(null); setPages([]); setOutputs([]); }}>
                <Icon name="x" size={13} /> Clear
              </button>
            </div>

            <FileCard file={file} subtitle={formatCount(pages.length, 'page')} onRemove={() => { setFile(null); setPages([]); setOutputs([]); }} />

            <div className="page-chips" aria-label="Pages in document">
              {pages.slice(0, 120).map((page) => (
                <span
                  key={page.index}
                  className="page-chip"
                  data-on={mode === 'extract' && selected.includes(page.index + 1)}
                  title={`Page ${page.index + 1} · ${page.width} × ${page.height}pt`}
                >
                  {page.index + 1}
                </span>
              ))}
              {pages.length > 120 ? <span className="page-chip">+{pages.length - 120}</span> : null}
            </div>

            {error ? (
              <Notice tone="danger" title="Could not process this PDF">
                {error.message}
                {error.hint ? <div className="hint">{error.hint}</div> : null}
              </Notice>
            ) : null}

            {busy && mode !== 'extract' ? <Progress value={progress} label="Split progress" /> : null}

            {stage ? (
              <StageTimeline
                stages={['Reading', 'Splitting', 'Complete']}
                states={stage === 'reading' ? ['active', 'idle', 'idle'] : stage === 'processing' ? ['done', 'active', 'idle'] : ['done', 'done', 'done']}
              />
            ) : null}

            {outputs.length > 0 ? (
              <div className="result">
                <div className="result__head">
                  <span className="result__title">
                    <i className="dot" aria-hidden="true" />
                    {outputs.length === 1 ? 'Page range extracted' : `${outputs.length} documents ready`}
                  </span>
                  <span className="badge">
                    {outputs.reduce((sum, entry) => sum + entry.blob.size, 0) > 1024 * 1024
                      ? `${(outputs.reduce((sum, entry) => sum + entry.blob.size, 0) / 1024 / 1024).toFixed(1)} MB`
                      : `${(outputs.reduce((sum, entry) => sum + entry.blob.size, 0) / 1024).toFixed(0)} KB`}
                  </span>
                </div>

                <div className="manifest">
                  {outputs.slice(0, 40).map((entry) => (
                    <div className="manifest__row" key={entry.name} style={{ gridTemplateColumns: 'minmax(0,1fr) 78px auto' }}>
                      <span className="manifest__name">
                        <Icon name="pdf" size={14} />
                        <span title={entry.name}>{entry.name}</span>
                      </span>
                      <span className="manifest__size">{(entry.blob.size / 1024).toFixed(0)} KB</span>
                      <span className="manifest__actions">
                        <button type="button" className="btn btn--icon" style={{ width: 26, height: 26 }} onClick={() => triggerDownload(entry.blob, entry.name)} aria-label={`Download ${entry.name}`}>
                          <Icon name="download" size={13} />
                        </button>
                      </span>
                    </div>
                  ))}
                  {outputs.length > 40 ? (
                    <div className="manifest__row">
                      <span className="manifest__name">…and {outputs.length - 40} more</span>
                    </div>
                  ) : null}
                </div>

                <div className="result__actions">
                  <button type="button" className="btn btn--primary" onClick={downloadAll}>
                    <Icon name="download" size={15} />
                    {outputs.length === 1 ? 'Download PDF' : 'Download ZIP'}
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => { setFile(null); setPages([]); setOutputs([]); }}>
                    Process another
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}

        {error && !file ? <Notice tone="danger" title="Could not open this file">{error.message}</Notice> : null}

        <div className="tool-notes">
          <div>
            <Icon name="cpu" size={15} />
            <strong>Structure preserved</strong>
            <p>Pages are copied into a new document, so vectors and text remain intact and crisp.</p>
          </div>
          <div>
            <Icon name="lock" size={15} />
            <strong>Encrypted PDFs</strong>
            <p>
              Locked documents are not forced open here. Use Unlock PDF first, with the password you already
              know.
            </p>
          </div>
        </div>
      </div>
    </ToolLayout>
  );
}
