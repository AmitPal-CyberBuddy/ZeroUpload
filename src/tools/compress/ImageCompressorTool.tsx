import { useEffect, useState } from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { CompareSizes } from '../../components/tool/CompareSizes';
import { Field, Notice, RangeField, Segmented, Toggle } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { useImagePipeline, STAGE_STEPS, stageStates } from '../../hooks/useImagePipeline';
import { useImageFormats } from '../../hooks/useImageFormats';
import {
  IMAGE_FORMATS,
  extensionForFormat,
  isLossy,
  labelForFormat,
  type ImageFormat,
} from '../../lib/image/types';
import { outputName } from '../../lib/files/format';
import { triggerDownload } from '../../lib/files/download';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { useToast } from '../../hooks/useToast';
import { useImageBatch } from '../../hooks/useImageBatch';
import { useOutputEstimate } from '../../hooks/useOutputEstimate';
import { Outcome, type OutcomeRow } from '../../components/tool/Outcome';
import { formatBytes, formatPercent, savingsPercent } from '../../lib/files/format';
import { BatchPanel } from '../../components/batch/BatchPanel';
import { compressToTarget } from '../../lib/image/targetSize';

const tool = getTool('image-compressor')!;

interface Preset {
  id: string;
  label: string;
  quality: number;
  scale: number;
}

const PRESETS: Preset[] = [
  { id: 'balanced', label: 'Balanced', quality: 78, scale: 100 },
  { id: 'aggressive', label: 'Aggressive', quality: 55, scale: 100 },
  { id: 'max', label: 'Max savings', quality: 40, scale: 75 },
];

