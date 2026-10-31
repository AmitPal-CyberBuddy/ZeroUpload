import { useState } from 'react';
import { getTool } from '../../registry/tools';
import { RunAction } from '../../components/tool/RunAction';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { ResultPanel } from '../../components/tool/ResultPanel';
import { Field, Notice } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { assertWithinSize, toToolError } from '../../lib/files/errors';
import { OFFICE_FORMATS, type OfficeFormat } from '../../lib/office/protocol';
import { useToast } from '../../hooks/useToast';
import { useRunControl } from '../../hooks/useRunControl';

const tool = getTool('encrypt-office')!;

export default function ProtectOfficeTool() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'reading' | 'deriving' | 'writing' | 'done' | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [result, setResult] = useState<{ blob: Blob; format: OfficeFormat } | null>(null);
  const { toast } = useToast();
  const runControl = useRunControl();

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setStage(null);
    setPassword('');
    setConfirm('');
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
    const signal = runControl.begin();
    setError(null);
    setResult(null);
    setStage('reading');
    try {
      const { runOfficeOperation } = await import('../../lib/office/client');
      setStage('deriving');
      const outcome = await runOfficeOperation(
        { kind: 'encrypt', source: { name: file.name, blob: file }, password },
        {
          onProgress: (ratio) => {
            if (ratio >= 0.5) setStage('writing');
          },
          signal,
        },
      );
      const meta = OFFICE_FORMATS[outcome.format];
      setResult({
        blob: new Blob([outcome.bytes as BlobPart], { type: meta.mime }),
        format: outcome.format,
      });
      setStage('done');
      toast('Document encrypted', 'success');
    } catch (err) {
      const toolError = toToolError(err);
      if (toolError.code === 'cancelled') {
        // Cancelling is a choice, not a failure: no error banner, no stale stage.
        setStage(null);
        toast('Cancelled — nothing was saved', 'default');
      } else {
        setError({ message: toolError.message, hint: toolError.hint });
        setStage(null);
      }
    } finally {
      runControl.finish();
      setBusy(false);
    }
  };

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const enabled = !busy && file && password.length >= 8 && confirm === password;

  return (
    <ToolLayout
      tool={tool}
      aside={
        file ? (
          <Settings
            title="Protection"
            footer={
              <RunAction
                label="Encrypt document"
                busyLabel="Encrypting…"
                icon="lock"
                busy={busy}
                disabled={!enabled}
                onRun={run}
                onCancel={runControl.cancel}
                cancellable={runControl.cancellable}
              />
            }
          >
            <Field
              label="Password"
              htmlFor="encrypt-office-password"
              hint={tooShort ? 'At least eight characters.' : 'Case sensitive. There is no recovery if it is lost.'}
            >
              <input
                id="encrypt-office-password"
                className="input input--mono"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                maxLength={255}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setResult(null);
                }}
              />
            </Field>
            <Field
              label="Confirm password"
              htmlFor="encrypt-office-confirm"
              hint={mismatch ? 'The two passwords do not match.' : undefined}
            >
              <input
                id="encrypt-office-confirm"
                className="input input--mono"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                maxLength={255}
                value={confirm}
                onChange={(event) => {
                  setConfirm(event.target.value);
                  setResult(null);
                }}
              />
            </Field>

            <div className="setting-row">
              <span className="field__hint">Encryption</span>
              <span className="setting-value">AES-256</span>
            </div>
            <div className="setting-row">
              <span className="field__hint">Same format as</span>
              <span className="setting-value">Office 2013 and later</span>
            </div>

            <Notice tone="warn" icon="alert" title="Experimental — keep the original">
              These files have been checked against an independent reference implementation, but not yet opened
              in Word, Excel or PowerPoint themselves. Keep the unprotected original until the result opens for
              you.
            </Notice>

            <Notice tone="danger" icon="alert" title="A lost password means a lost document">
              The password is not stored, escrowed or recoverable — here or anywhere else. That is what makes the
              encryption worth anything.
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
              title="Drop a Word, Excel or PowerPoint file"
              hint=".docx, .xlsx and .pptx only. Older .doc, .xls and .ppt files use a different password format."
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
                stages={['Reading', 'Deriving key', 'Writing container', 'Complete']}
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
              <Notice tone="danger" title="Encryption failed">
                {error.message}
                {error.hint ? <div className="hint">{error.hint}</div> : null}
              </Notice>
            ) : null}

            {result ? (
              <ResultPanel
                title="Encrypted"
                badge="Agile · AES-256"
                originalBytes={file.size}
                outputBlob={result.blob}
                filename={`${file.name.replace(/\.(docx|xlsx|pptx)$/i, '')}-protected.${OFFICE_FORMATS[result.format].extension}`}
                showPreview={false}
                onRerun={run}
                onReset={reset}
                downloadLabel="Download protected document"
                note="Open it in Word, Excel or PowerPoint and it will ask for the password. Confirm that once before you delete the original."
              />
            ) : (
              <div className="preview-placeholder">
                <Icon name="lock" size={22} />
                <p>Set a password and encrypt. The result asks for that password in Word, Excel or PowerPoint.</p>
              </div>
            )}
          </>
        )}
      </div>
    </ToolLayout>
  );
}
