import { useMemo, useState } from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { Field, Notice, Segmented, Toggle, CopyButton } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { formatJson } from '../../lib/dev/text';
import { formatBytes } from '../../lib/files/format';
import { triggerDownload } from '../../lib/files/download';
import { useToast } from '../../hooks/useToast';

const tool = getTool('json-formatter')!;

const SAMPLE = `{"project":"ZeroUpload","local":true,"tools":["convert","compress"],"limits":{"maxSize":"120MB","uploaded":0}}`;

export default function JsonFormatterTool() {
  const [input, setInput] = useState(SAMPLE);
  const [indent, setIndent] = useState<'2' | '4' | 'tab'>('2');
  const [minify, setMinify] = useState(false);
  const [sortKeys, setSortKeys] = useState(false);
  const { toast } = useToast();

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
            Parsing happens in this tab. Never paste secrets you would not put in a local text editor.
          </Notice>
        </Settings>
      }
    >
      <div className="tool-body">
        <div className="editor-grid">
          <div className="editor-pane">
            <div className="editor-pane__head">
              <span>Input</span>
              <span>{input.length.toLocaleString()} chars</span>
            </div>
            <textarea
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
                  {result.error.line ? `Line ${result.error.line}, column ${result.error.column} — ` : ''}
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
