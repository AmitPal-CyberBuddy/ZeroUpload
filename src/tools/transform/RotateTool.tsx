import { useState, type CSSProperties } from 'react';

import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { ImageChecks } from '../../components/tool/ImageChecks';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { ResultPanel } from '../../components/tool/ResultPanel';
import { Field, Notice, Segmented } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { useImagePipeline, STAGE_STEPS, stageStates } from '../../hooks/useImagePipeline';
import { useImageFormats } from '../../hooks/useImageFormats';
import { OutputControls } from './shared';
import { extensionForFormat, type ImageFormat } from '../../lib/image/types';
import { outputName } from '../../lib/files/format';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { useToast } from '../../hooks/useToast';
import { useImageBatch } from '../../hooks/useImageBatch';
import { useOutputEstimate } from '../../hooks/useOutputEstimate';
import { Outcome, type OutcomeRow } from '../../components/tool/Outcome';
import { formatBytes } from '../../lib/files/format';
import { BatchPanel } from '../../components/batch/BatchPanel';
import { toolDefinition } from '../../registry/useToolDefinition';

const tool = toolDefinition('rotate');

// `refresh` is reserved for "convert" and "re-run"; a rotation is a rotation.
const ROTATION_OPTIONS: { deg: 90 | 180 | 270; label: string; icon: 'rotate'; style?: CSSProperties }[] = [
  { deg: 270, label: '90° left', icon: 'rotate', style: { transform: 'scaleX(-1)' } },
  { deg: 90, label: '90° right', icon: 'rotate' },
  { deg: 180, label: '180°', icon: 'rotate' },
];

