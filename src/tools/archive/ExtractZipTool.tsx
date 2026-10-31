import { useState } from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { Field, Notice } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { assertWithinSize, toToolError } from '../../lib/files/errors';
import { formatBytes, middleTruncate } from '../../lib/files/format';
import { MIN_AES_PASSWORD_LENGTH, ZIP_ENCRYPTION_LABEL, type ZipEncryptionKind } from '../../lib/zip/zip';
import { triggerDownload } from '../../lib/files/download';
import { useToast } from '../../hooks/useToast';

const tool = getTool('extract-zip')!;

interface Entry {
  name: string;
  size: number;
  data: Uint8Array;
}

export default function ExtractZipTool() {
  const [file, setFile] = useState<File | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'reading' | 'extracting' | 'done' | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [filter, setFilter] = useState('');
  /** Set when the archive is encrypted and we still need the password. */
  const [locked, setLocked] = useState<{ file: File; kind: ZipEncryptionKind } | null>(null);
  const [password, setPassword] = useState('');
  const { toast } = useToast();

  const load = async (next: File, secret?: string) => {
    setError(null);
    setEntries([]);
    setWarnings([]);
    setFile(null);
    try {
      assertWithinSize(next, 'zip');
      setBusy(true);
      setStage('reading');
      const { readZip } = await import('../../lib/zip/zip');
      setStage('extracting');
      const archive = await readZip(next, undefined, undefined, secret);
      setEntries(archive.entries.map((entry) => ({ name: entry.meta.name, size: entry.meta.size, data: entry.data })));
      setWarnings(archive.warnings);
      setFile(next);
      setLocked(null);
      setStage('done');
      toast(`Opened ${archive.entries.length} entries`, 'success');
    } catch (err) {
      const toolError = toToolError(err);
      setError({ message: toolError.message, hint: toolError.hint });
      setStage(null);
      /*
       * An encrypted archive is not a failure, it is a question. Ask it with a
       * password field instead of an error the user has to decode, and label
       * the cipher from the central directory so the compatibility note is
       * specific rather than generic.
       */
      if (toolError.code === 'encrypted') {
        const { inspectZipEncryption } = await import('../../lib/zip/zip');
        const kind = inspectZipEncryption(new Uint8Array(await next.arrayBuffer())).kind ?? 'zipcrypto';
        setLocked({ file: next, kind });
      }
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    if (!locked) return;
    setError(null);
    await load(locked.file, password);
  };

  const closeArchive = () => {
    setFile(null);
    setEntries([]);
    setWarnings([]);
    setLocked(null);
    setPassword('');
    setError(null);
    setStage(null);
  };

  const visible = entries.filter((entry) => entry.name.toLowerCase().includes(filter.toLowerCase()));
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);

  const downloadEntry = (entry: Entry) => {
    const blob = new Blob([new Uint8Array(entry.data)], { type: 'application/octet-stream' });
    triggerDownload(blob, entry.name.split('/').pop() || 'file');
  };

  const downloadAll = async () => {
    if (entries.length === 0) return;
    const { createZip } = await import('../../lib/zip/zip');
    const zip = await createZip(
      entries.map((entry) => ({
        name: entry.name,
        blob: new Blob([new Uint8Array(entry.data)]),
      })),
    );
    triggerDownload(zip, `${file?.name.replace(/\.zip$/i, '') ?? 'archive'}-extracted.zip`);
  };

  return (
    <ToolLayout
      tool={tool}
      aside={
        file ? (
          <Settings
            title="Archive"
            footer={
              <button type="button" className="btn btn--primary btn--block" onClick={downloadAll}>
                <Icon name="download" size={14} /> Download all as ZIP
              </button>
            }
          >
            <div className="setting-row">
              <span className="field__hint">Entries</span>
              <span className="setting-value">{entries.length}</span>
            </div>
            <div className="setting-row">
              <span className="field__hint">Expanded size</span>
              <span className="setting-value">{formatBytes(total)}</span>
            </div>
            <div className="setting-row">
              <span className="field__hint">Ratio</span>
              <span className="setting-value">{file.size ? `${(total / file.size).toFixed(1)}×` : '—'}</span>
            </div>
            <Notice tone="default" icon="shield">
              Limits: 5,000 files, 512 MB once extracted, 256 MB per file. Archives beyond that are refused
              <em>before</em> anything is unpacked.
            </Notice>
          </Settings>
        ) : null
      }
    >
      <div className="tool-body">
        {!file ? (
          <>
            <FileDrop
              accept="application/zip,.zip"
              onFiles={(files) => load(files[0])}
              title="Drop a ZIP archive"
              hint="Every file is listed before you extract, and oversized archives are refused."
              icon="expand"
            />
            {locked ? (
              <div className="result">
                <div className="result__head">
                  <span className="result__title">
                    <i className="dot" aria-hidden="true" />
                    {ZIP_ENCRYPTION_LABEL[locked.kind]} archive
                  </span>
                  <span className="badge">{locked.kind === 'aes-256' ? 'Strong' : 'Weak'}</span>
                </div>
                <FileCard file={locked.file} onRemove={closeArchive} />
                <Field label="Archive password" htmlFor="zip-open-password">
                  <div className="row" style={{ gap: 6 }}>
                    <input
                      id="zip-open-password"
                      className="input input--mono"
                      type="password"
                      autoComplete="current-password"
                      spellCheck={false}
                      maxLength={128}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && password.length >= MIN_AES_PASSWORD_LENGTH) void unlock();
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={unlock}
                      disabled={busy || password.length === 0}
                    >
                      {busy ? <Spinner /> : <Icon name="lock" size={14} />}
                      Open
                    </button>
                  </div>
                </Field>
                {locked.kind === 'aes-256' ? (
                  <Notice tone="default" icon="info">
                    A correct password or a clear refusal — there is no guessing. The same safety limits apply
                    before anything is unpacked.
                  </Notice>
                ) : (
                  <Notice tone="warn" icon="alert">
                    ZipCrypto is weak: a wrong password can occasionally decrypt to garbage rather than fail. If the
                    listing looks wrong, the password is wrong.
                  </Notice>
                )}
              </div>
            ) : null}

            {busy || stage ? (
              <StageTimeline
                stages={['Reading', 'Extracting', 'Complete']}
                states={stage === 'reading' ? ['active', 'idle', 'idle'] : stage === 'extracting' ? ['done', 'active', 'idle'] : ['done', 'done', 'done']}
              />
            ) : null}
            {error && !locked ? (
              <Notice tone="danger" title="This archive was refused">
                {error.message}
                {error.hint ? <div className="hint">{error.hint}</div> : null}
              </Notice>
            ) : null}
          </>
        ) : (
          <>
            <div className="row row--between row--wrap">
              <span className="section-title">Contents</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={closeArchive}>
                <Icon name="x" size={13} /> Close archive
              </button>
            </div>

            <FileCard file={file} onRemove={closeArchive} subtitle={`${entries.length} entries`} />

            <div className="row row--wrap" style={{ gap: 8 }}>
              <input
                className="input"
                style={{ flex: '1 1 200px' }}
                placeholder="Filter entries…"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                aria-label="Filter archive entries"
              />
              <span className="catalog-count">{visible.length} shown</span>
            </div>

            {warnings.length > 0 ? (
              <Notice tone="warn" title="Names were sanitised">
                <ul style={{ paddingLeft: '1rem', margin: 0 }}>
                  {warnings.slice(0, 4).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                  {warnings.length > 4 ? <li>…and {warnings.length - 4} more</li> : null}
                </ul>
              </Notice>
            ) : null}

            <div className="manifest">
              <div className="manifest__head">
                <span>Entry</span>
                <span style={{ textAlign: 'right' }}>Size</span>
                <span style={{ textAlign: 'right' }}>Get</span>
              </div>
              {visible.slice(0, 300).map((entry) => (
                <div className="manifest__row" key={entry.name}>
                  <span className="manifest__name">
                    <Icon name="file" size={13} />
                    <span title={entry.name}>{middleTruncate(entry.name, 52)}</span>
                  </span>
                  <span className="manifest__size">{formatBytes(entry.size)}</span>
                  <span className="manifest__actions">
                    <button type="button" className="btn btn--icon" style={{ width: 26, height: 26 }} onClick={() => downloadEntry(entry)} aria-label={`Download ${entry.name}`}>
                      <Icon name="download" size={13} />
                    </button>
                  </span>
                </div>
              ))}
              {visible.length > 300 ? (
                <div className="manifest__row">
                  <span className="manifest__name">…and {visible.length - 300} more (download all as ZIP)</span>
                </div>
              ) : null}
            </div>

            {visible.length === 0 ? (
              <div className="catalog-empty">No entries match “{filter}”.</div>
            ) : null}

            <Notice tone="default" icon="alert">
              Nothing is saved until you download it, and nothing is uploaded. Treat the contents of any
              archive as untrusted.
            </Notice>
          </>
        )}
      </div>
    </ToolLayout>
  );
}