export default function ImageCompressorTool() {
  const pipeline = useImagePipeline();
  const batch = useImageBatch();
  const { formats, ready } = useImageFormats();
  const { toast } = useToast();

  const [format, setFormat] = useState<ImageFormat>('image/webp');
  const [quality, setQuality] = useState(78);
  const [maxWidth, setMaxWidth] = useState(0);
  const [preset, setPreset] = useState<string>('balanced');
  /*
   * Target-size mode. Quality is an input the user cannot evaluate — the same
   * number means different things on a 300px icon and a 4000px photograph — while
   * "under 500 KB" is a requirement people actually have (portal limits, email
   * attachments). Off by default so the simple path stays simple.
   */
  const [targetMode, setTargetMode] = useState(false);
  const [targetKb, setTargetKb] = useState(500);
  const [foundQuality, setFoundQuality] = useState<number | null>(null);

  const resultUrl = useObjectUrl(pipeline.result?.blob ?? null);
  const sourceSize = pipeline.input?.file.size ?? 0;
  const sourceWidth = pipeline.input?.width ?? 0;

  useEffect(() => {
    if (!ready || formats.length === 0) return;
    if (!formats.includes(format)) {
      setFormat(formats.includes('image/webp') ? 'image/webp' : formats[0]);
    }
  }, [formats, format, ready]);

  const job = {
    format,
    quality: quality / 100,
    maxWidth: maxWidth > 0 ? maxWidth : undefined,
  };

  const compress = async () => {
    if (targetMode && pipeline.input) {
      /*
       * The search runs in the tool, not the pipeline, because it is a *sequence*
       * of jobs: each probe is an ordinary encode through the same worker. The
       * pipeline is then handed the single winning job so the result panel
       * behaves exactly as it does in quality mode.
       */
      const { job: winningJob, quality: found } = await runTargetSearch();
      if (!winningJob) return;
      setFoundQuality(found);
      const result = await pipeline.run(winningJob);
      if (result) {
        const met = result.blob.size <= targetKb * 1024;
        toast(
          met
            ? `Under ${targetKb} KB at quality ${found}`
            : `Could not reach ${targetKb} KB — smallest was ${formatBytes(result.blob.size)}`,
          met ? 'success' : 'default',
        );
      }
      return;
    }
    const result = await pipeline.run(job);
    if (result) toast('Compressed locally', 'success');
  };

  /** Binary search over quality, then hand the winner to the pipeline. */
  const runTargetSearch = async (): Promise<{
    job: { format: ImageFormat; quality: number; maxWidth?: number } | null;
    quality: number;
  }> => {
    if (!pipeline.input) return { job: null, quality: 0 };
    try {
      const found = await compressToTarget(
        { format, quality: quality / 100, maxWidth: maxWidth > 0 ? maxWidth : undefined },
        pipeline.input.file,
        { targetBytes: Math.max(1024, targetKb) * 1024 },
      );
      return { job: { ...job, quality: found.quality / 100 }, quality: found.quality };
    } catch {
      return { job: null, quality: 0 };
    }
  };

  /** Same job, same guards — just repeated sequentially. */
  const compressBatch = () =>
    batch.start({ job, extension: extensionForFormat(format), suffix: 'compressed', archiveName: 'zeroupload-compressed.zip' });

  // A rejected batch has no items but does have an error worth rendering.
  const inBatch = batch.items.length > 0 || batch.error !== null;
  const pending = batch.summary.pending;
  const runAll = () => void (inBatch ? compressBatch() : compress());
  const busy = inBatch ? batch.status === 'running' || batch.status === 'cancelling' : pipeline.busy;
  const runDisabled = busy || (inBatch && pending === 0);

  /*
   * The panel the user asked for: move the quality slider and see what comes out.
   * `useOutputEstimate` encodes the real output with the current options after the
   * slider settles, so the number below is the number the run produces — not a
   * model of it. It is disabled while a real run is in flight so a preview cannot
   * compete with the work the user actually asked for.
   */
  // In target mode the quality is the search's output, so an estimate at a fixed
  // quality would be a different job and a misleading number.
  const estimate = useOutputEstimate(pipeline.input, job, {
    enabled: !pipeline.busy && !inBatch && !targetMode,
  });
  const output = estimate.estimate;

  const outWidth = maxWidth > 0 && sourceWidth > 0 ? Math.min(maxWidth, sourceWidth) : sourceWidth;
  const outHeight =
    outWidth && sourceWidth
      ? Math.round((outWidth / sourceWidth) * (pipeline.input?.height ?? 0))
      : (pipeline.input?.height ?? 0);

  const rows: OutcomeRow[] = [];
  if (pipeline.input && !inBatch) {
    rows.push({
      label: 'Dimensions',
      value: `${outWidth} × ${outHeight}px`,
    });
    rows.push({
      label: 'Format',
      value: !isLossy(format)
        ? 'PNG · lossless'
        : targetMode
          ? `${labelForFormat(format)} · best fit under ${targetKb} KB`
          : `${labelForFormat(format)} · quality ${quality}`,
    });
    if (output) {
      const saved = savingsPercent(sourceSize, output.blob.size);
      rows.push({
        label: 'Output size',
        value: `${formatBytes(output.blob.size)} · ${saved >= 0 ? `${formatPercent(saved / 100)} smaller` : `${formatPercent(-saved / 100)} larger`}`,
        tone: saved >= 0 ? 'good' : 'warn',
      });
    } else if (targetMode) {
      rows.push({
        label: 'Output size',
        value: `≤ ${targetKb} KB · quality from search`,
      });
    } else if (estimate.measuring || estimate.stale) {
      rows.push({ label: 'Output size', value: 'measuring…' });
    } else {
      // Only reachable for sources above the auto-measure budget, where the panel
      // offers a button instead of quietly encoding a 40-megapixel photo.
      rows.push({ label: 'Output size', value: 'not measured' });
    }
  }


  const applyPreset = (id: string) => {
    const next = PRESETS.find((p) => p.id === id);
    if (!next) return;
    setPreset(id);
    setQuality(next.quality);
    setMaxWidth(sourceWidth ? Math.round((sourceWidth * next.scale) / 100) : 0);
  };

  return (
    <ToolLayout
      tool={tool}
      aside={
        pipeline.input || inBatch ? (
          <Settings
            title="Compression"
            footer={
              <button type="button" className="btn btn--primary btn--block" onClick={runAll} disabled={runDisabled}>
                {busy ? <Spinner label="Compressing" /> : <Icon name="compress" size={14} />}
                {busy
                  ? 'Compressing…'
                  : inBatch
                    ? pending === 0
                      ? 'Queue finished'
                      : `Compress ${pending} ${pending === 1 ? 'image' : 'images'}`
                    : 'Compress image'}
              </button>
            }
          >
            <Field label="Preset">
              <Segmented
                label="Preset"
                value={preset}
                onChange={applyPreset}
                options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
              />
            </Field>

            <Field label="Output format">
              <Segmented
                label="Output format"
                value={format}
                onChange={(next) => setFormat(next)}
                options={IMAGE_FORMATS.map((f) => ({
                  value: f.value,
                  label: f.label,
                  disabled: ready ? !formats.includes(f.value) : false,
                }))}
              />
            </Field>

            {/*
              * Target-size mode replaces the quality dial rather than sitting next
              * to it: the search owns the quality, and leaving both visible would
              * invite someone to set a number the run then ignores.
              */}
            <Toggle
              checked={targetMode}
              onChange={(next) => {
                setTargetMode(next);
                setFoundQuality(null);
              }}
              label="Target a file size"
              hint="Search for the highest quality that fits, instead of guessing a number."
            />

            {targetMode ? (
              <Field
                label="Target size"
                htmlFor="compress-target-kb"
                hint={
                  foundQuality !== null
                    ? `Last run settled on quality ${foundQuality}.`
                    : 'Runs up to 8 quick encodes to find the best fit.'
                }
              >
                <div className="row" style={{ gap: 6 }}>
                  <input
                    id="compress-target-kb"
                    className="input input--mono"
                    type="number"
                    min={10}
                    max={102400}
                    step={10}
                    value={targetKb}
                    onChange={(event) => {
                      setTargetKb(Math.max(10, Number(event.target.value) || 10));
                      setFoundQuality(null);
                    }}
                  />
                  <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    KB
                  </span>
                </div>
              </Field>
            ) : (
              <RangeField
                label="Quality"
                min={20}
                max={100}
                value={quality}
                onChange={(value) => {
                  setQuality(value);
                  setPreset('custom');
                }}
                format={(v) => `${v}`}
                hint="Encoder quality. Below ~40, artifacts become visible on photos."
              />
            )}

            <RangeField
              label="Max width"
              min={0}
              max={Math.max(1200, sourceWidth)}
              step={50}
              value={maxWidth}
              onChange={(value) => {
                setMaxWidth(value);
                setPreset('custom');
              }}
              format={(v) => (v === 0 ? 'Native' : `${v}px`)}
              hint={sourceWidth ? `Source is ${pipeline.input?.width} × ${pipeline.input?.height}px` : undefined}
            />

            <Outcome
              rows={rows}
              measuring={estimate.measuring || estimate.stale}
              action={
                estimate.needsManual ? (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={estimate.measure}>
                    Measure output size
                  </button>
                ) : undefined
              }
              note={
                inBatch
                  ? 'Sizes are measured for the first image; the queue reports each one as it finishes.'
                  : 'Measured by encoding this image with the settings above. Nothing leaves your device.'
              }
            />
          </Settings>
        ) : null
      }
    >
      <div className="tool-body">
        {inBatch ? (
          <>
            <div className="row row--between row--wrap">
              <span className="section-title">Queue</span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  batch.clear();
                  batch.clearError();
                  pipeline.reset();
                }}
                disabled={busy}
              >
                <Icon name="x" size={13} /> Clear
              </button>
            </div>
            <BatchPanel batch={batch} />
          </>
        ) : !pipeline.input ? (
          <>
            <FileDrop
              accept="image/*"
              multiple
              onFiles={(files) => {
                if (files.length > 1) {
                  pipeline.reset();
                  batch.addFiles(files);
                } else {
                  pipeline.load(files[0]);
                }
              }}
              title="Drop images to compress"
              hint="One image, or up to fifty at once. Your original files are never modified."
              icon="compress"
              disabled={pipeline.busy}
            />
            {pipeline.error ? (
              <Notice tone="danger" title="Could not open this file">
                {pipeline.error.message}
                {pipeline.error.hint ? <div className="hint">{pipeline.error.hint}</div> : null}
              </Notice>
            ) : null}
            <div className="tool-notes">
              <div>
                <Icon name="cpu" size={15} />
                <strong>Real re-encoding</strong>
                <p>
                  The pixels are re-encoded, so the savings are real — not a metadata trick. The comparison
                  below reports the actual file sizes.
                </p>
              </div>
              <div>
                <Icon name="alert" size={15} />
                <strong>Not every file shrinks</strong>
                <p>
                  Re-compressing an already-optimised JPEG or converting to PNG can increase size. ZeroUpload
                  tells you when that happens instead of hiding it.
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="row row--between row--wrap">
              <span className="section-title">Source</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={pipeline.reset}>
                <Icon name="x" size={13} /> Clear
              </button>
            </div>

            <FileCard
              file={pipeline.input.file}
              onRemove={pipeline.reset}
              subtitle={`${pipeline.input.width} × ${pipeline.input.height}px`}
            />

            {pipeline.busy || pipeline.stage === 'done' ? (
              <StageTimeline stages={[...STAGE_STEPS]} states={stageStates(pipeline.stage)} />
            ) : null}

            {pipeline.error ? (
              <Notice tone="danger" title="Compression failed">
                {pipeline.error.message}
                {pipeline.error.hint ? <div className="hint">{pipeline.error.hint}</div> : null}
              </Notice>
            ) : null}

            {pipeline.result ? (
              <div className="result">
                <div className="result__head">
                  <span className="result__title">
                    <i className="dot" aria-hidden="true" />
                    Compressed · quality {quality}
                  </span>
                  <span className="badge">
                    {pipeline.result.width} × {pipeline.result.height}px
                  </span>
                </div>

                <CompareSizes
                  original={pipeline.input.file.size}
                  output={pipeline.result.blob.size}
                  outputLabel="Compressed"
                />

                <div className="result__preview">
                  {resultUrl ? <img src={resultUrl} alt="Compressed preview" /> : null}
                </div>

                <div className="result__actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() =>
                      triggerDownload(
                        pipeline.result!.blob,
                        outputName(pipeline.input!.file.name, extensionForFormat(format), 'compressed'),
                      )
                    }
                  >
                    <Icon name="download" size={15} />
                    Download {extensionForFormat(format).toUpperCase()}
                  </button>
                  <button type="button" className="btn btn--secondary" onClick={compress} disabled={pipeline.busy}>
                    <Icon name="refresh" size={14} /> Try other settings
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={pipeline.reset}>
                    Process another
                  </button>
                </div>
              </div>
            ) : (
              <div className="side-by-side">
                <figure className="preview-frame">
                  <figcaption className="mono">SOURCE · {pipeline.input.detectedType}</figcaption>
                  <SourcePreview file={pipeline.input.file} />
                </figure>
                <div className="preview-placeholder">
                  <Icon name="compress" size={22} />
                  <p>
                    Pick a preset or tune the quality dial. Nothing is processed until you ask for it, so you
                    can compare settings safely.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ToolLayout>
  );
}

function SourcePreview({ file }: { file: File }) {
  const url = useObjectUrl(file);
  return url ? <img src={url} alt="Source preview" /> : null;
}
