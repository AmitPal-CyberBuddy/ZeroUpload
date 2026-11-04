import { useEffect, useState } from 'react';
import { getTool } from '../../registry/tools';
import { ToolLayout, Settings } from '../../components/tool/ToolLayout';
import { Notice, Segmented, CopyButton } from '../../components/ui/controls';
import { Icon } from '../../components/ui/Icon';
import { hashText, HASH_ALGORITHMS, isCryptoAvailable, type HashAlgorithm } from '../../lib/hash/hash';
import { formatBytes } from '../../lib/files/format';

const tool = getTool('hash-generator')!;

export default function HashGeneratorTool() {
  const [input, setInput] = useState('ZeroUpload');
  const [algorithm, setAlgorithm] = useState<HashAlgorithm>('SHA-256');
  const [digest, setDigest] = useState('');
  const [error, setError] = useState<string | null>(null);

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

  return (
    <ToolLayout
      tool={tool}
      aside={
        <Settings title="Digest">
          <Segmented
            label="Algorithm"
            value={algorithm}
            onChange={setAlgorithm}
            options={HASH_ALGORITHMS.map((option) => ({ value: option.value, label: option.label }))}
          />
          <div className="setting-row">
            <span className="field__hint">Input size</span>
            <span className="setting-value">{formatBytes(new Blob([input]).size)}</span>
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
              {digest || '—'}
            </div>
            <span className="hint">
              Hex-encoded. The same input always produces the same digest — useful for comparing files you
              cannot upload anywhere.
            </span>
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
