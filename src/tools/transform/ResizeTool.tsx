import { useEffect, useMemo, useState } from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { ResultPanel } from '../../components/tool/ResultPanel';
import { Field, Notice, Segmented, Toggle, type SegmentOption } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { useImagePipeline, STAGE_STEPS, stageStates } from '../../hooks/useImagePipeline';
import { useImageFormats } from '../../hooks/useImageFormats';
import { OutputControls } from './shared';
import { extensionForFormat, type ImageFormat } from '../../lib/image/types';
import { outputName } from '../../lib/files/format';
import { useToast } from '../../hooks/useToast';
import { useImageBatch } from '../../hooks/useImageBatch';
import { useOutputEstimate } from '../../hooks/useOutputEstimate';
import { Outcome, type OutcomeRow } from '../../components/tool/Outcome';
import { formatBytes, formatPercent, savingsPercent } from '../../lib/files/format';
import { BatchPanel } from '../../components/batch/BatchPanel';

const tool = getTool('resize')!;
const PRESETS = [25, 50, 75, 100];
const FIT_OPTIONS = ['contain', 'stretch'] as const;

const SCALE_OPTIONS: SegmentOption<string>[] = [
  ...PRESETS.map((p) => ({ value: String(p), label: `${p}%` })),
  { value: 'custom', label: 'Custom', disabled: true },
];

