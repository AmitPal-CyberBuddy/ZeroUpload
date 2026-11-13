import { useEffect, useState } from 'react';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { Notice, CopyButton } from '../../components/ui/controls';
import { formatBytes } from '../../lib/files/format';
import { toToolError } from '../../lib/files/errors';
import { MAX_HASH_BYTES } from '../../lib/hash/hash';

type Result = { identical: boolean; firstDifference: number | null; firstHash: string; secondHash: string };

/** Optional comparison belongs to the inspected file, and is reset with it. */
export function CompareFiles({ first, initial }: { first: File; initial: File | null }) {
  const [open, setOpen] = useState(!!initial);
  const [second, setSecond] = useState<File | null>(initial);
  const [result, setResult] = useState<Result | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!second || !open) return;
    const controller = new AbortController();
    setResult(null); setError(''); setProgress(0);
    void (async () => {
      try {
        const { compareFiles } = await import('../../lib/inspect/compare');
        const outcome = await compareFiles(first, second, { signal: controller.signal, onProgress: value => { if (!controller.signal.aborted) setProgress(value); } });
        if (!controller.signal.aborted) { setResult(outcome); setProgress(null); }
      } catch (err) {
        if (!controller.signal.aborted) { setError(toToolError(err).message); setProgress(null); }
      }
    })();
    return () => controller.abort();
  }, [first, second, open, attempt]);

  return <section className="settings" aria-labelledby="compare-files-heading">
    <div className="settings__head"><span id="compare-files-heading">Compare another file (optional)</span></div>
    <div className="settings__body">
      {!open ? <><p>Compare this file with another without checking digests by hand.</p><button type="button" className="btn btn--secondary btn--sm" onClick={() => setOpen(true)}>Compare two files</button></> : <>
        <p>Both files are compared byte by byte and hashed locally. Names and timestamps do not affect the result. The second file can be up to 512 MB; the first also has the inspector’s intake limit (25 MB for text, 400 MB for other files).</p>
        {!second ? <FileDrop title="Choose a second file" hint="Any file type, up to 512 MB. The inspected file remains your first file." icon="plus" compact maxSize={MAX_HASH_BYTES} onFiles={files => setSecond(files[0])} /> : <FileCard file={second} subtitle="Second file" onRemove={() => { setSecond(null); setResult(null); setError(''); setProgress(null); }} />}
        {progress !== null && <><div role="status">Comparing files… {Math.round(progress * 100)}%</div><button type="button" className="btn btn--ghost btn--sm" onClick={() => { setSecond(null); setProgress(null); }}>Stop comparison</button></>}
        {result && <div aria-live="polite"><Notice tone={result.identical ? 'accent' : 'warn'} title={result.identical ? 'Files match byte for byte' : 'Files are different'}>
          {result.identical ? 'The contents are identical. Their names or timestamps may still differ.' : `The first differing byte is at offset ${result.firstDifference?.toLocaleString()} (counting from zero); a missing byte also counts as a difference. This cannot tell when, why, or by whom a file changed.`}
        </Notice>
        <div className="compare-file-details"><div><strong>Inspected file · {formatBytes(first.size)}</strong><div className="hash-block"><span>{result.firstHash}</span><CopyButton value={result.firstHash} label="Copy first SHA-256" /></div></div><div><strong>Second file · {formatBytes(second?.size ?? 0)}</strong><div className="hash-block"><span>{result.secondHash}</span><CopyButton value={result.secondHash} label="Copy second SHA-256" /></div></div></div>
        <p className="hint">SHA-256 describes content, not authenticity. A match does not prove either file came from a trusted source.</p></div>}
        {error && <Notice tone="danger" title="Could not compare files">{error}</Notice>}
        {second && error && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAttempt(value => value + 1)}>Try comparison again</button>}
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setOpen(false); setSecond(null); setResult(null); setProgress(null); setError(''); }}>Close comparison</button>
      </>}
    </div>
  </section>;
}