export default function RotateTool() {
  const pipeline = useImagePipeline();
  const batch = useImageBatch();
  const { formats, ready } = useImageFormats();
  const { toast } = useToast();

  const source = pipeline.input;
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [format, setFormat] = useState<ImageFormat>('image/png');
  const [quality, setQuality] = useState(90);
  const previewUrl = useObjectUrl(source?.file ?? null);

  const swapped = rotate === 90 || rotate === 270;
  const previewWidth = source ? (swapped ? source.height : source.width) : 0;
  const previewHeight = source ? (swapped ? source.width : source.height) : 0;

  const job = { format, quality: quality / 100, rotate, flipH, flipV };

  const run = async () => {
    if (!source) return;
    const result = await pipeline.run(job);
    if (result) toast(`Transformed to ${result.width} × ${result.height}px`, 'success');
  };

  const runBatch = () =>
    batch.start({ job, extension: extensionForFormat(format), suffix: 'rotated', archiveName: 'zeroupload-transformed.zip' });

  // A rejected batch has no items but does have an error worth rendering.
  const inBatch = batch.items.length > 0 || batch.error !== null;
  const pending = batch.summary.pending;
  const runAll = () => void (inBatch ? runBatch() : run());
  const busy = inBatch ? batch.status === 'running' || batch.status === 'cancelling' : pipeline.busy;
  const runDisabled = busy || (inBatch && pending === 0);

  /*
   * Rotation changes the container as much as the pixels: a re-encode can halve a
   * JPEG or double it, and the geometry itself is worth confirming before the
   * button is pressed ("did I mean 90° or 270°?").
   */
  const estimate = useOutputEstimate(pipeline.input, job, { enabled: !pipeline.busy && !inBatch });

  const rows: OutcomeRow[] = [];
  if (source && !inBatch) {
    const turns = rotate === 0 ? 'Unrotated' : `${rotate}° ${rotate === 90 ? 'clockwise' : rotate === 270 ? 'anticlockwise' : ''}`.trim();
    const mirrors = [flipH ? 'mirrored horizontally' : null, flipV ? 'mirrored vertically' : null].filter(Boolean);
    rows.push({
      label: 'Geometry',
      value: mirrors.length ? `${turns} · ${mirrors.join(' · ')}` : turns,
    });
    rows.push({
      label: 'Dimensions',
      value:
        rotate === 0 && !flipH && !flipV
          ? `${source.width} × ${source.height} · unchanged`
          : `${previewWidth} × ${previewHeight}px`,
    });
    if (estimate.estimate) {
      rows.push({ label: 'Output size', value: formatBytes(estimate.estimate.blob.size) });
    } else if (estimate.measuring || estimate.stale) {
      rows.push({ label: 'Output size', value: 'measuring…' });
    } else {
      // Only reachable for sources above the auto-measure budget, where the panel
      // offers a button instead of quietly encoding a 40-megapixel photo.
      rows.push({ label: 'Output size', value: 'not measured', hint: 'manual' });
    }
  }

  const resetGeometry = () => {
    setRotate(0);
    setFlipH(false);
    setFlipV(false);
  };

  return (
    <ToolLayout
      tool={tool}
      aside={
        source || inBatch ? (
          <Settings
            title="Geometry"
            footer={
              <button type="button" className="btn btn--primary btn--block" onClick={runAll} disabled={runDisabled}>
                {busy ? <Spinner /> : <Icon name="rotate" size={14} />}
                {busy
                  ? 'Applying…'
                  : inBatch
                    ? pending === 0
                      ? 'Queue finished'
                      : `Transform ${pending} ${pending === 1 ? 'image' : 'images'}`
                    : 'Apply transform'}
              </button>
            }
          >
            <Field label="Rotation">
              <div className="geometry-grid">
                {ROTATION_OPTIONS.map((option) => (
                  <button
                    key={option.deg}
                    type="button"
                    className="geometry-btn"
                    aria-pressed={rotate === option.deg}
                    onClick={() => setRotate(option.deg)}
                  >
                    <Icon name={option.icon} size={13} style={option.style} />
                    {option.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Mirror">
              <div className="geometry-grid">
                <button type="button" className="geometry-btn" aria-pressed={flipH} onClick={() => setFlipH((v) => !v)}>
                  <Icon name="flip" size={13} /> Horizontal
                </button>
                <button
                  type="button"
                  className="geometry-btn"
                  aria-pressed={flipV}
                  onClick={() => setFlipV((v) => !v)}
                >
                  <Icon name="flip" size={13} style={{ transform: 'rotate(90deg)' }} /> Vertical
                </button>
              </div>
            </Field>

            <button type="button" className="btn btn--ghost btn--sm" onClick={resetGeometry}>
              <Icon name="refresh" size={13} /> Reset geometry
            </button>

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
              note="Measured by encoding this image with the transform applied, on this device."
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
              title="Drop images to rotate or flip"
              hint="One image or up to fifty at once. Camera orientation is respected, so the result matches what you see."
              icon="rotate"
            />
            {pipeline.error ? <Notice tone="danger" title="Could not open this file">{pipeline.error.message}</Notice> : null}
          </>
        ) : (
          <>
            <div className="row row--between row--wrap">
              <span className="section-title">Live preview</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={pipeline.reset}>
                <Icon name="x" size={13} /> Clear
              </button>
            </div>

            <FileCard file={source.file} onRemove={pipeline.reset} subtitle={`${source.width} × ${source.height}px`} />
            <ImageChecks file={source.file} />

            <div className="crop-stage">
              {previewUrl ? (
                <img
                  className="transform-preview"
                  src={previewUrl}
                  alt="Transform preview"
                  style={{
                    transform: `rotate(${rotate}deg) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`,
                    maxWidth: swapped ? 'min(100%, 52vh)' : '100%',
                  }}
                />
              ) : null}
            </div>

            <div className="crop-readout">
              <span>Source <strong>{source.width} × {source.height}</strong></span>
              <span>Output <strong>{previewWidth} × {previewHeight}</strong></span>
              <span>Rotation <strong>{rotate}°</strong></span>
              <span>Mirror <strong>{flipH || flipV ? [flipH && 'H', flipV && 'V'].filter(Boolean).join(' + ') : 'none'}</strong></span>
            </div>

            {pipeline.busy || pipeline.stage === 'done' ? (
              <StageTimeline stages={[...STAGE_STEPS]} states={stageStates(pipeline.stage)} />
            ) : null}

            {pipeline.error ? <Notice tone="danger" title="Transform failed">{pipeline.error.message}</Notice> : null}

            {pipeline.result ? (
              <ResultPanel
                title={`Transformed · ${pipeline.result.width} × ${pipeline.result.height}px`}
                preview={pipeline.result.blob}
                originalBytes={source.file.size}
                outputBlob={pipeline.result.blob}
                filename={outputName(source.file.name, extensionForFormat(format), 'rotated')}
                onRerun={run}
                onReset={pipeline.reset}
                downloadLabel={`Download ${extensionForFormat(format).toUpperCase()}`}
              />
            ) : (
              <div className="row row--wrap">
                <Segmented
                  label="Quick rotation"
                  value={String(rotate)}
                  onChange={(value) => setRotate(Number(value) as 0 | 90 | 180 | 270)}
                  options={[
                    { value: '0', label: '0°' },
                    { value: '90', label: '90°' },
                    { value: '180', label: '180°' },
                    { value: '270', label: '270°' },
                  ]}
                />
              </div>
            )}
          </>
        )}
      </div>
    </ToolLayout>
  );
}
