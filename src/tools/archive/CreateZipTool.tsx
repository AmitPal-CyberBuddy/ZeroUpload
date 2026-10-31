import { useRef, useState } from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileManifest, type ManifestItem } from '../../components/file/FileManifest';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { CompareSizes } from '../../components/tool/CompareSizes';
import { Field, Notice, Segmented, Toggle } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { assertWithinSize, toToolError } from '../../lib/files/errors';
import { formatBytes, formatCount } from '../../lib/files/format';
import {
  MIN_AES_PASSWORD_LENGTH,
  ZIP_ENCRYPTION_LABEL,
  type ZipEncryptionKind,
} from '../../lib/zip/zip';
import { OPERATION_BUDGETS } from '../../lib/files/budget';
import { triggerDownload } from '../../lib/files/download';
import { useToast } from '../../hooks/useToast';

const tool = getTool('create-zip')!;

export default function CreateZipTool() {
  const [items, setItems] = useState<ManifestItem[]>([]);
  const [archiveName, setArchiveName] = useState('zeroupload-archive');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'reading' | 'packing' | 'done' | null>(null);
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState('');
  const [kind, setKind] = useState<ZipEncryptionKind>('aes-256');
  const counter = useRef(0);
  const { toast } = useToast();

  const addFiles = (files: File[]) => {
    const accepted: ManifestItem[] = [];
    for (const file of files) {
      try {
        assertWithinSize(file, 'zip');
        counter.current += 1;
        accepted.push({ id: `z${counter.current}`, file });
      } catch (err) {
        const toolError = toToolError(err);
        setError({ message: toolError.message, hint: toolError.hint });
      }
    }
    if (accepted.length) {
      setItems((prev) => [...prev, ...accepted]);
      setResult(null);
    }
  };

  const build = async () => {
    if (items.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(0);
    setStage('reading');
    try {
      const { createZip } = await import('../../lib/zip/zip');
      setStage('packing');
      const blob = await createZip(
        items.map((item) => ({ name: item.file.name, blob: item.file })),
        {
          onProgress: (ratio: number) => setProgress(ratio),
          ...(encrypt ? { password, encryption: kind } : {}),
        },
      );
      setResult(blob);
      setStage('done');
      toast('Archive created locally', 'success');
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
      setStage(null);
    } finally {
      setBusy(false);
    }
  };

  const totalInput = items.reduce((sum, item) => sum + item.file.size, 0);

  return (
    <ToolLayout
      tool={tool}
      aside={
        <Settings
          title="Archive"
          footer={
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={build}
              disabled={busy || items.length === 0 || (encrypt && password.length < MIN_AES_PASSWORD_LENGTH)}
            >
              {busy ? <Spinner /> : <Icon name="zip" size={14} />}
              {busy ? 'Packing…' : 'Create ZIP'}
            </button>
          }
        >
          <Field label="File name">
            <div className="row" style={{ gap: 6 }}>
              <input
                className="input input--mono"
                value={archiveName}
                onChange={(event) => setArchiveName(event.target.value.replace(/[\\/:*?"<>|]+/g, '-'))}
                aria-label="Archive file name"
              />
              <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                .zip
              </span>
            </div>
          </Field>

          <div className="setting-row">
            <span className="field__hint">Files</span>
            <span className="setting-value">{items.length}</span>
          </div>
          <div className="setting-row">
            <span className="field__hint">Input total</span>
            <span className="setting-value">{formatBytes(totalInput)}</span>
          </div>

          <Toggle
            checked={encrypt}
            onChange={(checked) => {
              setEncrypt(checked);
              setResult(null);
            }}
            label="Encrypt the archive"
            hint="A password protects the contents, not the file names."
          />

          {encrypt ? (
            <>
              <Field
                label="Password"
                htmlFor="zip-password"
                hint={
                  password.length > 0 && password.length < MIN_AES_PASSWORD_LENGTH
                    ? `At least ${MIN_AES_PASSWORD_LENGTH} characters.`
                    : 'There is no recovery: forget it and the contents are gone.'
                }
              >
                <input
                  id="zip-password"
                  className="input input--mono"
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  maxLength={128}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setResult(null);
                  }}
                />
              </Field>

              <Field label="Encryption">
                <Segmented
                  label="Encryption method"
                  value={kind}
                  onChange={(value) => {
                    setKind(value);
                    setResult(null);
                  }}
                  options={[
                    { value: 'aes-256', label: 'AES-256' },
                    { value: 'zipcrypto', label: 'ZipCrypto' },
                  ]}
                />
              </Field>

              {kind === 'aes-256' ? (
                <Notice tone="warn" icon="alert" title="Read this before creating the archive">
                  AES-256 ZIP is the WinZip AE-2 standard. <strong>Windows Explorer and macOS Archive
                  Utility cannot open it</strong> — they will report a corrupt archive or ask for a password
                  forever. Your recipient needs 7-Zip, WinRAR, Keka, PeaZip or another AES-aware tool.
                </Notice>
              ) : (
                <Notice tone="warn" icon="alert" title="ZipCrypto is not encryption worth the name">
                  It opens everywhere, including Explorer, but it is breakable — the classic known-plaintext
                  attack recovers the key in minutes. Use it for inconvenience, never for secrecy.
                </Notice>
              )}

              <Notice tone="default" icon="cpu">
                Encrypted archives are supported up to{' '}
                {formatBytes(OPERATION_BUDGETS.zipCreateEncrypted.maxBytes)} and{' '}
                {formatCount(OPERATION_BUDGETS.zipCreateEncrypted.maxItems ?? 0, 'file')} in this browser —
                encryption needs several times the working space of a plain archive. Your bundle is{' '}
                {formatBytes(totalInput)} across {formatCount(items.length, 'file')}.
              </Notice>
            </>
          ) : (
            <Notice tone="default" icon="info">
              Compression happens on your device. Files that are already compressed (JPEG, MP4) will barely
              shrink — that is expected.
            </Notice>
          )}
        </Settings>
      }
    >
      <div className="tool-body">
        <FileDrop
          accept={undefined}
          multiple
          onFiles={addFiles}
          onError={(message) => setError({ message })}
          title={items.length ? 'Add more files' : 'Drop files to bundle'}
          hint="Any file type. Files are added one at a time, so large bundles stay manageable."
          icon="zip"
          compact={items.length > 0}
          disabled={busy}
        />

        {error ? <Notice tone="danger" title="Some files were skipped">{error.message}</Notice> : null}

        <FileManifest
          items={items}
          onMove={(index, direction) =>
            setItems((prev) => {
              const next = [...prev];
              const target = index + direction;
              if (target < 0 || target >= next.length) return prev;
              [next[index], next[target]] = [next[target], next[index]];
              return next;
            })
          }
          onRemove={(id) => { setItems((prev) => prev.filter((item) => item.id !== id)); setResult(null); }}
          emptyLabel="Drop any files here to bundle them into a ZIP."
        />

        {stage ? (
          <>
            <StageTimeline
              stages={['Reading', 'Packing', 'Complete']}
              states={
                stage === 'reading' ? ['active', 'idle', 'idle'] : stage === 'packing' ? ['done', 'active', 'idle'] : ['done', 'done', 'done']
              }
            />
            {busy ? (
              <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="progress__bar" style={{ ['--value' as string]: `${Math.round(progress * 100)}%` }} />
              </div>
            ) : null}
          </>
        ) : null}

        {result ? (
          <div className="result">
            <div className="result__head">
              <span className="result__title">
                <i className="dot" aria-hidden="true" />
                Archive ready
              </span>
              <span className="badge">
                {encrypt ? `${ZIP_ENCRYPTION_LABEL[kind]} · ` : ''}
                {items.length} entries
              </span>
            </div>
            <CompareSizes original={totalInput} output={result.size} originalLabel="Inputs" outputLabel="Archive" />
            <div className="result__actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => triggerDownload(result, `${archiveName || 'zeroupload-archive'}.zip`)}
              >
                <Icon name="download" size={15} /> Download ZIP
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => { setItems([]); setResult(null); }}>
                Start over
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </ToolLayout>
  );
}
