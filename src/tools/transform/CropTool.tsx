import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
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
import { useOutputEstimate } from '../../hooks/useOutputEstimate';
import { Outcome, type OutcomeRow } from '../../components/tool/Outcome';
import { formatBytes, formatPercent } from '../../lib/files/format';
import {
  clampRect,
  initialRect,
  nudgeRect,
  resizeRect,
  type DragMode,
  type NudgeKey,
  type Rect,
} from '../../lib/image/crop';

const tool = getTool('crop')!;
const ASPECTS = [
  { id: 'free', label: 'Free', value: null },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '4:3', label: '4:3', value: 4 / 3 },
  { id: '16:9', label: '16:9', value: 16 / 9 },
  { id: '3:2', label: '3:2', value: 3 / 2 },
] as const;

export default function CropTool() {
  const pipeline = useImagePipeline();
  const { formats, ready } = useImageFormats();
  const { toast } = useToast();

  const source = pipeline.input;
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, width: 1, height: 1 });
  const [aspectId, setAspectId] = useState<string>('free');
  const [format, setFormat] = useState<ImageFormat>('image/png');
  const [quality, setQuality] = useState(90);

  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [display, setDisplay] = useState({ width: 0, height: 0 });
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; rect: Rect } | null>(null);
  const imageUrl = useObjectUrl(source?.file ?? null);

  /* Initialise the crop frame when a new source arrives. */
  useEffect(() => {
    if (!source) return;
    const aspect = ASPECTS.find((a) => a.id === aspectId)?.value ?? null;
    setCrop(initialRect(source.width, source.height, aspect));
  }, [source, aspectId]);

  /* Track the rendered size so overlay coordinates map to source pixels. */
  const measure = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setDisplay({ width: img.clientWidth, height: img.clientHeight });
  }, []);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (imgRef.current) observer.observe(imgRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, imageUrl]);

  const scale = display.width && source ? display.width / source.width : 1;
  const aspect = ASPECTS.find((a) => a.id === aspectId)?.value ?? null;

  /*
   * Keyboard path.
   *
   * The four number fields in the settings panel were the only way to move the
   * frame without a pointer, and they are not a real alternative: they are in a
   * different column, they need the crop coordinates read off the image, and
   * adjusting one edge twice means tabbing back and forth. The frame itself is
   * now focusable and answers the arrow keys, using the same clamps as a drag so
   * the two cannot disagree about the image's edges.
   *
   * Keys that are not arrows are left alone — swallowing Tab or Escape inside a
   * widget is how a keyboard user gets trapped.
   */
  const nudge = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!source) return;
    if (!event.key.startsWith('Arrow')) return;
    event.preventDefault();
    setCrop(
      nudgeRect(crop, event.key as NudgeKey, {
        resize: event.altKey,
        step: event.shiftKey ? 10 : 1,
        aspect,
        maxWidth: source.width,
        maxHeight: source.height,
      }),
    );
  };

  const beginDrag = (mode: DragMode) => (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, rect: { ...crop } };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  useEffect(() => {
    if (!source) return;

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !scale) return;
      const dx = (event.clientX - drag.startX) / scale;
      const dy = (event.clientY - drag.startY) / scale;
      const aspect = ASPECTS.find((a) => a.id === aspectId)?.value ?? null;
      setCrop(resizeRect(drag, dx, dy, source.width, source.height, aspect));
    };

    const onUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [aspectId, scale, source]);

  /*
   * A crop is destructive in the sense that matters to the user: whatever is
   * outside the frame is gone from the output. The panel answers the two
   * questions the frame cannot — exactly how many pixels survive, and what the
   * file weighs afterwards.
   */
  const estimate = useOutputEstimate(
    source,
    source
      ? {
          format,
          quality: quality / 100,
          crop: {
            x: Math.round(crop.x),
            y: Math.round(crop.y),
            width: Math.max(1, Math.round(crop.width)),
            height: Math.max(1, Math.round(crop.height)),
          },
        }
      : null,
    { enabled: !pipeline.busy },
  );

  const rows: OutcomeRow[] = [];
  if (source) {
    const kept = (crop.width * crop.height) / (source.width * source.height);
    rows.push({
      label: 'Selection',
      value: `${Math.round(crop.width)} × ${Math.round(crop.height)}px`,
    });
    rows.push({
      label: 'Kept',
      value: `${formatPercent(kept)} of the image${kept < 1 ? ` · ${formatPercent(1 - kept)} discarded` : ' · nothing discarded'}`,
      tone: kept < 0.15 ? 'warn' : undefined,
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

  const run = async () => {
    if (!source) return;
    const result = await pipeline.run({
      format,
      quality: quality / 100,
      crop: {
        x: Math.round(crop.x),
        y: Math.round(crop.y),
        width: Math.max(1, Math.round(crop.width)),
        height: Math.max(1, Math.round(crop.height)),
      },
    });
    if (result) toast(`Cropped to ${result.width} × ${result.height}px`, 'success');
  };

  return (
    <ToolLayout
      tool={tool}
      aside={
        source ? (
          <Settings
            title="Crop"
            footer={
              <button type="button" className="btn btn--primary btn--block" onClick={run} disabled={pipeline.busy}>
                {pipeline.busy ? <Spinner /> : <Icon name="crop" size={14} />}
                {pipeline.busy ? 'Cropping…' : 'Crop image'}
              </button>
            }
          >
            <Field label="Aspect ratio">
              <Segmented
                label="Aspect ratio"
                value={aspectId}
                onChange={setAspectId}
                options={ASPECTS.map((aspect) => ({ value: aspect.id, label: aspect.label }))}
              />
            </Field>

            <div className="dimension-grid">
              <Field label="X" htmlFor="crop-x">
                <input
                  id="crop-x"
                  className="input input--mono"
                  type="number"
                  value={Math.round(crop.x)}
                  min={0}
                  max={source.width - 1}
                  onChange={(event) => setCrop((c) => clampRect({ ...c, x: Number(event.target.value) }, source.width, source.height))}
                />
              </Field>
              <Field label="Y" htmlFor="crop-y">
                <input
                  id="crop-y"
                  className="input input--mono"
                  type="number"
                  value={Math.round(crop.y)}
                  min={0}
                  max={source.height - 1}
                  onChange={(event) => setCrop((c) => clampRect({ ...c, y: Number(event.target.value) }, source.width, source.height))}
                />
              </Field>
              <Field label="Width" htmlFor="crop-w">
                <input
                  id="crop-w"
                  className="input input--mono"
                  type="number"
                  value={Math.round(crop.width)}
                  min={1}
                  max={source.width}
                  onChange={(event) =>
                    setCrop((c) => {
                      const width = Math.max(1, Number(event.target.value));
                      const aspect = ASPECTS.find((a) => a.id === aspectId)?.value ?? null;
                      return clampRect({ ...c, width, height: aspect ? Math.round(width / aspect) : c.height }, source.width, source.height);
                    })
                  }
                />
              </Field>
              <Field label="Height" htmlFor="crop-h">
                <input
                  id="crop-h"
                  className="input input--mono"
                  type="number"
                  value={Math.round(crop.height)}
                  min={1}
                  max={source.height}
                  onChange={(event) =>
                    setCrop((c) => {
                      const height = Math.max(1, Number(event.target.value));
                      const aspect = ASPECTS.find((a) => a.id === aspectId)?.value ?? null;
                      return clampRect({ ...c, height, width: aspect ? Math.round(height * aspect) : c.width }, source.width, source.height);
                    })
                  }
                />
              </Field>
            </div>

            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setCrop(initialRect(source.width, source.height, null))}>
              Reset selection
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
              note="Measured by encoding the selected region, on this device."
            />
          </Settings>
        ) : null
      }
    >
      <div className="tool-body">
        {!source ? (
          <>
            <FileDrop
              accept="image/*"
              onFiles={(files) => pipeline.load(files[0])}
              title="Drop an image to crop"
              hint="Drag the frame to choose a region, or focus it and use the arrow keys. The coordinates follow the original image."
              icon="crop"
            />
            {pipeline.error ? <Notice tone="danger" title="Could not open this file">{pipeline.error.message}</Notice> : null}
          </>
        ) : (
          <>
            <div className="row row--between row--wrap">
              <span className="section-title">Crop frame</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={pipeline.reset}>
                <Icon name="x" size={13} /> Clear
              </button>
            </div>

            <FileCard file={source.file} onRemove={pipeline.reset} subtitle={`${source.width} × ${source.height}px`} />

            <div className="crop-stage" ref={stageRef} role="group" aria-label="Crop area preview">
              <p className="visually-hidden" id="crop-keys">
                Crop frame. Arrow keys move it one pixel, Shift and an arrow key move it ten. Alt and an arrow
                key resize it, with Shift for ten pixels. The same values can be typed into the X, Y, width and
                height fields in the settings panel.
              </p>
              <div className="crop-canvas-wrap">
                {imageUrl ? <img ref={imgRef} src={imageUrl} alt="Crop source" onLoad={measure} draggable={false} /> : null}
                <div
                  className="crop-rect"
                  tabIndex={0}
                  role="group"
                  aria-roledescription="crop frame"
                  aria-label={`Crop frame, ${Math.round(crop.width)} by ${Math.round(crop.height)} pixels, starting at ${Math.round(crop.x)}, ${Math.round(crop.y)}`}
                  aria-describedby="crop-keys"
                  style={{
                    left: crop.x * scale,
                    top: crop.y * scale,
                    width: crop.width * scale,
                    height: crop.height * scale,
                  }}
                  onPointerDown={beginDrag('move')}
                  onKeyDown={nudge}
                >
                  {(['nw', 'ne', 'sw', 'se'] as const).map((pos) => (
                    <span key={pos} className="crop-handle" data-pos={pos} onPointerDown={beginDrag(pos)} />
                  ))}
                </div>
              </div>
            </div>

            {/* Announced politely: the frame moves on every arrow press, and a
                screen reader should hear where it landed without being spammed. */}
            <div className="crop-readout" aria-live="polite" aria-atomic="true">
              <span>Selection <strong>{Math.round(crop.width)} × {Math.round(crop.height)} px</strong></span>
              <span>Origin <strong>{Math.round(crop.x)}, {Math.round(crop.y)}</strong></span>
              <span>Source <strong>{source.width} × {source.height}</strong></span>
            </div>

            {pipeline.busy || pipeline.stage === 'done' ? (
              <StageTimeline stages={[...STAGE_STEPS]} states={stageStates(pipeline.stage)} />
            ) : null}

            {pipeline.error ? <Notice tone="danger" title="Crop failed">{pipeline.error.message}</Notice> : null}

            {pipeline.result ? (
              <ResultPanel
                title={`Cropped · ${pipeline.result.width} × ${pipeline.result.height}px`}
                preview={pipeline.result.blob}
                originalBytes={source.file.size}
                outputBlob={pipeline.result.blob}
                filename={outputName(source.file.name, extensionForFormat(format), 'crop')}
                onRerun={run}
                onReset={pipeline.reset}
                downloadLabel={`Download ${extensionForFormat(format).toUpperCase()}`}
              />
            ) : (
              <div className="row row--wrap">
                <button type="button" className="btn btn--primary" onClick={run} disabled={pipeline.busy}>
                  {pipeline.busy ? <Spinner /> : <Icon name="crop" size={14} />}
                  {pipeline.busy ? 'Cropping…' : 'Apply crop'}
                </button>
                <span className="hint">The output is re-encoded; the original file on disk is untouched.</span>
              </div>
            )}
          </>
        )}
      </div>
    </ToolLayout>
  );
}
