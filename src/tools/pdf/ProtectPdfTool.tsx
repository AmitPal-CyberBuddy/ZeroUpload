import { useState } from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { ResultPanel } from '../../components/tool/ResultPanel';
import { Field, Notice, Toggle } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { assertWithinSize, toToolError } from '../../lib/files/errors';
import { formatCount } from '../../lib/files/format';
import { MAX_PDF_PASSWORD_LENGTH } from '../../lib/pdf/protocol';
import { useToast } from '../../hooks/useToast';

const tool = getTool('protect-pdf')!;

export default function ProtectPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [requirePassword, setRequirePassword] = useState(true);
  const [userPassword, setUserPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [allowPrinting, setAllowPrinting] = useState(true);
  const [allowCopying, setAllowCopying] = useState(true);
  const [allowModifying, setAllowModifying] = useState(false);
  const [allowAnnotating, setAllowAnnotating] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'reading' | 'encrypting' | 'done' | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [result, setResult] = useState<{ blob: Blob; pageCount: number } | null>(null);
  const { toast } = useToast();

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

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setStage(null);
    setUserPassword('');
    setOwnerPassword('');
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setStage('reading');
    try {
      const { protectPdf, pdfBytesToBlob } = await import('../../lib/pdf/pdf');
      setStage('encrypting');
      const protection = {
        userPassword: requirePassword ? userPassword : '',
        // An owner password is mandatory server-side; reusing the open password
        // is the honest default rather than inventing one behind the user's back.
        ownerPassword: ownerPassword || userPassword,
        allowPrinting,
        allowCopying,
        allowModifying,
        allowAnnotating,
      };
      const outcome = await protectPdf(file, protection, {});
      setResult({ blob: pdfBytesToBlob(outcome.bytes), pageCount: outcome.pageCount });
      setStage('done');
      toast('Document protected with AES-256', 'success');
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
      setStage(null);
    } finally {
      setBusy(false);
    }
  };

  const passwordTooShort = requirePassword && userPassword.length > 0 && userPassword.length < 4;
  const openPasswordMissing = requirePassword && userPassword.length === 0;
  const nothingChanges =
    !requirePassword &&
    (!ownerPassword || ownerPassword.length === 0) &&
    allowPrinting &&
    allowCopying &&
    allowModifying &&
    allowAnnotating;
  const disabled = busy || !file || passwordTooShort || openPasswordMissing || nothingChanges;

  return (
    <ToolLayout
      tool={tool}
      aside={
        file ? (
          <Settings
            title="Protection"
            footer={
              <>
                <button type="button" className="btn btn--primary btn--block" onClick={run} disabled={disabled}>
                  {busy ? <Spinner /> : <Icon name="lock" size={14} />}
                  {busy ? 'Encrypting…' : 'Protect PDF'}
                </button>
                <span className="field__hint" style={{ display: 'block', marginTop: 8, textAlign: 'center' }}>
                  AES-256 · computed in this tab
                </span>
              </>
            }
          >
            <Toggle
              checked={requirePassword}
              onChange={(checked) => {
                setRequirePassword(checked);
                setResult(null);
              }}
              label="Ask for a password to open"
              hint={requirePassword ? undefined : 'Anyone can open it; only the permission switches apply.'}
            />

            {requirePassword ? (
              <Field
                label="Open password"
                htmlFor="protect-open-password"
                hint={
                  passwordTooShort
                    ? 'At least four characters.'
                    : `Up to ${MAX_PDF_PASSWORD_LENGTH}. Only work with read-only copies of them.`
                }
                trailing={
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setReveal((value) => !value)}
                    aria-label={reveal ? 'Hide password' : 'Show password'}
                  >
                    <Icon name="eye" size={14} />
                  </button>
                }
              >
                <input
                  id="protect-open-password"
                  className="input input--mono"
                  type={reveal ? 'text' : 'password'}
                  autoComplete="new-password"
                  spellCheck={false}
                  maxLength={MAX_PDF_PASSWORD_LENGTH}
                  value={userPassword}
                  onChange={(event) => {
                    setUserPassword(event.target.value);
                    setResult(null);
                  }}
                />
              </Field>
            ) : null}

            <Field
              label="Owner password"
              htmlFor="protect-owner-password"
              hint="Lifts the restrictions later. Falls back to the open password."
            >
              <input
                id="protect-owner-password"
                className="input input--mono"
                type={reveal ? 'text' : 'password'}
                autoComplete="new-password"
                spellCheck={false}
                maxLength={MAX_PDF_PASSWORD_LENGTH}
                value={ownerPassword}
                onChange={(event) => {
                  setOwnerPassword(event.target.value);
                  setResult(null);
                }}
              />
            </Field>

            <div className="setting-row">
              <span className="field__hint">Cipher</span>
              <span className="setting-value">AES-256 (R6)</span>
            </div>

            <span className="field__label" style={{ marginTop: 4 }}>Permissions</span>
            <Toggle checked={allowPrinting} onChange={(v) => { setAllowPrinting(v); setResult(null); }} label="Printing" />
            <Toggle checked={allowCopying} onChange={(v) => { setAllowCopying(v); setResult(null); }} label="Copying text and images" />
            <Toggle checked={allowModifying} onChange={(v) => { setAllowModifying(v); setResult(null); }} label="Editing content" />
            <Toggle checked={allowAnnotating} onChange={(v) => { setAllowAnnotating(v); setResult(null); }} label="Comments and form filling" />

            <Notice tone="warn" icon="alert" title="The permissions are a request, not a lock">
              The document cannot be opened without the password — that part is real AES-256. The four switches
              above are recorded in the file as the author's intent, and a reader is free to ignore them. Text
              extraction for screen readers is always permitted, on purpose.
            </Notice>

            <Notice tone="default" icon="shield">
              The password stays in this tab: it is not stored, logged, or sent anywhere. There is no recovery —
              if you lose it, the document is gone.
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
              title="Drop a PDF to protect"
              hint="One document at a time. Encryption runs in a worker, off this thread."
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
                stages={['Reading', 'Encrypting', 'Complete']}
                states={
                  stage === 'reading'
                    ? ['active', 'idle', 'idle']
                    : stage === 'encrypting'
                      ? ['done', 'active', 'idle']
                      : ['done', 'done', 'done']
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
                title={`Protected · ${formatCount(result.pageCount, 'page')}`}
                badge="AES-256"
                originalBytes={file.size}
                outputBlob={result.blob}
                filename={file.name.replace(/\.pdf$/i, '') + '-protected.pdf'}
                showPreview={false}
                onRerun={run}
                onReset={reset}
                downloadLabel="Download protected PDF"
                note="Open it in any PDF reader and it will ask for the password you set. The pages are untouched — only who can read them changed."
              />
            ) : (
              <div className="preview-placeholder">
                <Icon name="lock" size={22} />
                <p>
                  {requirePassword
                    ? 'Set an open password, then protect. The document itself is not re-rendered or re-compressed.'
                    : 'No open password: the document will open for anyone, and only the permission switches will be recorded.'}
                </p>
                <button type="button" className="btn btn--primary" onClick={run} disabled={disabled}>
                  {busy ? <Spinner /> : <Icon name="lock" size={14} />}
                  {busy ? 'Encrypting…' : 'Protect now'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </ToolLayout>
  );
}
