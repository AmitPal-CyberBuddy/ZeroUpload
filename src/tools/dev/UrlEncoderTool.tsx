import { useMemo, useState } from 'react';

import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { Notice, Segmented, Toggle, CopyButton } from '../../components/ui/controls';
import { decodeUrlComponent, encodeUrlComponent } from '../../lib/dev/text';
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
      </div>
    </ToolLayout>
  );
}
