import { describe, expect, it } from 'vitest';
import { MIN_SIZE, clampRect, initialRect, nudgeRect, resizeRect } from '../src/lib/image/crop';

/**
 * The crop frame's geometry. These rules decide whether a crop quietly takes a
 * few pixels off the edge, produces a zero-width selection, or refuses to move
 * when it should — and until now they were reachable only by dragging a rectangle
 * with a mouse. The keyboard path goes through the same functions as the pointer,
 * so a bug in one is a bug in both.
 */

const IMAGE = { width: 1000, height: 500 };

describe('initialRect', () => {
  it('starts at the whole image when no ratio is locked', () => {
    expect(initialRect(IMAGE.width, IMAGE.height, null)).toEqual({ x: 0, y: 0, width: 1000, height: 500 });
  });

  it('centres the largest frame that fits the ratio', () => {
    // 1:1 on a 1000×500 image is 500×500, centred horizontally.
    expect(initialRect(IMAGE.width, IMAGE.height, 1)).toEqual({ x: 250, y: 0, width: 500, height: 500 });
    // 16:9 is wider than tall, so height is the constraint.
    const wide = initialRect(IMAGE.width, IMAGE.height, 16 / 9);
    expect(wide.height).toBe(500);
    expect(wide.width).toBe(889);
    expect(wide.x).toBe(56);
  });
});

describe('clampRect', () => {
  it('never leaves the image', () => {
    expect(clampRect({ x: -50, y: -20, width: 300, height: 200 }, 1000, 500)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
    expect(clampRect({ x: 900, y: 400, width: 300, height: 200 }, 1000, 500)).toEqual({
      x: 700,
      y: 300,
      width: 300,
      height: 200,
    });
  });

  it('never goes below the minimum size', () => {
    const tiny = clampRect({ x: 0, y: 0, width: 1, height: 2 }, 1000, 500);
    expect(tiny.width).toBe(MIN_SIZE);
    expect(tiny.height).toBe(MIN_SIZE);
  });
});

describe('resizeRect (pointer drag)', () => {
  it('moves without changing size', () => {
    const moved = resizeRect({ mode: 'move', rect: { x: 100, y: 100, width: 200, height: 100 } }, 30, -10, 1000, 500, null);
    expect(moved).toEqual({ x: 130, y: 90, width: 200, height: 100 });
  });

  it('stops at the edge instead of sliding off it', () => {
    const moved = resizeRect({ mode: 'move', rect: { x: 900, y: 100, width: 200, height: 100 } }, 500, 0, 1000, 500, null);
    expect(moved.x).toBe(800);
    expect(moved.x + moved.width).toBe(1000);
  });

  it('follows the pointer on the axis that moved, without breaking the ratio', () => {
    const start = { x: 0, y: 0, width: 400, height: 400 };
    // Dragged 200 px sideways on a 1:1 lock: the frame grows on both axes, then
    // stops at the image's height rather than ignoring the gesture.
    const resized = resizeRect({ mode: 'se', rect: start }, 200, 0, 1000, 500, 1);
    expect(resized.width).toBe(500);
    expect(resized.height).toBe(500);
    expect(resized.width / resized.height).toBe(1);
  });

  it('keeps the grabbed corner under the pointer when the ratio is locked', () => {
    const start = { x: 300, y: 100, width: 200, height: 200 };
    const resized = resizeRect({ mode: 'nw', rect: start }, -100, 0, 1000, 500, 1);
    // Right and bottom edges stay put; the square grew from 200 to 300 on both
    // axes and the top-left corner followed the pointer.
    expect(resized.x + resized.width).toBe(500);
    expect(resized.y + resized.height).toBe(300);
    expect(resized).toEqual({ x: 200, y: 0, width: 300, height: 300 });
  });
});

describe('nudgeRect (keyboard)', () => {
  const frame = { x: 100, y: 100, width: 200, height: 100 };

  it('moves one pixel per arrow press', () => {
    expect(nudgeRect(frame, 'ArrowRight', { maxWidth: 1000, maxHeight: 500 })).toEqual({ ...frame, x: 101 });
    expect(nudgeRect(frame, 'ArrowUp', { maxWidth: 1000, maxHeight: 500 })).toEqual({ ...frame, y: 99 });
  });

  it('moves ten pixels with Shift', () => {
    expect(nudgeRect(frame, 'ArrowDown', { step: 10, maxWidth: 1000, maxHeight: 500 })).toEqual({ ...frame, y: 110 });
  });

  it('cannot be pushed out of the image', () => {
    const atEdge = { x: 900, y: 400, width: 100, height: 100 };
    expect(nudgeRect(atEdge, 'ArrowRight', { maxWidth: 1000, maxHeight: 500 }).x).toBe(900);
    expect(nudgeRect(atEdge, 'ArrowDown', { maxWidth: 1000, maxHeight: 500 }).y).toBe(400);
  });

  it('resizes with Alt, keeping the top-left corner', () => {
    const resized = nudgeRect(frame, 'ArrowRight', { resize: true, step: 10, maxWidth: 1000, maxHeight: 500 });
    expect(resized).toEqual({ x: 100, y: 100, width: 210, height: 100 });
  });

  it('honours a locked ratio while resizing', () => {
    const square = { x: 0, y: 0, width: 200, height: 200 };
    const wider = nudgeRect(square, 'ArrowRight', { resize: true, step: 10, aspect: 1, maxWidth: 1000, maxHeight: 500 });
    expect(wider.width).toBe(210);
    expect(wider.height).toBe(210);
  });

  it('does nothing rather than jumping when the grow would overflow', () => {
    const nearlyFull = { x: 800, y: 0, width: 200, height: 100 };
    expect(nudgeRect(nearlyFull, 'ArrowRight', { resize: true, step: 10, maxWidth: 1000, maxHeight: 500 })).toEqual(
      nearlyFull,
    );
  });

  it('never shrinks below the minimum, however many presses', () => {
    let rect = { x: 0, y: 0, width: 20, height: 20 };
    for (let i = 0; i < 10; i += 1) {
      rect = nudgeRect(rect, 'ArrowLeft', { resize: true, step: 5, maxWidth: 1000, maxHeight: 500 });
    }
    expect(rect.width).toBe(MIN_SIZE);
  });
});
