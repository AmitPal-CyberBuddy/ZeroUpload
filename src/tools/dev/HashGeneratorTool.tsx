import { useEffect, useMemo, useState } from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { Notice, Segmented, CopyButton } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import {
  checkDigest,
  hashFile,
  hashText,
  HASH_ALGORITHMS,
  isCryptoAvailable,
  MAX_HASH_BYTES,
  type HashAlgorithm,
} from '../../lib/hash/hash';
import { formatBytes } from '../../lib/files/format';

const tool = getTool('hash-generator')!;

type Mode = 'text' | 'file';

export default function HashGeneratorTool() {
  const [mode, setMode] = useState<Mode>('text');
  const [input, setInput] = useState('ZeroUpload');
  const [file, setFile] = useState<File | null>(null);
  const [algorithm, setAlgorithm] = useState<HashAlgorithm>('SHA-256');
  const [digest, setDigest] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** What a published checksum should equal — the reason anyone opens this tool. */
  const [expected, setExpected] = useState('');

  useEffect(() => {
    let active = true;
    setError(null);
    if (!input) {
      setDigest('');
      return;
    }
    hashText(input, algorithm)
      .then((value) => {
        if (active) setDigest(value);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [algorithm, input]);

  /*
   * File mode exists because the tool's real job is "does this download match the
   * checksum on the release page", and until now the only way to ask was to paste
   * a file's bytes into a textarea. `MAX_HASH_BYTES` is a hard limit of one-shot
   * WebCrypto, not a product choice, so it is stated rather than discovered.
   */
  useEffect(() => {
    if (mode !== 'file' || !file) return;
    let active = true;
    setBusy(true);
    setError(null);
    hashFile(file, algorithm)
      .then((value) => {
        if (active) setDigest(value);
      })
      .catch((err: Error) => {
        if (active) {
          setDigest('');
          setError(err.message);
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [algorithm, file, mode]);

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
            hint={`Read once, hashed on this device, never uploaded. Up to ${formatBytes(MAX_HASH_BYTES)} — bigger files overflow the one-shot WebCrypto digest.`}
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
              {digest ? <CopyButton value={digest} label="Copy digest" /> : null}
            </div>
            <div className="hash-block" style={{ fontSize: 14 }}>
              {busy ? 'Hashing…' : digest || '—'}
            </div>
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
                      This is the same file the checksum was published for.
                    </Notice>
                  ) : (
                    <Notice tone="danger" title="Does not match">
                      The digests differ. Either the file is not the one the checksum was published for, or it
                      did not download intact.
                    </Notice>
                  )
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        <div className="tool-notes">
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
