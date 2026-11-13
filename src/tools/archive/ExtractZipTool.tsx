import { useCallback, useMemo, useState } from 'react';

import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { StageTimeline } from '../../components/tool/StageTimeline';
import { Field, Notice } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { assertWithinSize, toToolError } from '../../lib/files/errors';
import { formatBytes, middleTruncate } from '../../lib/files/format';
import { Outcome } from '../../components/tool/Outcome';
import { MIN_AES_PASSWORD_LENGTH, ZIP_ENCRYPTION_LABEL, type ZipEncryptionKind } from '../../lib/zip/zip';
import { triggerDownload } from '../../lib/files/download';
import { useToast } from '../../hooks/useToast';
import { useRunControl } from '../../hooks/useRunControl';
import { toolDefinition } from '../../registry/useToolDefinition';

const tool = toolDefinition('extract-zip');

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
  const [cancelled, setCancelled] = useState(false);
  const [filter, setFilter] = useState('');
  /** Set when the archive is encrypted and we still need the password. */
  const [locked, setLocked] = useState<{ file: File; kind: ZipEncryptionKind } | null>(null);
  const [password, setPassword] = useState('');
  /** Extraction progress, 0–1, and the id of the entry currently being decoded. */
  const [progress, setProgress] = useState(0);
  /** Entry names the user has ticked for download. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const runControl = useRunControl();

  const load = async (next: File, secret?: string) => {
    setError(null);
    setCancelled(false);
    setEntries([]);
    setWarnings([]);
    setSelected(new Set());
    setFile(null);
    setProgress(0);
    try {
      assertWithinSize(next, 'zip');
      setBusy(true);
      setStage('reading');
      const signal = runControl.begin();
      const { readZip } = await import('../../lib/zip/zip');
      setStage('extracting');
      const archive = await readZip(next, undefined, setProgress, secret, signal);
      setEntries(archive.entries.map((entry) => ({ name: entry.meta.name, size: entry.meta.size, data: entry.data })));
      setWarnings(archive.warnings);
      setFile(next);
      setLocked(null);
      setStage('done');
      toast(`Opened ${archive.entries.length} entries`, 'success');
    } catch (err) {
      const toolError = toToolError(err);
      /*
       * Cancelling is not a failure, and showing it in the danger tone would say
       * that something went wrong. The tool returns to the drop zone with a
       * neutral note; the archive is untouched either way.
       */
      setError(toolError.code === 'cancelled' ? null : { message: toolError.message, hint: toolError.hint });
      setCancelled(toolError.code === 'cancelled');
      setStage(null);
      setProgress(0);
      /*
       * An encrypted archive is not a failure, it is a question. Ask it with a
       * password field instead of an error the user has to decode, and label
       * the cipher from the central directory so the compatibility note is
       * specific rather than generic.
       */
      if (toolError.code === 'encrypted') {
        const [{ inspectZipEncryption }, { readZipTail }] = await Promise.all([
          import('../../lib/zip/zip'),
          import('../../lib/zip/tail'),
        ]);
        /*
         * Only the end-of-central-directory window is needed to name the cipher,
         * and it is already the only part `inspectZipEncryption` scans. Reading
         * the whole 400 MB archive to answer a question about its last 64 KB was
         * a full allocation on the path where memory is already the constraint.
         */
        const kind = inspectZipEncryption(await readZipTail(next)).kind ?? 'zipcrypto';
        setLocked({ file: next, kind });
      }
    } finally {
      runControl.finish();
      setBusy(false);
    }
  };

  const unlock = async () => {
    if (!locked) return;
    setError(null);
    await load(locked.file, password);
  };

  const closeArchive = () => {
    setSelected(new Set());
    setCancelled(false);
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
  // The panel answers for the *selection*, not the archive: filtering to one
  // folder and downloading it is a different question from the whole tree.
  const matching = visible.length;
  const matchingBytes = visible.reduce((sum, entry) => sum + entry.size, 0);

  const downloadEntry = (entry: Entry) => {
    const blob = new Blob([new Uint8Array(entry.data)], { type: 'application/octet-stream' });
    triggerDownload(blob, entry.name.split('/').pop() || 'file');
  };

  /*
   * Selection exists because "download all" is the wrong answer often enough to
   * matter: an archive usually holds one folder you want and nine you do not,
   * and re-zipping 400 MB to keep 3 files is not a download, it is a wait. The
   * checkbox state is keyed by entry name, which is already unique — duplicate
   * names are dropped with a warning during extraction.
   */
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selected.has(entry.name)),
    [entries, selected],
  );
  const selectedBytes = selectedEntries.reduce((sum, entry) => sum + entry.size, 0);
  const allVisibleSelected = matching > 0 && visible.every((entry) => selected.has(entry.name));

  const toggleEntry = useCallback((name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleVisible = useCallback(() => {
    setSelected((current) => {
      const next = new Set(current);
      const everySelected = visible.length > 0 && visible.every((entry) => current.has(entry.name));
      for (const entry of visible) {
        if (everySelected) next.delete(entry.name);
        else next.add(entry.name);
      }
      return next;
    });
  }, [visible]);

  const packAndDownload = async (chosen: Entry[], label: string) => {
    if (chosen.length === 0) return;
    const { createZip } = await import('../../lib/zip/zip');
    const zip = await createZip(
      chosen.map((entry) => ({
        name: entry.name,
        blob: new Blob([new Uint8Array(entry.data)]),
      })),
    );
    triggerDownload(zip, `${file?.name.replace(/\.zip$/i, '') ?? 'archive'}-${label}.zip`);
  };

  const downloadAll = () => packAndDownload(entries, 'extracted');
  const downloadSelected = () => packAndDownload(selectedEntries, 'selected');

  return (
    <ToolLayout
      tool={tool}
      aside={
        file ? (
          <Settings
            title="Archive"
            footer={
              <div className="stack" style={{ gap: 6 }}>
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  onClick={selectedEntries.length > 0 ? downloadSelected : downloadAll}
                >
                  <Icon name="download" size={14} />
                  {selectedEntries.length > 0
                    ? `Download ${selectedEntries.length} selected`
                    : `Download all ${entries.length} as ZIP`}
                </button>
                {selectedEntries.length > 0 && selectedEntries.length < entries.length ? (
                  <button type="button" className="btn btn--ghost btn--sm btn--block" onClick={() => setSelected(new Set())}>
                    Clear selection
                  </button>
                ) : null}
              </div>
            }
          >
            <Outcome
              rows={[
                {
                  label: 'Entries',
                  value: matching === entries.length ? `${entries.length}` : `${matching} of ${entries.length}`,
                },
                { label: 'Expanded', value: formatBytes(matchingBytes) },
                {
                  label: 'Compression',
                  value: file.size ? `${(total / file.size).toFixed(1)}× smaller packed` : '—',
                },
                { label: 'Delivered as', value: selectedEntries.length > 0 ? `ZIP · ${formatBytes(selectedBytes)} selected` : matching === entries.length ? 'Original files' : 'ZIP of the match' },
              ]}
              note="Sizes are the declared uncompressed sizes; everything is unpacked on your device."
            />
            <Notice tone="default" icon="shield">
              Limits: 5,000 files, 512 MB once extracted, 256 MB per file. Archives beyond that are refused{' '}
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
              handoffTarget="extract-zip"
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
              <div className="stack" style={{ gap: 'var(--s-2)' }}>
                <StageTimeline
                  stages={['Reading', 'Extracting', 'Complete']}
                  states={stage === 'reading' ? ['active', 'idle', 'idle'] : stage === 'extracting' ? ['done', 'active', 'idle'] : ['done', 'done', 'done']}
                />
                {busy ? (
                  <div className="row row--between row--wrap" style={{ gap: 'var(--s-3)' }}>
                    <span className="hint" aria-live="polite">
                      {progress > 0 ? `${Math.round(progress * 100)}% of entries unpacked` : 'Reading the central directory…'}
                    </span>
                    {runControl.cancellable ? (
                      <button type="button" className="btn btn--ghost btn--sm" onClick={runControl.cancel}>
                        <Icon name="x" size={13} /> Cancel
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {cancelled ? (
              <Notice tone="default" title="Cancelled">
                The archive was not opened. Nothing was extracted and the file is unchanged.
              </Notice>
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
              <Notice tone="default" icon="alert" title="Names were sanitised">
                <ul style={{ paddingLeft: '1rem', margin: 0 }}>
                  {warnings.slice(0, 4).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                  {warnings.length > 4 ? <li>…and {warnings.length - 4} more</li> : null}
                </ul>
              </Notice>
            ) : null}

            <div className="manifest manifest--selectable">
              <div className="manifest__head">
                <span>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleVisible}
                    aria-label={allVisibleSelected ? 'Clear the selection' : `Select all ${visible.length} shown entries`}
                  />
                </span>
                <span>Entry</span>
                <span style={{ textAlign: 'right' }}>Size</span>
                <span style={{ textAlign: 'right' }}>Get</span>
              </div>
              {visible.slice(0, 300).map((entry) => (
                <div className="manifest__row" key={entry.name}>
                  <span>
                    <input
                      type="checkbox"
                      checked={selected.has(entry.name)}
                      onChange={() => toggleEntry(entry.name)}
                      aria-label={`Select ${entry.name}`}
                    />
                  </span>
                  <span className="manifest__name">
                    <Icon name="file" size={13} />
                    <span title={entry.name}>{middleTruncate(entry.name, 52)}</span>
                  </span>
                  <span className="manifest__size">{formatBytes(entry.size)}</span>
                  <span className="manifest__actions">
                    <button type="button" className="btn btn--icon" onClick={() => downloadEntry(entry)} aria-label={`Download ${entry.name}`}>
                      <Icon name="download" size={13} />
                    </button>
                  </span>
                </div>
              ))}
              {visible.length > 300 ? (
                <div className="manifest__row">
                  <span />
                  <span className="manifest__name">…and {visible.length - 300} more — filter, or download all as ZIP</span>
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
