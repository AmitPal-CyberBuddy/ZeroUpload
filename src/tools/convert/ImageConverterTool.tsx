import { useEffect, useMemo, useState } from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { CompareSizes } from '../../components/tool/CompareSizes';
import { Field, Notice, RangeField, Segmented, Toggle, type SegmentOption } from '../../components/ui/controls';
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

const tool = getTool('image-converter')!;

const DEFAULT_FORMAT: ImageFormat = 'image/webp';

export default function ImageConverterTool() {
  const pipeline = useImagePipeline();
  const batch = useImageBatch();
  const { formats, ready } = useImageFormats();
  const { toast } = useToast();
  const [format, setFormat] = useState<ImageFormat>(DEFAULT_FORMAT);
  const [quality, setQuality] = useState(82);
  const [keepMetadata, setKeepMetadata] = useState(false);

  const resultUrl = useObjectUrl(pipeline.result?.blob ?? null);
  const originalUrl = useObjectUrl(pipeline.input?.file ?? null);

  const availableFormats = useMemo<SegmentOption<ImageFormat>[]>(() => {
    return IMAGE_FORMATS.map((f) => ({
      value: f.value,
      label: f.label,
      disabled: ready && !formats.includes(f.value),
      title: ready && !formats.includes(f.value) ? 'This browser cannot encode this format' : undefined,
    }));
  }, [formats, ready]);

  // Keep the selected format valid as capabilities resolve.
  useEffect(() => {
    if (ready && formats.length > 0 && !formats.includes(format)) {
      setFormat(formats.find((f) => f === 'image/webp') ?? formats[0]);
    }
  }, [formats, format, ready]);

  const inputType = pipeline.input?.detectedType;
  const alreadyInFormat = inputType === format;
  const lossy = isLossy(format);

  const job = { format, quality: quality / 100, autoOrient: !keepMetadata };

  const convert = async () => {
    const result = await pipeline.run(job);
    if (result) toast('Converted locally — ready to download', 'success');
  };

  const convertBatch = () =>
    batch.start({ job, extension: extensionForFormat(format), archiveName: 'zeroupload-converted.zip' });

  // A rejected batch has no items but does have an error worth rendering.
  const inBatch = batch.items.length > 0 || batch.error !== null;
  const pending = batch.summary.pending;
  const runAll = () => void (inBatch ? convertBatch() : convert());
  const busy = inBatch ? batch.status === 'running' || batch.status === 'cancelling' : pipeline.busy;
  const runDisabled = busy || (inBatch && pending === 0);

  /*
   * A format conversion is exactly the case where the result is invisible until
   * you run it: JPEG → WebP at quality 82 might halve the file or inflate it, and
   * nothing in the pixel preview tells you which. Measuring it settles the
   * question before the button is pressed.
   */
  const estimate = useOutputEstimate(pipeline.input, job, { enabled: !pipeline.busy && !inBatch });

  const rows: OutcomeRow[] = [];
  if (pipeline.input && !inBatch) {
    const sourceLabel = (inputType ?? '').replace('image/', '').toUpperCase() || 'source';
    rows.push({ label: 'From', value: `${sourceLabel} · ${formatBytes(pipeline.input.file.size)}` });
    rows.push({
      label: 'To',
      value: lossy ? `${labelForFormat(format)} · quality ${quality}` : `${labelForFormat(format)} · lossless`,
    });
    if (estimate.estimate) {
      const saved = savingsPercent(pipeline.input.file.size, estimate.estimate.blob.size);
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
        pipeline.input || inBatch ? (
          <Settings
            title="Output"
            footer={
              <button type="button" className="btn btn--primary btn--block" onClick={runAll} disabled={runDisabled}>
                {busy ? <Spinner label="Converting" /> : <Icon name="refresh" size={14} />}
                {busy
                  ? 'Converting…'
                  : inBatch
                    ? pending === 0
                      ? 'Queue finished'
                      : `Convert ${pending} ${pending === 1 ? 'image' : 'images'} to ${IMAGE_FORMATS.find((f) => f.value === format)?.label}`
                    : `Convert to ${IMAGE_FORMATS.find((f) => f.value === format)?.label}`}
              </button>
            }
          >
            <Field label="Target format" hint={alreadyInFormat ? 'Same as the source format.' : undefined}>
              <Segmented
                label="Target format"
                value={format}
                onChange={(next) => setFormat(next)}
                options={availableFormats}
              />
            </Field>

            {lossy ? (
              <RangeField
                label="Quality"
                min={30}
                max={100}
                value={quality}
                onChange={setQuality}
                format={(v) => `${v}`}
                hint="Higher quality means a larger file."
              />
            ) : (
              <Notice tone="default" icon="info">
                PNG is lossless — the quality dial does not apply.
              </Notice>
            )}

            <Toggle
              checked={keepMetadata}
              onChange={setKeepMetadata}
              label="Ignore EXIF orientation"
              hint="Off means the photo is auto-rotated as the camera intended."
            />

            {pipeline.input?.mismatch ? (
              <Notice tone="warn" title="Extension mismatch">
                This file is labelled {pipeline.input.file.type || 'unknown'}, but its contents are{' '}
                {pipeline.input.detectedType}. The contents are what count.
              </Notice>
            ) : null}

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
              note="Measured by encoding this image with the settings above, on this device."
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
              title="Drop images to convert"
              hint="JPEG, PNG, WebP, AVIF or GIF. One file, or up to fifty at once — all processed on your device."
              icon="image"
              disabled={pipeline.busy}
            />
            {pipeline.error ? (
              <Notice tone="danger" title="Could not open this file">
                {pipeline.error.message}
                {pipeline.error.hint ? <div className="hint">{pipeline.error.hint}</div> : null}
              </Notice>
            ) : null}
            {pipeline.stage === 'reading' ? <StageTimeline stages={[...STAGE_STEPS]} states={stageStates('reading')} /> : null}
            <div className="tool-notes">
              <div>
                <Icon name="cpu" size={15} />
                <strong>Original untouched</strong>
                <p>
                  Your source file is never modified. The converted copy is created separately, so the
                  original stays exactly as it was.
                </p>
              </div>
              <div>
                <Icon name="alert" size={15} />
                <strong>Format support varies</strong>
                <p>
                  AVIF is not available in every browser, so formats your browser cannot write are disabled
                  rather than quietly replaced by something else.
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
              <Notice tone="danger" title="Conversion failed">
                {pipeline.error.message}
                {pipeline.error.hint ? <div className="hint">{pipeline.error.hint}</div> : null}
              </Notice>
            ) : null}

            {pipeline.result ? (
              <div className="result">
                <div className="result__head">
                  <span className="result__title">
                    <i className="dot" aria-hidden="true" />
                    Converted · {IMAGE_FORMATS.find((f) => f.value === pipeline.result?.format)?.label}
                  </span>
                  <span className="badge">{pipeline.result.width} × {pipeline.result.height}px</span>
                </div>

                <CompareSizes original={pipeline.input.file.size} output={pipeline.result.blob.size} />

                <div className="result__preview">
                  {resultUrl ? <img src={resultUrl} alt="Converted preview" /> : null}
                </div>

                <div className="result__actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() =>
                      triggerDownload(
                        pipeline.result!.blob,
                        outputName(pipeline.input!.file.name, extensionForFormat(format)),
                      )
                    }
                  >
                    <Icon name="download" size={15} />
                    Download {extensionForFormat(format).toUpperCase()}
                  </button>
                  <button type="button" className="btn btn--secondary" onClick={convert} disabled={pipeline.busy}>
                    <Icon name="refresh" size={14} /> Re-run
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={pipeline.reset}>
                    Process another
                  </button>
                </div>
              </div>
            ) : (
              <div className="side-by-side">
                <figure className="preview-frame">
                  <figcaption className="mono">SOURCE</figcaption>
                  {originalUrl ? <img src={originalUrl} alt="Source preview" /> : null}
                </figure>
                <div className="preview-placeholder">
                  <Icon name="refresh" size={22} />
                  <p>Choose a target format, then convert. Your result appears here, ready to download.</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ToolLayout>
  );
}
