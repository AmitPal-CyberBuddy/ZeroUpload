import { useState } from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { ResultPanel } from '../../components/tool/ResultPanel';
import { Field, Notice } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { assertWithinSize, toToolError } from '../../lib/files/errors';
import { OFFICE_FORMATS, type OfficeFormat } from '../../lib/office/protocol';
import { useToast } from '../../hooks/useToast';

const tool = getTool('unlock-office')!;

export default function UnlockOfficeTool() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'reading' | 'deriving' | 'writing' | 'done' | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [result, setResult] = useState<{ blob: Blob; format: OfficeFormat } | null>(null);
  const { toast } = useToast();

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setStage(null);
    setPassword('');
  };

  const load = (next: File | undefined) => {
    if (!next) return;
    setError(null);
    setResult(null);
    try {
      assertWithinSize(next, 'office');
      if (!/\.(docx|xlsx|pptx)$/i.test(next.name)) {
        throw new Error(`${next.name} is not a .docx, .xlsx or .pptx file.`);
      }
      setFile(next);
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
      setFile(null);
    }
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setStage('reading');
    try {
      const { runOfficeOperation } = await import('../../lib/office/client');
      setStage('deriving');
      const outcome = await runOfficeOperation(
        { kind: 'decrypt', source: { name: file.name, blob: file }, password },
        {
          onProgress: (ratio) => {
            if (ratio >= 0.6) setStage('writing');
          },
        },
      );
      const meta = OFFICE_FORMATS[outcome.format];
      setResult({
        blob: new Blob([outcome.bytes as BlobPart], { type: meta.mime }),
        format: outcome.format,
      });
      setStage('done');
      toast('Password removed — the document is a plain Office file again', 'success');
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
      setStage(null);
    } finally {
      setBusy(false);
    }
  };

  const extension = result ? OFFICE_FORMATS[result.format].extension : 'docx';

  return (
    <ToolLayout
      tool={tool}
      aside={
        file ? (
          <Settings
            title="Password"
            footer={
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={run}
                disabled={busy || password.length === 0}
              >
                {busy ? <Spinner /> : <Icon name="lock" size={14} />}
                {busy ? 'Decrypting…' : 'Remove password'}
              </button>
            }
          >
            <Field
              label="Document password"
              htmlFor="unlock-office-password"
              hint="Agile (Office 2010+) and Standard (Office 2007) encryption are both supported."
            >
              <input
                id="unlock-office-password"
                className="input input--mono"
                type="password"
                autoComplete="current-password"
                spellCheck={false}
                maxLength={255}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setResult(null);
                }}
              />
            </Field>

            <Notice tone="default" icon="clock" title="Expect about half a second">
              Office derives the key with 100 000 rounds of SHA-512 by design. That work happens in a worker, so
              the page stays responsive, but it is not instant.
            </Notice>

            <Notice tone="warn" icon="alert" title="Password you know, not a password to guess">
              This removes protection from a document you can already open with the password you have. There is no
              brute force, no dictionary and no recovery for documents you cannot open.
            </Notice>

            <Notice tone="default" icon="info" title="What comes out">
              The output is the original .docx/.xlsx/.pptx package with no password: any Office-compatible
              application can open it, and so can a ZIP tool.
            </Notice>
          </Settings>
        ) : null
      }
    >
      <div className="tool-body">
        {!file ? (
          <>
            <FileDrop
              accept=".docx,.xlsx,.pptx"
              onFiles={(files) => load(files[0])}
              title="Drop a protected Office file"
              hint="Word, Excel and PowerPoint documents from Office 2007 onwards."
              icon="lock"
              onError={(message) => setError({ message })}
            />
            {error ? (
              <Notice tone="danger" title="Could not open this file">
                {error.message}
                {error.hint ? <div className="hint">{error.hint}</div> : null}
              </Notice>
            ) : null}
          </>
        ) : (
          <>
            <div className="row row--between row--wrap">
              <span className="section-title">Document</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={reset} disabled={busy}>
                <Icon name="x" size={13} /> Clear
              </button>
            </div>

            <FileCard file={file} onRemove={busy ? undefined : reset} />

            {stage ? (
              <StageTimeline
                stages={['Reading', 'Deriving key', 'Writing package', 'Complete']}
                states={
                  stage === 'reading'
                    ? ['active', 'idle', 'idle', 'idle']
                    : stage === 'deriving'
                      ? ['done', 'active', 'idle', 'idle']
                      : stage === 'writing'
                        ? ['done', 'done', 'active', 'idle']
                        : ['done', 'done', 'done', 'done']
                }
              />
            ) : null}

            {error ? (
              <Notice tone="danger" title="Could not decrypt this document">
                {error.message}
                {error.hint ? <div className="hint">{error.hint}</div> : null}
              </Notice>
            ) : null}

            {result ? (
              <ResultPanel
                title="Unprotected"
                badge={OFFICE_FORMATS[result.format].label}
                originalBytes={file.size}
                outputBlob={result.blob}
                filename={`${file.name.replace(/\.(docx|xlsx|pptx)$/i, '')}-unlocked.${extension}`}
                showPreview={false}
                onRerun={run}
                onReset={reset}
                downloadLabel={`Download .${extension}`}
                note="The password, the salts and the encrypted package are all gone from the output — this file opens without a prompt."
              />
            ) : (
              <div className="preview-placeholder">
                <Icon name="lock" size={22} />
                <p>Enter the password, then decrypt. The decrypted package is validated before you can download it.</p>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={run}
                  disabled={busy || password.length === 0}
                >
                  {busy ? <Spinner /> : <Icon name="lock" size={14} />}
                  {busy ? 'Decrypting…' : 'Remove password'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </ToolLayout>
  );
}