export default function ResizeTool() {
  const pipeline = useImagePipeline();
  const batch = useImageBatch();
  const { formats, ready } = useImageFormats();
  const { toast } = useToast();

  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [lock, setLock] = useState(true);
  const [allowUpscale, setAllowUpscale] = useState(false);
  const [fit, setFit] = useState<'contain' | 'stretch'>('contain');
  const [format, setFormat] = useState<ImageFormat>('image/png');
  const [quality, setQuality] = useState(88);

  const source = pipeline.input;
  const aspect = source ? source.width / source.height : 1;

  useEffect(() => {
    if (!source) return;
    setWidth(source.width);
    setHeight(source.height);
  }, [source]);

  const outputDims = useMemo(() => {
    if (!source) return { width: 0, height: 0 };
    if (fit === 'stretch') return { width: Math.max(1, width), height: Math.max(1, height) };
    const scale = Math.min(width / source.width, height / source.height) || 1;
    const capped = allowUpscale ? scale : Math.min(scale, 1);
    return {
      width: Math.max(1, Math.round(source.width * capped)),
      height: Math.max(1, Math.round(source.height * capped)),
    };
  }, [allowUpscale, fit, height, source, width]);

  const setWidthLocked = (next: number) => {
    const value = Math.max(1, Math.min(20000, Math.round(next) || 1));
    setWidth(value);
    if (lock) setHeight(Math.max(1, Math.round(value / aspect)));
  };

  const setHeightLocked = (next: number) => {
    const value = Math.max(1, Math.min(20000, Math.round(next) || 1));
    setHeight(value);
    if (lock) setWidth(Math.max(1, Math.round(value * aspect)));
  };

  const percent = source ? Math.round((width / source.width) * 100) : 100;
  const scaleMatch = String(PRESETS.includes(percent) ? percent : 'custom');

  const applyPreset = (value: string) => {
    const percent = Number(value);
    if (!source || !Number.isFinite(percent)) return;
    setWidthLocked(Math.round((source.width * percent) / 100));
  };

  const job = {
    format,
    quality: quality / 100,
    maxWidth: outputDims.width,
    maxHeight: outputDims.height,
    upscale: allowUpscale,
    stretch: fit === 'stretch',
  };

  const run = async () => {
    if (!source) return;
    const result = await pipeline.run(job);
    if (result) toast(`Resized to ${result.width} × ${result.height}px`, 'success');
  };

  const runBatch = () =>
    batch.start({ job, extension: extensionForFormat(format), suffix: 'resized', archiveName: 'zeroupload-resized.zip' });

  // A rejected batch has no items but does have an error worth rendering.
  const inBatch = batch.items.length > 0 || batch.error !== null;
  const pending = batch.summary.pending;
  const runAll = () => void (inBatch ? runBatch() : run());
  const busy = inBatch ? batch.status === 'running' || batch.status === 'cancelling' : pipeline.busy;
  const runDisabled = busy || (inBatch && pending === 0);

  /*
   * Resizing is the tool where the outcome is most predictable and least visible:
   * the dimensions are right there, but "1280 × 720" says nothing about whether
   * the file got smaller. The panel states both, and flags upscaling explicitly —
   * asking for a larger image than the source is the one choice here that cannot
   * add detail.
   */
  const estimate = useOutputEstimate(pipeline.input, job, { enabled: !pipeline.busy && !inBatch });

  const rows: OutcomeRow[] = [];
  if (source && !inBatch) {
    rows.push({
      label: 'Dimensions',
      value: `${source.width} × ${source.height} → ${outputDims.width} × ${outputDims.height}`,
    });
    if (outputDims.width > source.width || outputDims.height > source.height) {
      rows.push({
        label: 'Scale',
        value: `${percent}% · upscaled`,
        tone: 'warn',
      });
    } else {
      rows.push({
        label: 'Scale',
        value: `${percent}% · ${formatPercent(1 - (outputDims.width * outputDims.height) / (source.width * source.height))} fewer pixels`,
      });
    }
    if (estimate.estimate) {
      const saved = savingsPercent(source.file.size, estimate.estimate.blob.size);
      rows.push({
        label: 'Output size',
        value: `${formatBytes(estimate.estimate.blob.size)} · ${saved >= 0 ? `${formatPercent(saved / 100)} smaller` : `${formatPercent(-saved / 100)} larger`}`,
        tone: saved >= 0 ? 'good' : 'warn',
      });
    } else if (estimate.measuring || estimate.stale) {
      rows.push({ label: 'Output size', value: 'measuring…' });
    } else {
      // Only reachable for sources above the auto-measure budget, where the panel
      // offers a button instead of quietly encoding a 40-megapixel photo.
      rows.push({ label: 'Output size', value: 'not measured', hint: 'manual' });
    }
  }

  return (
    <ToolLayout
      tool={tool}
      aside={
        source || inBatch ? (
          <Settings
            title="Target size"
            footer={
              <button type="button" className="btn btn--primary btn--block" onClick={runAll} disabled={runDisabled}>
                {busy ? <Spinner /> : <Icon name="resize" size={14} />}
                {busy
                  ? 'Resizing…'
                  : inBatch
                    ? pending === 0
                      ? 'Queue finished'
                      : `Resize ${pending} ${pending === 1 ? 'image' : 'images'}`
                    : 'Resize image'}
              </button>
            }
          >
            <div className="dimension-grid">
              <Field label="Width" htmlFor="resize-w">
                <input
                  id="resize-w"
                  className="input input--mono"
                  type="number"
                  min={1}
                  max={20000}
                  value={width || ''}
                  onChange={(event) => setWidthLocked(Number(event.target.value))}
                />
              </Field>
              <Field label="Height" htmlFor="resize-h">
                <input
                  id="resize-h"
                  className="input input--mono"
                  type="number"
                  min={1}
                  max={20000}
                  value={height || ''}
                  disabled={lock}
                  onChange={(event) => setHeightLocked(Number(event.target.value))}
                />
              </Field>
            </div>

            <Field label="Quick scale">
              <Segmented
                label="Quick scale"
                value={scaleMatch}
                onChange={(value) => applyPreset(value)}
                options={SCALE_OPTIONS}
              />
            </Field>

            <Toggle checked={lock} onChange={setLock} label="Lock aspect ratio" />
            <Toggle
              checked={allowUpscale}
              onChange={setAllowUpscale}
              label="Allow upscaling"
              hint="Upscaling interpolates pixels; it cannot add real detail."
            />

            <Field label="Fit mode" hint={fit === 'stretch' ? 'Exact width and height — the image will distort.' : 'Preserves aspect ratio inside the target box.'}>
              <Segmented
                label="Fit mode"
                value={fit}
                onChange={(value) => setFit(value)}
                options={[{ value: FIT_OPTIONS[0], label: 'Contain' }, { value: FIT_OPTIONS[1], label: 'Stretch' }]}
              />
            </Field>

            <hr className="hairline" />
            <OutputControls
              format={format}
              onFormat={setFormat}
              quality={quality}
              onQuality={setQuality}
              supported={formats}
              ready={ready}
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
              note="Measured by encoding this image at the target size, on this device."
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
        ) : !source ? (
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
              title="Drop images to resize"
              hint="One image or up to fifty at once. Large images are resampled smoothly, and your original stays untouched."
              icon="resize"
            />
            {pipeline.error ? (
              <Notice tone="danger" title="Could not open this file">
                {pipeline.error.message}
              </Notice>
            ) : null}
          </>
        ) : (
          <>
            <div className="row row--between row--wrap">
              <span className="section-title">Source</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={pipeline.reset}>
                <Icon name="x" size={13} /> Clear
              </button>
            </div>

            <FileCard file={source.file} onRemove={pipeline.reset} subtitle={`${source.width} × ${source.height}px`} />

            <div className="resize-readout">
              <div>
                <span className="compare__label">Original</span>
                <span className="numeric-reset">{source.width} × {source.height}</span>
              </div>
              <Icon name="arrow-right" size={16} />
              <div>
                <span className="compare__label">Target</span>
                <span className="numeric-reset">{outputDims.width} × {outputDims.height}</span>
              </div>
              <div className="resize-readout__delta">
                {((outputDims.width * outputDims.height) / (source.width * source.height) * 100).toFixed(0)}% of original pixels
              </div>
            </div>

            {pipeline.busy || pipeline.stage === 'done' ? (
              <StageTimeline stages={[...STAGE_STEPS]} states={stageStates(pipeline.stage)} />
            ) : null}

            {pipeline.error ? <Notice tone="danger" title="Resize failed">{pipeline.error.message}</Notice> : null}

            {pipeline.result ? (
              <ResultPanel
                title={`Resized · ${pipeline.result.width} × ${pipeline.result.height}px`}
                preview={pipeline.result.blob}
                originalBytes={source.file.size}
                outputBlob={pipeline.result.blob}
                filename={outputName(source.file.name, extensionForFormat(format), `${pipeline.result.width}x${pipeline.result.height}`)}
                onRerun={run}
                onReset={pipeline.reset}
                downloadLabel={`Download ${extensionForFormat(format).toUpperCase()}`}
              />
            ) : (
              <div className="preview-placeholder">
                <Icon name="resize" size={22} />
                <p>Set a target size and resize. The original stays untouched.</p>
              </div>
            )}
          </>
        )}
      </div>
    </ToolLayout>
  );
}
