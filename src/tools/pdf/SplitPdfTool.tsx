import { useEffect, useMemo, useState } from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { Field, Notice, Segmented } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { assertWithinSize, toToolError } from '../../lib/files/errors';
import { formatCount } from '../../lib/files/format';
import { triggerDownload } from '../../lib/files/download';
import { useToast } from '../../hooks/useToast';
import type { PageInfo } from '../../lib/pdf/pdf';

const tool = getTool('split-pdf')!;

type Mode = 'extract' | 'chunks' | 'every';

export default function SplitPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [mode, setMode] = useState<Mode>('extract');
  const [range, setRange] = useState('1-');
  const [chunkSize, setChunkSize] = useState(2);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'reading' | 'processing' | 'done' | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [outputs, setOutputs] = useState<{ name: string; blob: Blob }[]>([]);
  const { toast } = useToast();

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
      const info = await describePdf(await next.arrayBuffer());
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

  const selected = useMemo(() => {
    const set = new Set<number>();
    for (const chunk of range.split(/[,\s]+/).filter(Boolean)) {
      const match = /^(\d+)?\s*-\s*(\d+)?$/.exec(chunk);
      if (match && (match[1] || match[2])) {
        const start = match[1] ? Number(match[1]) : 1;
        const end = match[2] ? Number(match[2]) : pages.length;
        for (let i = start; i <= Math.min(end, pages.length); i += 1) if (i >= 1) set.add(i);
      } else if (/^\d+$/.test(chunk)) {
        const n = Number(chunk);
        if (n >= 1 && n <= pages.length) set.add(n);
      }
    }
    return [...set].sort((a, b) => a - b);
  }, [pages.length, range]);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setOutputs([]);
    setStage('processing');

    try {
      const { extractPages, pdfBytesToBlob, parsePageRanges } = await import('../../lib/pdf/pdf');
      const data = await file.arrayBuffer();
      const base = file.name.replace(/\.pdf$/i, '');

      if (mode === 'extract') {
        const indices = parsePageRanges(range, pages.length);
        const bytes = await extractPages(data, indices);
        setOutputs([{ name: `${base}-pages-${indices[0] + 1}-${indices[indices.length - 1] + 1}.pdf`, blob: pdfBytesToBlob(bytes) }]);
      } else if (mode === 'chunks') {
        const size = Math.max(1, chunkSize);
        const produced: { name: string; blob: Blob }[] = [];
        for (let start = 0; start < pages.length; start += size) {
          const indices = Array.from({ length: Math.min(size, pages.length - start) }, (_, i) => start + i);
          const bytes = await extractPages(data, indices);
          produced.push({
            name: `${base}-part-${Math.floor(start / size) + 1}.pdf`,
            blob: pdfBytesToBlob(bytes),
          });
        }
        setOutputs(produced);
      } else {
        const produced: { name: string; blob: Blob }[] = [];
        for (let index = 0; index < pages.length; index += 1) {
          const bytes = await extractPages(data, [index]);
          produced.push({
            name: `${base}-page-${String(index + 1).padStart(3, '0')}.pdf`,
            blob: pdfBytesToBlob(bytes),
          });
        }
        setOutputs(produced);
      }
      setStage('done');
      toast('Pages extracted locally', 'success');
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
      setStage(null);
    } finally {
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
              <button type="button" className="btn btn--primary btn--block" onClick={run} disabled={busy}>
                {busy ? <Spinner /> : <Icon name="scissors" size={14} />}
                {busy ? 'Working…' : mode === 'extract' ? 'Extract pages' : 'Split document'}
              </button>
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
                One PDF per page, packaged into a ZIP when you download.
              </Notice>
            )}

            <div className="setting-row">
              <span className="field__hint">Document</span>
              <span className="setting-value">{formatCount(pages.length, 'page')}</span>
            </div>
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
              hint="The page count is read locally so you can pick exactly what to extract."
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
            <p>Password-protected documents are rejected with an explanation — ZeroUpload cannot crack them, by design.</p>
          </div>
        </div>
      </div>
    </ToolLayout>
  );
}
