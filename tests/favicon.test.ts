import { describe, expect, it } from 'vitest';
import { ICO_LIMITS, buildIco } from '../src/lib/image/ico';
import {
  APPLE_TOUCH_SIZE,
  ICO_SIZES,
  MANIFEST_SIZES,
  PNG_SIZES,
  buildHeadSnippet,
  buildWebManifest,
  iconSizes,
  pngFileName,
  standaloneIconSizes,
} from '../src/lib/image/favicon';

/* ------------------------------------------------------------------ fixtures */

/** A PNG header that satisfies `parsePngSize` and carries a payload we can find. */
function fakePng(size: number, payloadBytes = 8): Uint8Array {
  const bytes = new Uint8Array(33 + payloadBytes);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); // IHDR length
  bytes.set(new TextEncoder().encode('IHDR'), 12);
  view.setUint32(16, size);
  view.setUint32(20, size);
  bytes[24] = 8; // bit depth
  bytes[25] = 6; // RGBA
  for (let i = 0; i < payloadBytes; i += 1) bytes[33 + i] = (size + i) & 0xff;
  return bytes;
}

const readIco = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, true);
  const entries = Array.from({ length: count }, (_, index) => {
    const at = 6 + index * 16;
    return {
      width: bytes[at],
      height: bytes[at + 1],
      palette: bytes[at + 2],
      reserved: bytes[at + 3],
      planes: view.getUint16(at + 4, true),
      bits: view.getUint16(at + 6, true),
      length: view.getUint32(at + 8, true),
      offset: view.getUint32(at + 12, true),
    };
  });
  return { reserved: view.getUint16(0, true), type: view.getUint16(2, true), count, entries };
};

/* ---------------------------------------------------------------------- ico */

describe('building an .ico container', () => {
  it('writes a valid ICONDIR and one entry per image', () => {
    const ico = buildIco([
      { size: 16, png: fakePng(16) },
      { size: 32, png: fakePng(32) },
    ]);
    const dir = readIco(ico);
    expect(dir.reserved).toBe(0);
    expect(dir.type).toBe(1);
    expect(dir.count).toBe(2);
    expect(dir.entries.map((entry) => [entry.width, entry.height])).toEqual([
      [16, 16],
      [32, 32],
    ]);
    expect(dir.entries.every((entry) => entry.planes === 1 && entry.bits === 32 && entry.palette === 0)).toBe(true);
  });

  it('encodes a 256px edge as 0, as the format requires', () => {
    const ico = buildIco([{ size: 256, png: fakePng(256) }]);
    const [entry] = readIco(ico).entries;
    expect(entry.width).toBe(0);
    expect(entry.height).toBe(0);
  });

  it('orders entries by size so the same input always produces the same bytes', () => {
    const forward = buildIco([
      { size: 48, png: fakePng(48) },
      { size: 16, png: fakePng(16) },
      { size: 32, png: fakePng(32) },
    ]);
    const shuffled = buildIco([
      { size: 16, png: fakePng(16) },
      { size: 32, png: fakePng(32) },
      { size: 48, png: fakePng(48) },
    ]);
    expect(readIco(forward).entries.map((entry) => entry.width)).toEqual([16, 32, 48]);
    expect([...forward]).toEqual([...shuffled]);
  });

  it('copies each payload verbatim and points offsets at it', () => {
    const png16 = fakePng(16, 12);
    const png32 = fakePng(32, 20);
    const ico = buildIco([
      { size: 16, png: png16 },
      { size: 32, png: png32 },
    ]);
    const dir = readIco(ico);
    const header = 6 + dir.count * 16;
    expect(dir.entries[0].offset).toBe(header);
    expect(dir.entries[0].length).toBe(png16.byteLength);
    expect(dir.entries[1].offset).toBe(header + png16.byteLength);
    expect([...ico.slice(dir.entries[0].offset, dir.entries[0].offset + png16.byteLength)]).toEqual([...png16]);
    expect([...ico.slice(dir.entries[1].offset, dir.entries[1].offset + png32.byteLength)]).toEqual([...png32]);
    expect(ico.byteLength).toBe(header + png16.byteLength + png32.byteLength);
  });

  it('reads a payload that is a view into a larger buffer', () => {
    const padded = new Uint8Array(fakePng(32).byteLength + 64);
    padded.set(fakePng(32), 64);
    const view = padded.subarray(64);
    const ico = buildIco([{ size: 32, png: view }]);
    const [entry] = readIco(ico).entries;
    expect(entry.length).toBe(view.byteLength);
    expect(ico[entry.offset]).toBe(0x89);
  });

  it('refuses an empty set', () => {
    expect(() => buildIco([])).toThrow(expect.objectContaining({ code: 'empty-input' }));
  });

  it('refuses duplicate sizes', () => {
    expect(() =>
      buildIco([
        { size: 32, png: fakePng(32) },
        { size: 32, png: fakePng(32) },
      ]),
    ).toThrow(expect.objectContaining({ code: 'invalid-input' }));
  });

  it('refuses an edge over 256px or below one pixel', () => {
    for (const size of [0, 257, 512, 16.5]) {
      expect(() => buildIco([{ size, png: fakePng(16) }])).toThrow(
        expect.objectContaining({ code: 'invalid-input' }),
      );
    }
  });

  it('refuses a payload that is not a PNG', () => {
    const jpeg = new Uint8Array(64);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
    expect(() => buildIco([{ size: 16, png: jpeg }])).toThrow(
      expect.objectContaining({ code: 'unsupported-type' }),
    );
  });

  it('refuses a payload whose real dimensions do not match the declared size', () => {
    expect(() => buildIco([{ size: 32, png: fakePng(16) }])).toThrow(
      expect.objectContaining({ code: 'invalid-input' }),
    );
  });

  it('refuses more images than the container limit', () => {
    const many = Array.from({ length: ICO_LIMITS.maxImages + 1 }, (_, index) => ({
      size: index + 1,
      png: fakePng(index + 1),
    }));
    expect(() => buildIco(many)).toThrow(expect.objectContaining({ code: 'limit-exceeded' }));
  });

  it('refuses a payload larger than the byte ceiling', () => {
    const big = fakePng(256, ICO_LIMITS.maxTotalBytes + 1);
    expect(() => buildIco([{ size: 256, png: big }])).toThrow(
      expect.objectContaining({ code: 'too-large' }),
    );
  });
});

