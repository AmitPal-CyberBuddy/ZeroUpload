import { describe, expect, it } from 'vitest';
import { decodeBase64, decodeUrlComponent, encodeBase64, encodeUrlComponent } from '../src/lib/dev/text';

describe('Base64', () => {
  it('round-trips ASCII and multi-byte text', () => {
    for (const text of ['hello', 'ZeroUpload — local only', '日本語 ✓', '']) {
      expect(decodeBase64(encodeBase64(text)).text).toBe(text);
    }
  });

  it('produces URL-safe output without padding when asked', () => {
    const encoded = encodeBase64('\u00ff\u00ff\u00ff', true);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeBase64(encoded).text).toBe('\u00ff\u00ff\u00ff');
  });

  it('tolerates whitespace and missing padding on input', () => {
    expect(decodeBase64('aGVs bG8').text).toBe('hello');
    expect(decodeBase64('aGVsbG8').text).toBe('hello');
  });

  it('reports invalid characters clearly', () => {
    expect(() => decodeBase64('not base64!!')).toThrow(/not valid Base64/i);
  });

  it('reports binary payloads rather than mangling them', () => {
    expect(() => decodeBase64('/w==')).toThrow(/binary/i);
  });
});

describe('URL encoding', () => {
  it('round-trips a component', () => {
    const value = 'a b&c=d/é?';
    expect(decodeUrlComponent(encodeUrlComponent(value))).toBe(value);
  });

  it('keeps URL syntax when encoding a full URL', () => {
    expect(encodeUrlComponent('https://example.com/a b', true)).toBe('https://example.com/a%20b');
  });

  it('reports malformed percent-encoding', () => {
    expect(() => decodeUrlComponent('%ZZ')).toThrow(/malformed/i);
  });
});
