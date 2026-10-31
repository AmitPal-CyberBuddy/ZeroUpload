import { useRef, useState } from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileManifest, type ManifestItem } from '../../components/file/FileManifest';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { CompareSizes } from '../../components/tool/CompareSizes';
import { Field, Notice } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { assertWithinSize, toToolError } from '../../lib/files/errors';
import { formatBytes } from '../../lib/files/format';
import { triggerDownload } from '../../lib/files/download';
import { useToast } from '../../hooks/useToast';

const tool = getTool('create-zip')!;

export default function CreateZipTool() {
  const [items, setItems] = useState<ManifestItem[]>([]);
  const [archiveName, setArchiveName] = useState('zeroupload-archive');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'reading' | 'packing' | 'done' | null>(null);
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const counter = useRef(0);
  const { toast } = useToast();

  const addFiles = (files: File[]) => {
    const accepted: ManifestItem[] = [];
    for (const file of files) {
      try {
        assertWithinSize(file, 'zip');
        counter.current += 1;
        accepted.push({ id: `z${counter.current}`, file });
      } catch (err) {
        const toolError = toToolError(err);
        setError({ message: toolError.message, hint: toolError.hint });
      }
    }
    if (accepted.length) {
      setItems((prev) => [...prev, ...accepted]);
      setResult(null);
    }
  };

  const build = async () => {
    if (items.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(0);
    setStage('reading');
    try {
      const { createZip } = await import('../../lib/zip/zip');
      setStage('packing');
      const blob = await createZip(
        items.map((item) => ({ name: item.file.name, blob: item.file })),
        { onProgress: (ratio: number) => setProgress(ratio) },
      );
      setResult(blob);
      setStage('done');
      toast('Archive created locally', 'success');
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
      setStage(null);
    } finally {
      setBusy(false);
    }
  };

  const totalInput = items.reduce((sum, item) => sum + item.file.size, 0);

  return (
    <ToolLayout
      tool={tool}
      aside={
        <Settings
          title="Archive"
          footer={
            <button type="button" className="btn btn--primary btn--block" onClick={build} disabled={busy || items.length === 0}>
              {busy ? <Spinner /> : <Icon name="zip" size={14} />}
              {busy ? 'Packing…' : 'Create ZIP'}
            </button>
          }
        >
          <Field label="File name">
            <div className="row" style={{ gap: 6 }}>
              <input
                className="input input--mono"
                value={archiveName}
                onChange={(event) => setArchiveName(event.target.value.replace(/[\\/:*?"<>|]+/g, '-'))}
                aria-label="Archive file name"
              />
              <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                .zip
              </span>
            </div>
          </Field>

          <div className="setting-row">
            <span className="field__hint">Files</span>
            <span className="setting-value">{items.length}</span>
          </div>
          <div className="setting-row">
            <span className="field__hint">Input total</span>
            <span className="setting-value">{formatBytes(totalInput)}</span>
          </div>

          <Notice tone="default" icon="info">
            Deflate compression runs in this tab. Already-compressed files (JPEG, MP4) will barely shrink —
            that is expected.
          </Notice>
        </Settings>
      }
    >
      <div className="tool-body">
        <FileDrop
          accept={undefined}
          multiple
          onFiles={addFiles}
          onError={(message) => setError({ message })}
          title={items.length ? 'Add more files' : 'Drop files to bundle'}
          hint="Any file type. Files are read one at a time to keep memory use predictable."
          icon="zip"
          compact={items.length > 0}
          disabled={busy}
        />

        {error ? <Notice tone="danger" title="Some files were skipped">{error.message}</Notice> : null}

        <FileManifest
          items={items}
          onMove={(index, direction) =>
            setItems((prev) => {
              const next = [...prev];
              const target = index + direction;
              if (target < 0 || target >= next.length) return prev;
              [next[index], next[target]] = [next[target], next[index]];
              return next;
            })
          }
          onRemove={(id) => { setItems((prev) => prev.filter((item) => item.id !== id)); setResult(null); }}
          emptyLabel="Drop any files here to bundle them into a ZIP."
        />

        {stage ? (
          <>
            <StageTimeline
              stages={['Reading', 'Packing', 'Complete']}
              states={
                stage === 'reading' ? ['active', 'idle', 'idle'] : stage === 'packing' ? ['done', 'active', 'idle'] : ['done', 'done', 'done']
              }
            />
            {busy ? (
              <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="progress__bar" style={{ ['--value' as string]: `${Math.round(progress * 100)}%` }} />
              </div>
            ) : null}
          </>
        ) : null}

        {result ? (
          <div className="result">
            <div className="result__head">
              <span className="result__title">
                <i className="dot" aria-hidden="true" />
                Archive ready
              </span>
              <span className="badge">{items.length} entries</span>
            </div>
            <CompareSizes original={totalInput} output={result.size} originalLabel="Inputs" outputLabel="Archive" />
            <div className="result__actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => triggerDownload(result, `${archiveName || 'zeroupload-archive'}.zip`)}
              >
                <Icon name="download" size={15} /> Download ZIP
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
