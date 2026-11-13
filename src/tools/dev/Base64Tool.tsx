import { useMemo, useState } from 'react';

import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { Notice, Segmented, Toggle, CopyButton } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { FileDrop } from '../../components/file/FileDrop';
import {
  bytesToBase64,
  decodeBase64,
  decodeBase64Bytes,
  encodeBase64,
  looksLikeText,
} from '../../lib/dev/text';
import { triggerDownload } from '../../lib/files/download';
import { formatBytes } from '../../lib/files/format';
import { assertWithinSize, toToolError } from '../../lib/files/errors';
import { toolDefinition } from '../../registry/useToolDefinition';
import { useDebouncedValue } from '../../hooks/useDeferredValue';

const tool = toolDefinition('base64');
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

  /*
   * Every transformation below reads `settled` rather than `input`.
   *
   * Base64 of a few megabytes costs roughly half a second per pass and this tool
   * has no worker, so running it inside the keystroke made a large paste lock the
   * tab on every character. The textarea still updates on the keystroke — it is
   * `input` — and the output follows once typing pauses. A file's Base64 is
   * produced by the explicit button below, which is not debounced.
   */
  const settled = useDebouncedValue(input, 150);
  const pending = settled !== input;

  /*
   * Decoding that produced binary rather than text: keep the bytes so the pane can
   * offer the file instead of an error message. This is the common case for pasted
   * constants and small images, and "not UTF-8" is not the same as "not valid".
   */
  const binary = useMemo(() => {
    if (mode !== 'decode' || !settled.trim()) return null;
    try {
      const bytes = decodeBase64Bytes(settled);
      return looksLikeText(bytes) ? null : bytes;
    } catch {
      return null;
    }
  }, [settled, mode]);

  const result = useMemo(() => {
    if (!settled) return { output: '', error: null as string | null };
    try {
      if (mode === 'encode') return { output: encodeBase64(settled, urlSafe), error: null };
      const decoded = decodeBase64(settled);
      return { output: decoded.text, error: null };
    } catch (err) {
      return { output: '', error: (err as Error).message };
    }
  }, [settled, mode, urlSafe]);

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
              Decoding expects UTF-8 text. If the decoded bytes are not text, you can download them
              as a binary file instead of seeing garbled characters.
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
        {fileBusy ? <p className="hint" role="status">Encoding your file locally…</p> : null}
        {file && fileOutput ? <p className="hint" role="status">{file.name} is ready. <a className="link-inline" href="#file-base64-output">View encoded file</a></p> : null}
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
              <span>
                {mode === 'encode' ? 'Base64' : 'Plain text'}
                {pending ? <span className="hint"> · updating…</span> : null}
              </span>
              {result.output ? <CopyButton value={result.output} label="Copy" /> : null}
              {binary ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    triggerDownload(new Blob([binary.slice()], { type: 'application/octet-stream' }), 'decoded.bin')
                  }
                >
                  <Icon name="download" size={13} /> Download {binary.length} bytes
                </button>
              ) : null}
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
              {/*
                * "Binary" is a third outcome, not a failure: the input decoded
                * cleanly, it just is not text. Saying so, and offering the file,
                * is more useful than an error about UTF-8.
                */}
              {binary ? (
                <span>
                  Decoded cleanly — {binary.length.toLocaleString()} bytes that are not UTF-8 text. Download them
                  or copy the Base64.
                </span>
              ) : result.error ? (
                <span className="error-line">{result.error}</span>
              ) : (
                <span>UTF-8 safe round trip</span>
              )}
            </div>
          </div>
        </div>

        <div className="settings" id="file-base64-output">
          <div className="settings__head">
            <Icon name="file" size={13} /> Encode a file
          </div>
          <div className="settings__body">
            <FileDrop
              handoffTarget="base64"
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
                  <textarea className="textarea" aria-label="Base64 file output, first 2,000 characters" value={fileOutput.slice(0, 2000)} readOnly spellCheck={false} style={{ height: 140 }} />
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </ToolLayout>
  );
}
