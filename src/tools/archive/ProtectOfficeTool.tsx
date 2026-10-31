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
      setError({ message: toolError.message, hint: toolError.hint });
      setStage(null);
    } finally {
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
              <button type="button" className="btn btn--primary btn--block" onClick={run} disabled={!enabled}>
                {busy ? <Spinner /> : <Icon name="lock" size={14} />}
                {busy ? 'Encrypting…' : 'Encrypt document'}
              </button>
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
              <span className="field__hint">Scheme</span>
              <span className="setting-value">Agile · AES-256 · SHA-512</span>
            </div>
            <div className="setting-row">
              <span className="field__hint">Key derivation</span>
              <span className="setting-value">100 000 rounds</span>
            </div>

            <Notice tone="warn" icon="alert" title="Experimental — keep the original">
              The container, key derivation and integrity values verify against an independent implementation, but
              this build has not yet been round-tripped through real Word, Excel and PowerPoint installations.
              Keep the unencrypted original until you have opened the result once.
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
              hint="Modern .docx/.xlsx/.pptx only — legacy .doc/.xls/.ppt use a different scheme."
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
                <p>Set a password and encrypt. The document is wrapped in an OLE container, exactly as Office does it.</p>
                <button type="button" className="btn btn--primary" onClick={run} disabled={!enabled}>
                  {busy ? <Spinner /> : <Icon name="lock" size={14} />}
                  {busy ? 'Encrypting…' : 'Encrypt document'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </ToolLayout>
  );
}
