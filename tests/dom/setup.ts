import { afterEach, beforeEach, vi } from 'vitest';

/**
 * The browser surface that jsdom does not implement, filled in only where a
 * component touches it on mount.
 *
 * Each shim below is deliberate and commented, because a shim that is broader than
 * the component's real use is how a DOM test starts passing for the wrong reason.
 */

// --- ResizeObserver ---------------------------------------------------------
// jsdom has no layout engine, so it has no ResizeObserver at all. The crop tool
// observes its stage to keep the frame in the right coordinate space; with no
// layout the honest behaviour is "never fires", which is what this does.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// --- matchMedia -------------------------------------------------------------
// Used by the theme hook and by `prefers-reduced-motion` checks. Reports "no
// preference" for everything, which is the desktop default.
const matchMediaStub = (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;

// --- URL object handles -----------------------------------------------------
// `useObjectUrl` creates and revokes blob URLs. jsdom implements neither, and the
// point of the test is the *cleanup* contract, so this records the pairs.
let revoked: string[] = [];
let created = 0;

// --- Canvas -----------------------------------------------------------------
// Image capability probing (`useImageFormats`) asks a canvas whether it can encode
// a format. jsdom's canvas is a stub that throws "not implemented"; returning a
// small data URL is enough for the probe to take its "supported" branch.
HTMLCanvasElement.prototype.toDataURL = function toDataURL() {
  return 'data:image/png;base64,iVBORw0KGgo=';
};
// Cast through `unknown`: jsdom's overload set is wider than the stub, and the
// point is only that a probe asking for a 2d context gets something usable.
HTMLCanvasElement.prototype.getContext = (function getContext() {
  return {
    drawImage: () => {},
    fillRect: () => {},
    clearRect: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: () => {},
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    setTransform: () => {},
    scale: () => {},
    translate: () => {},
    save: () => {},
    restore: () => {},
    fillStyle: '#000',
  } as unknown as CanvasRenderingContext2D;
} as unknown) as typeof HTMLCanvasElement.prototype.getContext;

// --- Scroll -----------------------------------------------------------------
// jsdom's `window.scrollTo` logs "not implemented" through virtual console, which
// would otherwise count as a React/DOM error in these tests.
window.scrollTo = () => {};

// React refuses to batch under `act()` unless the environment says so. Vitest has
// `globals: false`, so this is not set for us.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  created = 0;
  revoked = [];

  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('matchMedia', matchMediaStub);

  URL.createObjectURL = vi.fn(() => {
    created += 1;
    return `blob:zeroupload/${created}`;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });

  // WebCrypto exists in Node; the components that use it expect it on `window`.
  if (!window.crypto?.subtle) {
    Object.defineProperty(window, 'crypto', { value: globalThis.crypto, configurable: true });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

export const objectUrls = {
  get created() {
    return created;
  },
  get revoked() {
    return [...revoked];
  },
  /** Every URL handed out has been handed back. */
  get balanced() {
    return created === revoked.length;
  },
};
