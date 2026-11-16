import { useMemo, useState } from 'react';

import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { Notice, Segmented, Toggle, CopyButton } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { decodeUrlComponent, encodeUrlComponent, inspectUrl } from '../../lib/dev/text';
import { formatBytes } from '../../lib/files/format';
import { toolDefinition } from '../../registry/useToolDefinition';

const tool = toolDefinition('url-encoder');

type Mode = 'encode' | 'decode';

export default function UrlEncoderTool() {
  const [mode, setMode] = useState<Mode>('encode');
  const [input, setInput] = useState('https://example.com/search?q=local first file tools&page=2');
  const [fullUri, setFullUri] = useState(false);

  const result = useMemo(() => {
    if (!input) return { output: '', error: null as string | null };
    try {
      if (mode === 'encode') return { output: encodeUrlComponent(input, fullUri), error: null };
      return { output: decodeUrlComponent(input), error: null };
    } catch (err) {
      return { output: '', error: (err as Error).message };
    }
  }, [fullUri, input, mode]);

  /*
   * What the address actually is. Only meaningful in decode mode or when the
   * input looks like a URL; a bare word being encoded has nothing to inspect.
   */
  const facts = useMemo(
    () => (mode === 'decode' || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(input.trim()) ? inspectUrl(mode === 'decode' ? result.output || input : input) : null),
    [input, mode, result.output],
  );

  return (
    <ToolLayout
      tool={tool}
      aside={
        <Settings title="Encoding">
          <Segmented
            label="Mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'encode', label: 'Encode' },
              { value: 'decode', label: 'Decode' },
            ]}
          />
          {mode === 'encode' ? (
            <Toggle
              checked={fullUri}
              onChange={setFullUri}
              label="Treat as a full URI"
              hint="Keeps : / ? & = # unescaped, so URLs stay readable."
            />
          ) : null}

          <div className="setting-row">
            <span className="field__hint">Input</span>
            <span className="setting-value">{formatBytes(new Blob([input]).size)}</span>
          </div>

          <Notice tone="default" icon="info">
            {mode === 'encode'
              ? fullUri
                ? 'Reserved characters such as : / ? and & are left intact, so a full URL stays readable.'
                : 'Everything except unreserved characters is escaped — the right choice for a single value.'
              : 'A “+” is read as a space, as in form encoding. Malformed % sequences are reported.'}
          </Notice>
        </Settings>
      }
    >
      <div className="tool-body">
        <div className="editor-grid">
          <div className="editor-pane">
            <div className="editor-pane__head">
              <span>Input</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setInput('')}>
                Clear
              </button>
            </div>
            <textarea
              className="textarea"
              style={{ height: 220 }}
              value={input}
              spellCheck={false}
              aria-label="Input"
              onChange={(event) => setInput(event.target.value)}
            />
          </div>
          <div className="editor-pane">
            <div className="editor-pane__head">
              <span>Output</span>
              {result.output ? <CopyButton value={result.output} label="Copy" /> : null}
            </div>
            <textarea
              className="textarea"
              style={{ height: 220, ...(result.error ? { color: 'var(--danger)' } : {}) }}
              value={result.error ?? result.output}
              readOnly
              spellCheck={false}
              aria-label="Output"
            />
            <div className="editor-pane__foot">
              {result.error ? <span className="error-line">{result.error}</span> : <span>{result.output.length} chars</span>}
            </div>
          </div>
        </div>

        {/*
          * The decoded address, broken into the parts a person judges: scheme,
          * host, path, parameters. Reading a URL is the actual task here — the
          * encoding is only how the URL arrived.
          */}
        {facts ? (
          <div className="settings">
            <div className="settings__head">
              <Icon name="link" size={13} /> What this address is
            </div>
            <div className="settings__body">
              {facts.relative ? (
                <p className="hint">
                  This is a relative reference, not an address with a host — it resolves against whatever page
                  it appears on.
                </p>
              ) : (
                <div className="kv">
                  {[
                    { key: 'Scheme', value: facts.scheme || 'none' },
                    { key: 'Host', value: facts.host || '—' },
                    { key: 'Port', value: facts.port || 'default' },
                    { key: 'Path', value: facts.path || '/' },
                    ...(facts.userInfo ? [{ key: 'Credentials', value: facts.userInfo }] : []),
                    ...(facts.fragment ? [{ key: 'Fragment', value: facts.fragment }] : []),
                  ].map((row) => (
                    <div className="kv__row" key={row.key}>
                      <span className="kv__key">{row.key}</span>
                      <span className="kv__value">{row.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {facts.params.length > 0 ? (
                <div className="url-params">
                  <span className="finding__label">Parameters ({facts.params.length})</span>
                  <ul>
                    {facts.params.slice(0, 12).map((param, index) => (
                      <li key={`${param.key}-${index}`}>
                        <code>{param.key}</code>
                        <span>{param.value || '(empty)'}</span>
                      </li>
                    ))}
                    {facts.params.length > 12 ? <li>…and {facts.params.length - 12} more</li> : null}
                  </ul>
                </div>
              ) : null}

              {facts.notes.length > 0 ? (
                <div className="stack" style={{ gap: 'var(--s-2)' }}>
                  {facts.notes.map((note, index) => (
                    <Notice key={index} tone={note.tone === 'default' ? 'default' : note.tone === 'danger' ? 'danger' : 'warn'}>
                      {note.message}
                    </Notice>
                  ))}
                </div>
              ) : (
                <p className="hint">
                  Nothing unusual in this address: a named host, no embedded credentials, no encoded separators
                  and no redirect parameter. It is still never opened — nothing here fetches a URL.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </ToolLayout>
  );
}
