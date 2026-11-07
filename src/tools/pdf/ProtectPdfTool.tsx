import { useState } from 'react';
import { getTool } from '../../registry/tools';
import { RunAction } from '../../components/tool/RunAction';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { ResultPanel } from '../../components/tool/ResultPanel';
import { Field, Notice, RadioGroup, Toggle } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { assertWithinSize, toToolError } from '../../lib/files/errors';
import { formatCount } from '../../lib/files/format';
import { Outcome } from '../../components/tool/Outcome';
import { MAX_PDF_PASSWORD_LENGTH } from '../../lib/pdf/protocol';
import { useToast } from '../../hooks/useToast';
import { useRunControl } from '../../hooks/useRunControl';

const tool = getTool('protect-pdf')!;

/**
 * How the document should be reached.
 *
 * `require` sets the open password (the PDF "user" password); `anyone` leaves it
 * empty, which means the file decrypts without a prompt and only the permission
 * flags apply. Both modes use the same AES-256 path — the difference is one
 * empty string, not a different scheme.
 */
type AccessMode = 'require' | 'anyone';

const MIN_PASSWORD = 4;

export default function ProtectPdfTool() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<AccessMode>('require');
  const [openPassword, setOpenPassword] = useState('');
  const [permissionsPassword, setPermissionsPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [restrictEditing, setRestrictEditing] = useState(true);
  const [restrictPrinting, setRestrictPrinting] = useState(false);
  const [restrictCopying, setRestrictCopying] = useState(false);
  const [restrictAnnotating, setRestrictAnnotating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'reading' | 'encrypting' | 'done' | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [result, setResult] = useState<{ blob: Blob; pageCount: number } | null>(null);
  const { toast } = useToast();
  const runControl = useRunControl();

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
    setOpenPassword('');
    setPermissionsPassword('');
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    const signal = runControl.begin();
    setError(null);
    setResult(null);
    setStage('reading');
    try {
      const { protectPdf, pdfBytesToBlob } = await import('../../lib/pdf/pdf');
      setStage('encrypting');
      const outcome = await protectPdf(
        file,
        {
          // The open password is the PDF "user" password; empty means the file
          // opens without a prompt.
          userPassword: mode === 'require' ? openPassword : '',
          // The permissions password is the PDF "owner" password. Reusing the
          // open password when the field is left blank is an honest default:
          // inventing one would leave the restrictions impossible to lift.
          ownerPassword: permissionsPassword || (mode === 'require' ? openPassword : ''),
          allowPrinting: !restrictPrinting,
          allowCopying: !restrictCopying,
          allowModifying: !restrictEditing,
          allowAnnotating: !restrictAnnotating,
        },
        { signal },
      );
      setResult({ blob: pdfBytesToBlob(outcome.bytes), pageCount: outcome.pageCount });
      setStage('done');
      toast('Document protected with AES-256', 'success');
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

  const needsOpenPassword = mode === 'require';
  const effectivePermissionsPassword = permissionsPassword || (needsOpenPassword ? openPassword : '');
  const anyRestriction = restrictEditing || restrictPrinting || restrictCopying || restrictAnnotating;

  const openPasswordTooShort =
    needsOpenPassword && openPassword.length > 0 && openPassword.length < MIN_PASSWORD;
  const openPasswordMissing = needsOpenPassword && openPassword.length === 0;
  const permissionsPasswordMissing = effectivePermissionsPassword.length === 0;
  const permissionsPasswordTooShort =
    effectivePermissionsPassword.length > 0 && effectivePermissionsPassword.length < MIN_PASSWORD;
  /** Without an open password and without restrictions, the file would be unchanged. */
  const nothingChanges = !needsOpenPassword && !anyRestriction;

  const disabled =
    busy ||
    !file ||
    openPasswordMissing ||
    openPasswordTooShort ||
    permissionsPasswordMissing ||
    permissionsPasswordTooShort ||
    nothingChanges;

  const resultNote =
    mode === 'require'
      ? 'Anyone who opens it needs the open password first. The restricted actions stay off in readers that enforce PDF permissions.'
      : 'It opens without a password. The restricted actions stay off in readers that enforce PDF permissions.';

  const idleNote =
    mode === 'require'
      ? 'Set an open password, then protect. The document itself is not re-rendered or re-compressed.'
      : 'No open password: the document opens for anyone, and only the restrictions you turned on are recorded.';

  return (
    <ToolLayout
      tool={tool}
      aside={
        file ? (
          <Settings
            title="Protection"
            footer={
              <RunAction
                label="Protect PDF"
                busyLabel="Encrypting…"
                icon="lock"
                busy={busy}
                disabled={disabled}
                onRun={run}
                onCancel={runControl.cancel}
                cancellable={runControl.cancellable}
                hint="AES-256 · encrypted on your device"
              />
            }
          >
            <RadioGroup
              name="protect-access"
              legend="How should people access this PDF?"
              value={mode}
              onChange={(value) => {
                setMode(value);
                setResult(null);
              }}
              options={[
                {
                  value: 'require',
                  label: 'Require a password to open',
                  hint: 'People need a password before they can view the file.',
                },
                {
                  value: 'anyone',
                  label: 'Anyone can open',
                  hint: 'No password to view the file; the restrictions below still apply.',
                },
              ]}
            />

            {needsOpenPassword ? (
              <Field
                label="Open password"
                htmlFor="protect-open-password"
                hint={
                  openPasswordTooShort
                    ? `At least ${MIN_PASSWORD} characters.`
                    : `Up to ${MAX_PDF_PASSWORD_LENGTH} characters.`
                }
                trailing={
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setReveal((value) => !value)}
                    aria-label={reveal ? 'Hide passwords' : 'Show passwords'}
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
                  value={openPassword}
                  onChange={(event) => {
                    setOpenPassword(event.target.value);
                    setResult(null);
                  }}
                />
              </Field>
            ) : null}

            <span className="field__label" style={{ marginTop: 4 }}>
              Permissions
            </span>
            <Toggle
              checked={restrictEditing}
              onChange={(v) => {
                setRestrictEditing(v);
                setResult(null);
              }}
              label="Restrict editing"
              hint="Content changes, page assembly and re-saving the text."
            />
            <Toggle
              checked={restrictPrinting}
              onChange={(v) => {
                setRestrictPrinting(v);
                setResult(null);
              }}
              label="Restrict printing"
            />
            <Toggle
              checked={restrictCopying}
              onChange={(v) => {
                setRestrictCopying(v);
                setResult(null);
              }}
              label="Restrict copying"
              hint="Text and image extraction. Not screen-reader access — that stays allowed."
            />
            <Toggle
              checked={restrictAnnotating}
              onChange={(v) => {
                setRestrictAnnotating(v);
                setResult(null);
              }}
              label="Restrict comments and form filling"
            />

            <Field
              label="Permissions password"
              htmlFor="protect-permissions-password"
              hint={
                permissionsPasswordMissing
                  ? 'Required: it is what lets the restrictions be lifted later.'
                  : permissionsPasswordTooShort
                    ? `At least ${MIN_PASSWORD} characters.`
                    : needsOpenPassword
                      ? 'Lifts the restrictions later. Leave blank to reuse the open password.'
                      : 'Lifts the restrictions later. Keep it — without it nobody can change them.'
              }
            >
              <input
                id="protect-permissions-password"
                className="input input--mono"
                type={reveal ? 'text' : 'password'}
                autoComplete="new-password"
                spellCheck={false}
                maxLength={MAX_PDF_PASSWORD_LENGTH}
                value={permissionsPassword}
                placeholder={needsOpenPassword ? 'Same as the open password' : undefined}
                onChange={(event) => {
                  setPermissionsPassword(event.target.value);
                  setResult(null);
                }}
              />
            </Field>

            <Outcome
              rows={[
                { label: 'Cipher', value: 'AES-256 (R6)' },
                { label: 'Password', value: 'One password opens the file' },
                { label: 'Compatibility', value: 'Opens in Adobe Reader, Chrome, Firefox, Preview' },
              ]}
              note="The password is never stored and never leaves this tab. There is no recovery — if you lose it, the file cannot be opened."
            />

            {nothingChanges ? (
              <Notice tone="warn" icon="alert" title="Nothing would change">
                With no open password and no restricted action, the file would be identical to the one you
                started with. Turn on at least one restriction, or require a password to open.
              </Notice>
            ) : null}

            <Notice tone="default" icon="shield" title="Permissions are a request, not a lock">
              The restrictions are stored in the file and applied by PDF readers that enforce them; several
              built-in browser viewers ignore them entirely. The open password is the part that is real
              cryptography. Screen-reader text extraction always stays allowed.
            </Notice>

            <Notice tone="default" icon="shield">
              The permissions password can also open the document — the PDF standard gives it full access — so
              share it only with people who may change the restrictions. Neither password is stored, logged or
              sent anywhere, and there is no recovery.
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
              hint="One document at a time. Your file is encrypted on your device."
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
                note={resultNote}
              />
            ) : (
              <div className="preview-placeholder">
                <Icon name="lock" size={22} />
                <p>{idleNote}</p>
              </div>
            )}
          </>
        )}
      </div>
    </ToolLayout>
  );
}
