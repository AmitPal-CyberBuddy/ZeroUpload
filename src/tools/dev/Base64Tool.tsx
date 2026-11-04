import { useMemo, useState } from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { Notice, Segmented, Toggle, CopyButton } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { FileDrop } from '../../components/file/FileDrop';
import { encodeBase64, decodeBase64, bytesToBase64 } from '../../lib/dev/text';
import { formatBytes } from '../../lib/files/format';
import { assertWithinSize, toToolError } from '../../lib/files/errors';

const tool = getTool('base64')!;
const MAX_TEXT_FILE = 10 * 1024 * 1024;

type Mode = 'encode' | 'decode';

export default function Base64Tool() {
  const [mode, setMode] = useState<Mode>('encode');
  const [input, setInput] = useState('ZeroUpload keeps files on your device.');
  const [urlSafe, setUrlSafe] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileOutput, setFileOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const result = useMemo(() => {
    if (!input) return { output: '', error: null as string | null };
    try {
      if (mode === 'encode') return { output: encodeBase64(input, urlSafe), error: null };
      const decoded = decodeBase64(input);
      return { output: decoded.text, error: null };
    } catch (err) {
      return { output: '', error: (err as Error).message };
    }
  }, [input, mode, urlSafe]);

  const handleFile = async (next: File) => {
    setError(null);
    setFileOutput(null);
    setFileBusy(true);
    try {
      assertWithinSize(next, 'text');
      if (next.size > MAX_TEXT_FILE) {
        throw Object.assign(new Error('Files above 10 MB are too large for a text output pane.'), {});
      }
      const bytes = new Uint8Array(await next.arrayBuffer());
      setFile(next);
      setFileOutput(bytesToBase64(bytes));
    } catch (err) {
      const toolError = toToolError(err);
      setError(toolError.message);
      setFile(null);
    } finally {
      setFileBusy(false);
    }
  };

  return (
    <ToolLayout
      tool={tool}
      aside={
        <Settings title="Encoding">
          <Segmented
            label="Mode"
            value={mode}
            onChange={(value) => { setMode(value); setError(null); }}
            options={[
              { value: 'encode', label: 'Text → Base64' },
              { value: 'decode', label: 'Base64 → Text' },
            ]}
          />
          {mode === 'encode' ? (
            <Toggle checked={urlSafe} onChange={setUrlSafe} label="URL-safe alphabet" hint="Uses - and _ instead of + and /, and drops padding." />
          ) : (
            <Notice tone="default" icon="info">
              Decoding expects UTF-8 text. Binary data is reported as an error rather than turned into
              garbled characters.
            </Notice>
          )}
          <div className="setting-row">
            <span className="field__hint">Input bytes</span>
            <span className="setting-value">{formatBytes(new Blob([input]).size)}</span>
          </div>
          <div className="setting-row">
            <span className="field__hint">Output length</span>
            <span className="setting-value">{result.output.length.toLocaleString()}</span>
          </div>
        </Settings>
      }
    >
      <div className="tool-body">
        <div className="editor-grid">
          <div className="editor-pane">
            <div className="editor-pane__head">
              <span>{mode === 'encode' ? 'Plain text' : 'Base64'}</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setInput('')}>
                Clear
              </button>
            </div>
            <textarea
              className="textarea"
              value={input}
              spellCheck={false}
              aria-label="Input"
              onChange={(event) => setInput(event.target.value)}
              placeholder={mode === 'encode' ? 'Type or paste text…' : 'Paste Base64…'}
            />
          </div>

          <div className="editor-pane">
            <div className="editor-pane__head">
              <span>{mode === 'encode' ? 'Base64' : 'Plain text'}</span>
              {result.output ? <CopyButton value={result.output} label="Copy" /> : null}
            </div>
            <textarea
              className="textarea"
              value={result.error ?? result.output}
              readOnly
              spellCheck={false}
              aria-label="Output"
              style={result.error ? { color: 'var(--danger)' } : undefined}
              placeholder="Output"
            />
            <div className="editor-pane__foot">
              {result.error ? <span className="error-line">{result.error}</span> : <span>UTF-8 safe round trip</span>}
            </div>
          </div>
        </div>

        <div className="settings">
          <div className="settings__head">
            <Icon name="file" size={13} /> Encode a file
          </div>
          <div className="settings__body">
            <FileDrop
              accept={undefined}
              onFiles={(files) => handleFile(files[0])}
              title={fileBusy ? 'Reading file…' : 'Drop a file to Base64-encode it'}
              hint="Useful for small assets and API payloads. Files above 10 MB are refused to keep the page responsive."
              icon="code"
              compact
              disabled={fileBusy}
            />
            {error ? <Notice tone="danger">{error}</Notice> : null}
            {file && fileOutput ? (
              <>
                <div className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {file.name} · {formatBytes(file.size)} → {formatBytes(new Blob([fileOutput]).size)}
                </div>
                <div className="editor-pane">
                  <div className="editor-pane__head">
                    <span>Base64 (first 2,000 chars)</span>
                    <CopyButton value={fileOutput} label="Copy full output" />
                  </div>
                  <textarea className="textarea" value={fileOutput.slice(0, 2000)} readOnly spellCheck={false} style={{ height: 140 }} />
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </ToolLayout>
  );
}
