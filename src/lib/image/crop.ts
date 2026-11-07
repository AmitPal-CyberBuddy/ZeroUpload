/**
 * Crop-frame geometry, with no React and no DOM in it.
 *
 * This lived inside `CropTool.tsx`, which meant the only way to check the
 * clamping rules was to drag a rectangle by hand. They are the rules that decide
 * whether a crop silently eats a few pixels off the edge of an image or produces a
 * zero-width selection, so they belong where a test can call them:
 *
 *  - a rectangle is always inside the source image,
 *  - it is never smaller than `MIN_SIZE`,
 *  - an aspect ratio is honoured by reducing the *other* dimension, and
 *  - every keyboard nudge goes through the same two functions as a pointer drag,
 *    so the frame cannot drift out of bounds just because it was moved with a key.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_SIZE = 16;

/** The largest frame with `aspect` that fits in the image, centred. Free → whole image. */
export function initialRect(width: number, height: number, aspect: number | null): Rect {
  if (!aspect) return { x: 0, y: 0, width, height };
  let w = width;
  let h = Math.round(width / aspect);
  if (h > height) {
    h = height;
    w = Math.round(height * aspect);
  }
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), width: w, height: h };
}

export function clampRect(rect: Rect, maxWidth: number, maxHeight: number): Rect {
  const width = Math.min(Math.max(MIN_SIZE, rect.width), maxWidth);
  const height = Math.min(Math.max(MIN_SIZE, rect.height), maxHeight);
  const x = Math.min(Math.max(0, rect.x), maxWidth - width);
  const y = Math.min(Math.max(0, rect.y), maxHeight - height);
  return { x, y, width, height };
}

export type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export function resizeRect(
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
    /*
     * A locked ratio should follow the pointer, not ignore it.
     *
     * The previous version shrank the frame to whichever axis was smaller, so
     * dragging a corner sideways on a 1:1 selection did nothing at all until you
     * also dragged down — a locked ratio that blocks the gesture you just made
     * reads as a broken handle. Take the larger of the two axes instead, then
     * scale the pair down together if it no longer fits: the ratio is preserved
     * either way, and the corner the pointer grabbed stays under it.
     */
    const grown = Math.max(width, height * aspect);
    width = grown;
    height = grown / aspect;

    const leftAnchored = drag.mode === 'nw' || drag.mode === 'sw';
    const bottomAnchored = drag.mode === 'nw' || drag.mode === 'ne';
    if (leftAnchored) left = right - width;
    if (bottomAnchored) top = bottom - height;

    const roomX = maxWidth - Math.max(0, left);
    const roomY = maxHeight - Math.max(0, top);
    const factor = Math.min(1, roomX / width, roomY / height);
    if (factor < 1) {
      width *= factor;
      height *= factor;
    }

    if (leftAnchored) left = right - width;
    if (bottomAnchored) top = bottom - height;
    if (width < MIN_SIZE || height < MIN_SIZE) {
      const scale = Math.max(MIN_SIZE / width, MIN_SIZE / height);
      width *= scale;
      height *= scale;
    }
  }

  return clampRect({ x: left, y: top, width, height }, maxWidth, maxHeight);
}

/**
 * Keyboard control of the frame.
 *
 * Arrow keys move it; Alt + arrow resizes it (the arrow points at the edge that
 * moves, so Alt+Right widens and Alt+Left narrows); Shift makes either step ten
 * pixels. Anything that is not an arrow key returns `null`, which lets the
 * component leave the event alone — a keydown handler that swallows Tab or
 * Escape is worse than no handler.
 */
export type NudgeKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

export function nudgeRect(
  rect: Rect,
  key: NudgeKey,
  options: { resize?: boolean; step?: number; aspect?: number | null; maxWidth: number; maxHeight: number } ,
): Rect {
  const { resize = false, step = 1, aspect = null, maxWidth, maxHeight } = options;
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const sign = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;

  if (!resize) {
    const dx = horizontal ? sign * step : 0;
    const dy = horizontal ? 0 : sign * step;
    return resizeRect({ mode: 'move', rect }, dx, dy, maxWidth, maxHeight, null);
  }

  /*
   * Resizing keeps the top-left corner and moves the bottom-right. With an
   * aspect ratio locked, the *other* dimension follows from the one being
   * nudged, and a nudge that would overflow the image is ignored rather than
   * shrinking the frame — pressing Alt+Right at the edge should do nothing, not
   * make the selection jump.
   */
  let width = rect.width + (horizontal ? sign * step : 0);
  let height = rect.height + (horizontal ? 0 : sign * step);

  if (aspect) {
    if (horizontal) height = width / aspect;
    else width = height * aspect;
  }

  width = Math.max(MIN_SIZE, width);
  height = Math.max(MIN_SIZE, height);

  if (rect.x + width > maxWidth || rect.y + height > maxHeight) return rect;

  return { ...rect, width, height };
}
