import { describe, expect, it } from 'vitest';
import {
  decodeBase64,
  decodeUrlComponent,
  encodeBase64,
  encodeUrlComponent,
  formatJson,
  identifyDecoded,
  inspectUrl,
} from '../src/lib/dev/text';

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

/**
 * These are the checks behind the "what am I actually looking at" panels. Each
 * one exists because a plausible-looking input produced a misleading answer
 * before it: a decoded blob called `decoded.bin`, a link whose host was not the
 * host being visited, a config with a key the parser quietly dropped.
 */
describe('identifying decoded bytes', () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it('names the formats base64 is most often used to carry', () => {
    expect(identifyDecoded(bytes(0x89, 0x50, 0x4e, 0x47, 0, 0))?.label).toBe('PNG image');
    expect(identifyDecoded(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))?.extension).toBe('pdf');
    expect(identifyDecoded(bytes(0x50, 0x4b, 0x03, 0x04, 0))?.label).toBe('ZIP archive');
  });

  it('flags the ones that are programs rather than data', () => {
    expect(identifyDecoded(bytes(0x4d, 0x5a, 0x90, 0x00))?.executable).toBe(true);
    expect(identifyDecoded(bytes(0x7f, 0x45, 0x4c, 0x46))?.executable).toBe(true);
    expect(identifyDecoded(bytes(0xca, 0xfe, 0xba, 0xbe))?.executable).toBe(true);
  });

  it('does not flag a document as a program', () => {
    expect(identifyDecoded(bytes(0x89, 0x50, 0x4e, 0x47))?.executable).toBe(false);
    expect(identifyDecoded(bytes(0x25, 0x50, 0x44, 0x46))?.executable).toBe(false);
  });

  it('returns null rather than guessing', () => {
    expect(identifyDecoded(bytes(1, 2, 3, 4, 5))).toBeNull();
    expect(identifyDecoded(new Uint8Array(0))).toBeNull();
  });
});

describe('reading a URL', () => {
  it('splits the address into the parts a person judges', () => {
    const facts = inspectUrl('https://example.com:8443/a/b?q=local&page=2#top')!;
    expect(facts.scheme).toBe('https');
    expect(facts.host).toBe('example.com');
    expect(facts.port).toBe('8443');
    expect(facts.path).toBe('/a/b');
    expect(facts.params).toEqual([{ key: 'q', value: 'local' }, { key: 'page', value: '2' }]);
    expect(facts.fragment).toBe('top');
  });

  it('flags credentials before the host, which browsers ignore', () => {
    const facts = inspectUrl('https://login.example.com@evil.test/path')!;
    expect(facts.host).toBe('evil.test');
    expect(facts.userInfo).toBe('login.example.com');
    expect(facts.notes.some((note) => note.tone === 'danger')).toBe(true);
  });

  it('flags an encoded slash, which changes what a filter sees', () => {
    const facts = inspectUrl('https://example.com/files%2f..%2fetc/passwd')!;
    const ids = facts.notes.map((note) => note.message).join(' ');
    expect(ids).toMatch(/encoded slash/i);
    expect(ids).toMatch(/parent-directory/i);
  });

  it('flags a bare IP host and a punycode host', () => {
    expect(inspectUrl('http://192.168.1.1/admin')!.notes.map((n) => n.message).join(' ')).toMatch(/bare IP/);
    expect(inspectUrl('https://xn--80ak6aa92e.com/')!.notes.map((n) => n.message).join(' ')).toMatch(/punycode/i);
  });

  it('recognises a redirect parameter as "you do not end up here"', () => {
    const facts = inspectUrl('https://trusted.example/login?next=https://evil.test/')!;
    expect(facts.notes.map((note) => note.message).join(' ')).toMatch(/redirect/i);
  });

  it('flags a duplicated query key, which two parsers read differently', () => {
    const facts = inspectUrl('https://example.com/?role=user&role=admin')!;
    expect(facts.params).toHaveLength(2);
    expect(facts.notes.map((note) => note.message).join(' ')).toMatch(/repeats “role”/);
  });

  it('flags javascript: and data: as content rather than an address', () => {
    expect(inspectUrl('javascript:alert(1)')!.notes[0].tone).toBe('danger');
    expect(inspectUrl('data:text/html,<b>x</b>')!.notes[0].tone).toBe('danger');
  });

  it('reports an ordinary URL as ordinary', () => {
    expect(inspectUrl('https://example.com/docs?page=2')!.notes).toEqual([]);
  });

  it('treats a bare path as relative rather than inventing a host', () => {
    const facts = inspectUrl('/tools/merge-pdf/?x=1')!;
    expect(facts.relative).toBe(true);
    expect(facts.host).toBe('');
  });

  it('returns null for empty input', () => {
    expect(inspectUrl('   ')).toBeNull();
  });
});

describe('JSON notes on a document that parses', () => {
  const format = (input: string) => formatJson(input, { indent: 2, minify: false, sortKeys: false });

  it('warns about a duplicate key, which JSON.parse silently resolves', () => {
    const notes = format('{"a":1,"a":2}').notes ?? [];
    expect(notes.map((note) => note.id)).toContain('duplicate-keys');
    expect(notes[0].tone).toBe('warn');
  });

  it('warns about nesting deep enough to overflow a recursive parser', () => {
    const notes = format('['.repeat(50) + ']'.repeat(50)).notes ?? [];
    expect(notes.map((note) => note.id)).toContain('deep-nesting');
  });

  it('notices a root that is not an object', () => {
    expect((format('"just a string"').notes ?? []).map((note) => note.id)).toContain('scalar-root');
  });

  it('says nothing about a small, ordinary document', () => {
    expect(format('{"a":1,"b":[2,3]}').notes).toEqual([]);
  });
});
