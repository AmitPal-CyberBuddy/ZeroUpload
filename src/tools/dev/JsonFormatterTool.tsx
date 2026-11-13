import { useEffect, useMemo, useRef, useState } from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { Field, Notice, Segmented, Toggle, CopyButton } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { offsetForLineColumn, formatJson } from '../../lib/dev/text';
import { formatBytes } from '../../lib/files/format';
import { triggerDownload } from '../../lib/files/download';
import { useToast } from '../../hooks/useToast';
import { takeHandoff } from '../../lib/files/handoff';

const tool = getTool('json-formatter')!;

const SAMPLE = `{"project":"ZeroUpload","local":true,"tools":["convert","compress"],"limits":{"maxSize":"120MB","uploaded":0}}`;

export default function JsonFormatterTool() {
  const [input, setInput] = useState(SAMPLE);
  const [indent, setIndent] = useState<'2' | '4' | 'tab'>('2');
  const [minify, setMinify] = useState(false);
  const [sortKeys, setSortKeys] = useState(false);
  const { toast } = useToast();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    const file = takeHandoff('json-formatter')[0];
    if (file) { setInput(''); setLoadingFile(true); setSourceFile(file); }
  }, []);

  useEffect(() => {
    if (!sourceFile) return;
    let active = true;
    if (sourceFile.size > 512 * 1024) {
      setFileError('This JSON file is too large for the editor. Choose a file under 512 KB.');
      setLoadingFile(false);
      return;
    }
    sourceFile.text().then((text) => {
      if (active) setInput(text);
    }).catch(() => {
      if (active) setFileError('Could not read this file. Try opening it again.');
    }).finally(() => {
      if (active) setLoadingFile(false);
    });
    return () => { active = false; };
  }, [sourceFile]);

  /**
   * Put the caret on the character the parser objected to.
   *
   * A syntax error is a *place*, and a line/column pair in a footer makes the
   * reader do the finding. This scrolls the textarea to the spot and selects the
   * offending character so it is visible where the eye already is.
   */
  const jumpToError = () => {
    const error = result.error;
    const editor = editorRef.current;
    if (!error || !editor || !error.line) return;
    const offset = offsetForLineColumn(input, error.line, error.column ?? 1);
    editor.focus();
    editor.setSelectionRange(offset, Math.min(input.length, offset + 1));
    // The textarea scrolls itself to the selection once it is focused.
  };

  const result = useMemo(
    () =>
      formatJson(input, {
        indent: indent === 'tab' ? 'tab' : Number(indent),
        minify,
        sortKeys,
      }),
    [indent, input, minify, sortKeys],
  );

  const valid = !result.error && input.trim().length > 0;

  return (
    <ToolLayout
      tool={tool}
      aside={
        <Settings
          title="Format options"
          footer={
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={!valid}
              onClick={() => {
                triggerDownload(new Blob([result.output], { type: 'application/json' }), 'formatted.json');
                toast('Saved formatted JSON', 'success');
              }}
            >
              <Icon name="download" size={14} /> Download .json
            </button>
          }
        >
          <Field label="Indentation">
            <Segmented
              label="Indentation"
              value={indent}
              onChange={setIndent}
              options={[
                { value: '2', label: '2 spaces' },
                { value: '4', label: '4 spaces' },
                { value: 'tab', label: 'Tab' },
              ]}
            />
          </Field>

          <Toggle checked={minify} onChange={setMinify} label="Minify output" hint="Removes all whitespace between tokens." />
          <Toggle checked={sortKeys} onChange={setSortKeys} label="Sort keys" hint="Recursively alphabetical — handy for diffs." />

          <hr className="hairline" />

          <div className="setting-row">
            <span className="field__hint">Status</span>
            <span className="setting-value" style={result.error ? { color: 'var(--danger)' } : undefined}>
              {input.trim() ? (result.error ? 'Invalid' : 'Valid JSON') : 'Empty'}
            </span>
          </div>
          <div className="setting-row">
            <span className="field__hint">Input</span>
            <span className="setting-value">{formatBytes(new Blob([input]).size)}</span>
          </div>
          <div className="setting-row">
            <span className="field__hint">Output</span>
            <span className="setting-value">{formatBytes(new Blob([result.output]).size)}</span>
          </div>

          <Notice tone="default" icon="lock">
            Your JSON never leaves this browser. Treat it with the same care as a local text editor — nothing
            here sends it anywhere.
          </Notice>
        </Settings>
      }
    >
      <div className="tool-body">
        {sourceFile && !fileError ? <p className="hint" role="status">{loadingFile ? 'Reading' : 'Loaded'} {sourceFile.name} locally.</p> : null}
        {fileError ? <Notice tone="danger">{fileError}</Notice> : null}
        <div className="editor-grid">
          <div className="editor-pane">
            <div className="editor-pane__head">
              <span>Input</span>
              <span>{input.length.toLocaleString()} chars</span>
            </div>
            <textarea
              ref={editorRef}
              disabled={loadingFile}
              className="textarea"
              value={input}
              spellCheck={false}
              aria-label="JSON input"
              placeholder="Paste JSON here…"
              onChange={(event) => setInput(event.target.value)}
            />
            <div className="editor-pane__foot">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setInput('')}>
                Clear
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setInput(SAMPLE)}>
                Load sample
              </button>
            </div>
          </div>

          <div className="editor-pane">
            <div className="editor-pane__head">
              <span>Output</span>
              {result.output ? <CopyButton value={result.output} label="Copy output" /> : null}
            </div>
            <textarea
              className="textarea"
              value={result.output}
              readOnly
              spellCheck={false}
              aria-label="Formatted JSON output"
              placeholder="Formatted output appears here"
              style={result.error ? { color: 'var(--danger)' } : undefined}
            />
            <div className="editor-pane__foot">
              {result.error ? (
                <span className="error-line">
                  {result.error.line ? (
                    <button type="button" className="link-button" onClick={jumpToError}>
                      Line {result.error.line}, column {result.error.column}
                    </button>
                  ) : null}
                  {result.error.line ? ' — ' : ''}
                  {result.error.message}
                </span>
              ) : valid ? (
                <>
                  <span>{result.stats.keys.toLocaleString()} keys</span>
                  <span>·</span>
                  <span>{result.stats.nodes.toLocaleString()} nodes</span>
                  <span>·</span>
                  <span>depth {result.stats.depth}</span>
                </>
              ) : (
                <span>Waiting for input…</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </ToolLayout>
  );
}
