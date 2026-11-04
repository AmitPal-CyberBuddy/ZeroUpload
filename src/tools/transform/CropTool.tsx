import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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

const tool = getTool('crop')!;
const ASPECTS = [
  { id: 'free', label: 'Free', value: null },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '4:3', label: '4:3', value: 4 / 3 },
  { id: '16:9', label: '16:9', value: 16 / 9 },
  { id: '3:2', label: '3:2', value: 3 / 2 },
] as const;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

const MIN_SIZE = 16;

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
              hint="Drag the frame to choose a region. The coordinates follow the original image."
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
              <p className="visually-hidden">
                The crop area can be adjusted with the X, Y, width and height fields in the settings panel, or
                dragged with a pointer.
              </p>
              <div className="crop-canvas-wrap">
                {imageUrl ? <img ref={imgRef} src={imageUrl} alt="Crop source" onLoad={measure} draggable={false} /> : null}
                <div
                  className="crop-rect"
                  aria-hidden="true"
                  style={{
                    left: crop.x * scale,
                    top: crop.y * scale,
                    width: crop.width * scale,
                    height: crop.height * scale,
                  }}
                  onPointerDown={beginDrag('move')}
                >
                  {(['nw', 'ne', 'sw', 'se'] as const).map((pos) => (
                    <span key={pos} className="crop-handle" data-pos={pos} onPointerDown={beginDrag(pos)} />
                  ))}
                </div>
              </div>
            </div>

            <div className="crop-readout">
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

/* ------------------------------ helpers --------------------------------- */

function initialRect(width: number, height: number, aspect: number | null): Rect {
  if (!aspect) return { x: 0, y: 0, width, height };
  let w = width;
  let h = Math.round(width / aspect);
  if (h > height) {
    h = height;
    w = Math.round(height * aspect);
  }
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), width: w, height: h };
}

function clampRect(rect: Rect, maxWidth: number, maxHeight: number): Rect {
  const width = Math.min(Math.max(MIN_SIZE, rect.width), maxWidth);
  const height = Math.min(Math.max(MIN_SIZE, rect.height), maxHeight);
  const x = Math.min(Math.max(0, rect.x), maxWidth - width);
  const y = Math.min(Math.max(0, rect.y), maxHeight - height);
  return { x, y, width, height };
}

function resizeRect(
  drag: { mode: DragMode; rect: Rect },
  dx: number,
  dy: number,
  maxWidth: number,
  maxHeight: number,
  aspect: number | null,
): Rect {
  const start = drag.rect;

  if (drag.mode === 'move') {
    return {
      ...start,
      x: Math.min(Math.max(0, start.x + dx), maxWidth - start.width),
      y: Math.min(Math.max(0, start.y + dy), maxHeight - start.height),
    };
  }

  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;

  if (drag.mode === 'nw' || drag.mode === 'sw') left = Math.min(Math.max(0, start.x + dx), right - MIN_SIZE);
  if (drag.mode === 'ne' || drag.mode === 'se') right = Math.max(Math.min(maxWidth, start.x + start.width + dx), left + MIN_SIZE);
  if (drag.mode === 'nw' || drag.mode === 'ne') top = Math.min(Math.max(0, start.y + dy), bottom - MIN_SIZE);
  if (drag.mode === 'sw' || drag.mode === 'se') bottom = Math.max(Math.min(maxHeight, start.y + start.height + dy), top + MIN_SIZE);

  let width = right - left;
  let height = bottom - top;

  if (aspect) {
    if (width / height > aspect) {
      width = height * aspect;
    } else {
      height = width / aspect;
    }
    if (drag.mode === 'nw' || drag.mode === 'sw') left = right - width;
    if (drag.mode === 'nw' || drag.mode === 'ne') top = bottom - height;
    width = Math.min(width, maxWidth - Math.max(0, left));
    height = Math.min(height, maxHeight - Math.max(0, top));
  }

  return clampRect({ x: left, y: top, width, height }, maxWidth, maxHeight);
}
