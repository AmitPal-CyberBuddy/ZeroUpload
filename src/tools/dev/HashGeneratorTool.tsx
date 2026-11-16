import { useEffect, useMemo, useState } from 'react';

import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { Notice, Segmented, CopyButton } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import {
  checkDigest,
  digestBitsIn,
  hashText,
  HASH_ALGORITHMS,
  isCryptoAvailable,
  type HashAlgorithm,
} from '../../lib/hash/hash';
import { MAX_STREAM_HASH_BYTES, streamHash } from '../../lib/hash/stream';
import { identifyDecoded } from '../../lib/dev/text';
import { sniffFileType } from '../../lib/files/mime';
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
   * What the file really is, from its first bytes.
   *
   * A digest identifies a file but says nothing about it, and the moment someone
   * is checking a checksum they are usually also checking they have the right
   * file: an installer rather than a README, a PDF rather than a `.docx` that
   * arrived by email. Two 64-byte reads answer that, and they cost nothing next
   * to the hash already being computed.
   */
  const [identity, setIdentity] = useState<{ label: string; type: string } | null>(null);
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

  useEffect(() => {
    if (mode !== 'file' || !file) {
      setIdentity(null);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const signature = await sniffFileType(file);
        if (!active) return;
        if (signature) {
          setIdentity({ label: signature.label, type: signature.type });
          return;
        }
        // Text has no signature; read a head and name the binary formats the
        // shared identifier knows (PNG, PDF, ZIP, executables, …).
        const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
        const known = identifyDecoded(head);
        if (!active) return;
        setIdentity(known ? { label: known.label, type: known.type } : null);
      } catch {
        if (active) setIdentity(null);
      }
    })();
    return () => { active = false; };
  }, [file, mode]);

  const check = useMemo(
    () => (digest && expected.trim() ? checkDigest(expected, digest, algorithm) : null),
    [algorithm, digest, expected],
  );

  /*
   * Which algorithm the pasted value is actually *for*.
   *
   * The failure this fixes: someone pastes a 64-character SHA-256 checksum while
   * the tool is set to SHA-1, gets "does not match", and concludes the file is
   * wrong. The digest length identifies the family, so the tool can say "this is a
   * SHA-256 value — switch to SHA-256" instead of comparing against the wrong
   * algorithm and reporting a mismatch that is the setting's fault.
   */
  const expectedBits = useMemo(() => (expected.trim() ? digestBitsIn(expected) : null), [expected]);
  const algorithmBits = HASH_ALGORITHMS.find((option) => option.value === algorithm)?.bits ?? 256;
  const suggestedAlgorithm = useMemo(
    () => (expectedBits && expectedBits !== algorithmBits ? HASH_ALGORITHMS.find((option) => option.bits === expectedBits) : undefined),
    [algorithmBits, expectedBits],
  );

  /**
   * When the paste looks like the wrong algorithm, compute the digest that
   * algorithm would produce *for the same input* rather than making the user
   * switch modes and wait for a second file hash.
   */
  const [alternate, setAlternate] = useState<{ algorithm: HashAlgorithm; digest: string } | null>(null);
  const [alternateBusy, setAlternateBusy] = useState(false);

  useEffect(() => {
    if (!suggestedAlgorithm || mode !== 'text' || !input) {
      setAlternate(null);
      return;
    }
    let active = true;
    setAlternateBusy(true);
    hashText(input, suggestedAlgorithm.value)
      .then((value) => { if (active) setAlternate({ algorithm: suggestedAlgorithm.value, digest: value }); })
      .catch(() => { if (active) setAlternate(null); })
      .finally(() => { if (active) setAlternateBusy(false); });
    return () => { active = false; };
  }, [input, mode, suggestedAlgorithm]);

  const alternateCheck = useMemo(
    () => (alternate && expected.trim() ? checkDigest(expected, alternate.digest, alternate.algorithm) : null),
    [alternate, expected],
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
          <>
            <FileCard file={file} onRemove={() => { setFile(null); setDigest(''); }} subtitle={formatBytes(file.size)} />
            {identity ? (
              <p className="hint" role="status">
                The first bytes identify this as {identity.label}
                {file.type && file.type !== identity.type ? `, which does not match the declared ${file.type}` : ''}.
              </p>
            ) : null}
          </>
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
                {/* Only when it *does* match: otherwise this is a second number
                    that answers nothing, and the warning above already says the
                    length does not fit the selected algorithm. */}
                {alternate && alternateCheck?.match ? (
                  <div className="hash-alt">
                    <p className="hint">
                      <strong>{alternate.algorithm}</strong> of the same input matches the value you pasted.
                    </p>
                    <div className="hash-block">{alternate.digest}</div>
                    <Notice tone="accent" title={`Matches as ${alternate.algorithm}`}>
                      The value you pasted is the {alternate.algorithm} digest of this input. Switch the algorithm to{' '}
                      {alternate.algorithm} to work with it directly.
                    </Notice>
                  </div>
                ) : alternateBusy ? (
                  <p className="hint" role="status">Computing the digest the pasted value implies…</p>
                ) : null}

                {check ? (
                  check.problem === 'empty' ? null : check.problem === 'not-hex' ? (
                    <Notice tone="warn">That is not a hexadecimal digest — check what you pasted.</Notice>
                  ) : check.problem === 'wrong-length' ? (
                    <Notice tone={suggestedAlgorithm ? 'warn' : 'default'} title={suggestedAlgorithm ? `That is a ${suggestedAlgorithm.label} digest` : undefined}>
                      A {algorithm} digest is {algorithmBits / 4} characters; this value is {check.expected.length}.
                      {suggestedAlgorithm
                        ? ` Its length matches ${suggestedAlgorithm.label} exactly, so the setting is probably the problem rather than the file.`
                        : ' Check whether part of it was cut off when it was copied.'}
                      {suggestedAlgorithm ? (
                        <div style={{ marginTop: 6 }}>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => setAlgorithm(suggestedAlgorithm.value)}
                          >
                            Compare as {suggestedAlgorithm.label}
                          </button>
                        </div>
                      ) : null}
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
