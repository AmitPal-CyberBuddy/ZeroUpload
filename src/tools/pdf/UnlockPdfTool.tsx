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
import { formatCount } from '../../lib/files/format';
import { MAX_PDF_PASSWORD_LENGTH } from '../../lib/pdf/protocol';
import { useToast } from '../../hooks/useToast';
import { useRunControl } from '../../hooks/useRunControl';

const tool = getTool('unlock-pdf')!;

export default function UnlockPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'reading' | 'decrypting' | 'done' | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [result, setResult] = useState<{ blob: Blob; pageCount: number; wasEncrypted: boolean } | null>(null);
  const { toast } = useToast();
  const runControl = useRunControl();

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
      assertWithinSize(next, 'pdf');
      if (!(next.type === 'application/pdf' || /\.pdf$/i.test(next.name))) {
        throw new Error(`${next.name} is not a PDF.`);
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
      const { unlockPdf, pdfBytesToBlob } = await import('../../lib/pdf/pdf');
      setStage('decrypting');
      const outcome = await unlockPdf(file, password, { signal });
      setResult({
        blob: pdfBytesToBlob(outcome.bytes),
        pageCount: outcome.pageCount,
        wasEncrypted: outcome.wasEncrypted,
      });
      setStage('done');
      toast(outcome.wasEncrypted ? 'Password removed' : 'This document was not encrypted', 'success');
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

  return (
    <ToolLayout
      tool={tool}
      aside={
        file ? (
          <Settings
            title="Password"
            footer={
              <RunAction
                label="Remove password"
                busyLabel="Decrypting…"
                icon="shield"
                busy={busy}
                onRun={run}
                onCancel={runControl.cancel}
                cancellable={runControl.cancellable}
              />
            }
          >
            <Field
              label="Current password"
              htmlFor="unlock-pdf-password"
              hint="Leave empty for a file that only carries permissions, with no open password."
            >
              <input
                id="unlock-pdf-password"
                className="input input--mono"
                type="password"
                autoComplete="current-password"
                spellCheck={false}
                maxLength={MAX_PDF_PASSWORD_LENGTH}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setResult(null);
                }}
              />
            </Field>

            <Notice tone="default" icon="info">
              Handles AES-256, AES-128 and the older RC4 encryption, plus files that carry restrictions but
              no open password.
            </Notice>

            <Notice tone="default" icon="alert" title="This is not a cracking tool">
              It only removes protection from a document whose password you already know. There is no guessing,
              no dictionary and no bypass.
            </Notice>

            <Notice tone="default" icon="shield">
              The password is used once and then discarded. The unlocked document is created on your device
              and never leaves the browser.
            </Notice>
          </Settings>
        ) : null
      }
    >
      <div className="tool-body">
        {!file ? (
          <>
            <FileDrop
              accept="application/pdf,.pdf"
              onFiles={(files) => load(files[0])}
              title="Drop a protected PDF"
              hint="One document at a time. Your file is decrypted on your device."
              icon="shield"
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
                stages={['Reading', 'Decrypting', 'Complete']}
                states={
                  stage === 'reading'
                    ? ['active', 'idle', 'idle']
                    : stage === 'decrypting'
                      ? ['done', 'active', 'idle']
                      : ['done', 'done', 'done']
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
                title={`Unprotected · ${formatCount(result.pageCount, 'page')}`}
                badge={result.wasEncrypted ? 'Password removed' : 'No password found'}
                originalBytes={file.size}
                outputBlob={result.blob}
                filename={file.name.replace(/\.pdf$/i, '') + '-unlocked.pdf'}
                showPreview={false}
                onRerun={run}
                onReset={reset}
                downloadLabel="Download unprotected PDF"
                note={
                  result.wasEncrypted
                    ? 'The encryption dictionary and key material are gone from the output, not merely bypassed — the file opens anywhere without a prompt.'
                    : 'This document had no password, so the output is a plain copy with the same pages.'
                }
              />
            ) : (
              <div className="preview-placeholder">
                <Icon name="shield" size={22} />
                <p>Enter the password you already open this file with, then decrypt.</p>
              </div>
            )}
          </>
        )}
      </div>
    </ToolLayout>
  );
}