/* ----------------------------------------------------------------- favicon */

describe('favicon set definition', () => {
  it('renders every needed size once, smallest first', () => {
    const sizes = iconSizes();
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(new Set(sizes).size).toBe(sizes.length);
    for (const size of [...ICO_SIZES, ...PNG_SIZES, APPLE_TOUCH_SIZE, ...MANIFEST_SIZES]) {
      expect(sizes).toContain(size);
    }
  });

  it('writes standalone PNGs only for the sizes something links to', () => {
    const standalone = standaloneIconSizes();
    expect(standalone).toEqual([...PNG_SIZES, APPLE_TOUCH_SIZE, ...MANIFEST_SIZES].sort((a, b) => a - b));
    // 48 and 256 live inside the .ico only.
    expect(standalone).not.toContain(48);
    expect(standalone).not.toContain(256);
  });

  it('names PNGs after their edge length', () => {
    expect(pngFileName(32)).toBe('icon-32.png');
  });
});

describe('generated manifest', () => {
  it('is valid JSON with relative paths and a relative start_url', () => {
    const manifest = JSON.parse(buildWebManifest());
    expect(manifest.start_url).toBe('./');
    expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual(MANIFEST_SIZES.map(pngFileName));
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(
      MANIFEST_SIZES.map((size) => `${size}x${size}`),
    );
    expect(buildWebManifest().endsWith('}\n')).toBe(true);
  });

  it('uses the supplied name and theme colour', () => {
    const manifest = JSON.parse(buildWebManifest({ name: 'Studio', themeColor: '#123456' }));
    expect(manifest.name).toBe('Studio');
    expect(manifest.short_name).toBe('Studio');
    expect(manifest.theme_color).toBe('#123456');
    expect(manifest.background_color).toBe('#123456');
  });

  it('escapes a name that would otherwise break the file', () => {
    const manifest = JSON.parse(buildWebManifest({ name: 'A "quoted" \\ name' }));
    expect(manifest.name).toBe('A "quoted" \\ name');
  });

  it('falls back to a placeholder instead of an empty name', () => {
    const manifest = JSON.parse(buildWebManifest({ name: '   ' }));
    expect(manifest.name).toBe('My site');
  });
});

describe('generated head snippet', () => {
  it('links the PNGs, the .ico, the touch icon and the manifest', () => {
    const lines = buildHeadSnippet().split('\n');
    expect(lines).toHaveLength(PNG_SIZES.length + 4);
    expect(lines[0]).toContain('type="image/png"');
    expect(lines[0]).toContain(pngFileName(PNG_SIZES[0]));
    expect(lines.join('\n')).toContain('href="favicon.ico"');
    expect(lines.join('\n')).toContain('apple-touch-icon');
    expect(lines.join('\n')).toContain('href="site.webmanifest"');
    expect(lines.join('\n')).toContain('name="theme-color"');
  });

  it('uses relative hrefs so the set works under a subdirectory', () => {
    for (const line of buildHeadSnippet().split('\n')) {
      expect(line).not.toMatch(/href="\//);
    }
  });

  it('carries a custom theme colour through', () => {
    expect(buildHeadSnippet({ themeColor: '#abcdef' })).toContain('content="#abcdef"');
  });
});
