import { useEffect, useMemo, useState } from 'react';

import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { Notice, Segmented, CopyButton } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import {
  checkDigest,
  hashText,
  HASH_ALGORITHMS,
  isCryptoAvailable,
  type HashAlgorithm,
} from '../../lib/hash/hash';
import { MAX_STREAM_HASH_BYTES, streamHash } from '../../lib/hash/stream';
import { Progress } from '../../components/ui/Progress';
import { useRunControl } from '../../hooks/useRunControl';
import { formatBytes } from '../../lib/files/format';
import { toolDefinition } from '../../registry/useToolDefinition';

const tool = toolDefinition('hash-generator');

type Mode = 'text' | 'file';

export default function HashGeneratorTool() {
  const [mode, setMode] = useState<Mode>('text');
  const [input, setInput] = useState('ZeroUpload');
  const [file, setFile] = useState<File | null>(null);
  const [algorithm, setAlgorithm] = useState<HashAlgorithm>('SHA-256');
  const [digest, setDigest] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  /** What a published checksum should equal — the reason anyone opens this tool. */
  const [expected, setExpected] = useState('');
  /**
   * File hashing is the one job here that can run for seconds, so it is the one
   * job that gets a Cancel button and a real progress bar. Text hashing is
   * instantaneous and keeps the simple effect below.
   */
  const runControl = useRunControl();

  /*
   * Text hashing stays a plain effect: it is synchronous WebCrypto over a string
   * and finishes before a frame. File hashing runs in slices so it can report
   * progress and be cancelled, which needs "latest job wins" rather than the
   * effect's `active` flag — the same reason `useRunControl` exists elsewhere.
   */
  useEffect(() => {
    if (mode !== 'text') return;
    let active = true;
    setError(null);
    setDigest('');
    if (!input) {
      setBusy(false);
      return () => { active = false; };
    }
    setBusy(true);
    hashText(input, algorithm)
      .then((value) => { if (active) setDigest(value); })
      .catch((err: Error) => { if (active) setError(err.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [mode, input, algorithm]);

  useEffect(() => {
    if (mode !== 'file') return;
    setError(null);
    setDigest('');
    setProgress(null);
    if (!file) {
      setBusy(false);
      return;
    }
    const signal = runControl.begin();
    setBusy(true);
    setProgress(0);
    void streamHash(file, algorithm, {
      signal,
      onProgress: (value) => { if (!signal.aborted) setProgress(value); },
    })
      .then((value) => { if (!signal.aborted) setDigest(value); })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not hash this file.');
      })
      .finally(() => {
        runControl.finish();
        if (!signal.aborted) {
          setBusy(false);
          setProgress(null);
        }
      });
    // `runControl` is a stable ref plus a setter; re-running on it would restart
    // the hash every time its `cancellable` flag flips.
  }, [mode, file, algorithm]);

  const check = useMemo(
    () => (digest && expected.trim() ? checkDigest(expected, digest, algorithm) : null),
    [algorithm, digest, expected],
  );

  return (
    <ToolLayout
      tool={tool}
      aside={
        <Settings title="Digest">
          <Segmented
            label="Input"
            value={mode}
            onChange={(value) => {
              setMode(value);
              setDigest('');
              setError(null);
            }}
            options={[
              { value: 'text', label: 'Text' },
              { value: 'file', label: 'File' },
            ]}
          />

          <Segmented
            label="Algorithm"
            value={algorithm}
            onChange={setAlgorithm}
            options={HASH_ALGORITHMS.map((option) => ({ value: option.value, label: option.label }))}
          />
          <div className="setting-row">
            <span className="field__hint">Input size</span>
            <span className="setting-value">
              {mode === 'file'
                ? file
                  ? formatBytes(file.size)
                  : '—'
                : formatBytes(new Blob([input]).size)}
            </span>
          </div>
          <div className="setting-row">
            <span className="field__hint">Digest length</span>
            <span className="setting-value">{digest ? `${digest.length * 4} bits` : '—'}</span>
          </div>
          <Notice tone={isCryptoAvailable() ? 'accent' : 'danger'}>
            {isCryptoAvailable()
              ? 'Digests are computed on your device. Nothing is transmitted.'
              : 'Web Crypto is unavailable. Open this page over HTTPS or localhost.'}
          </Notice>
        </Settings>
      }
    >
      <div className="tool-body">
        {mode === 'text' ? (
          <div className="editor-pane">
            <div className="editor-pane__head">
              <span>Input text</span>
              <span>{input.length.toLocaleString()} chars</span>
            </div>
            <textarea
              className="textarea"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              spellCheck={false}
              aria-label="Text to hash"
              style={{ height: 200 }}
            />
          </div>
        ) : file ? (
          <FileCard file={file} onRemove={() => { setFile(null); setDigest(''); }} subtitle={formatBytes(file.size)} />
        ) : (
          <FileDrop
            onFiles={(files) => setFile(files[0])}
            title="Drop a file to hash"
            hint={`Read in slices and hashed on this device, never uploaded. Up to ${formatBytes(MAX_STREAM_HASH_BYTES)}.`}
            icon="hash"
          />
        )}

        {error ? (
          <Notice tone="danger">{error}</Notice>
        ) : (
          <div className="result">
            <div className="result__head">
              <span className="result__title">
                <i className="dot" aria-hidden="true" />
                {algorithm} digest
              </span>
              {digest && !busy ? <CopyButton value={digest} label="Copy digest" /> : null}
            </div>
            <div className="hash-block" style={{ fontSize: 14 }}>
              {busy ? (progress === null ? 'Hashing…' : `${Math.round(progress * 100)}%`) : digest || '—'}
            </div>
            {busy && progress !== null ? (
              <div className="row row--wrap" style={{ alignItems: 'center', gap: 'var(--s-2)' }}>
                <Progress value={progress} label="Hashing progress" />
                {runControl.cancellable ? (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={runControl.cancel}>
                    <Icon name="x" size={13} /> Cancel
                  </button>
                ) : null}
              </div>
            ) : null}
            <span className="hint">
              Hex-encoded. The same input always produces the same digest — useful for comparing files you
              cannot upload anywhere.
            </span>

            {/*
              * The comparison is the point of the tool for most people: a digest
              * you cannot check is a number, not an answer. Normalisation happens
              * in `checkDigest`, so uppercase, spaces, a `sha256:` prefix or the
              * shape of `sha256sum` output all work.
              */}
            {digest && !busy ? (
              <div className="hash-verify">
                <label className="field__label" htmlFor="expected-digest">
                  Published checksum
                </label>
                <input
                  id="expected-digest"
                  className="input input--mono"
                  value={expected}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={`Paste the ${algorithm} value to compare`}
                  onChange={(event) => setExpected(event.target.value)}
                />
                {check ? (
                  check.problem === 'empty' ? null : check.problem === 'not-hex' ? (
                    <Notice tone="warn">That is not a hexadecimal digest — check what you pasted.</Notice>
                  ) : check.problem === 'wrong-length' ? (
                    <Notice tone="warn">
                      A {algorithm} digest is {(HASH_ALGORITHMS.find((a) => a.value === algorithm)?.bits ?? 256) / 4}{' '}
                      characters; this one is {check.expected.length}.
                    </Notice>
                  ) : check.match ? (
                    <Notice tone="accent" title="Matches">
                      The digest matches the value you entered. A match is only meaningful if the expected checksum comes from a trusted source; SHA-1 is not collision-resistant.
                    </Notice>
                  ) : (
                    <Notice tone="danger" title="Does not match">
                      The computed digest differs from the value entered. Check that both the checksum and algorithm are correct.
                    </Notice>
                  )
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        <div className="workspace-notes">
          <div>
            <Icon name="shield" size={15} />
            <strong>Not a password tool</strong>
            <p>Raw fast hashes are unsuitable for password storage. Use a dedicated KDF with a salt and work factor.</p>
          </div>
          <div>
            <Icon name="info" size={15} />
            <strong>SHA-1 is legacy</strong>
            <p>It is offered for checksum compatibility only, not for security decisions.</p>
          </div>
        </div>
      </div>
    </ToolLayout>
  );
}
