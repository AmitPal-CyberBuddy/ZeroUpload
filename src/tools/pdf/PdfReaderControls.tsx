import { useEffect, useRef, useState } from 'react';

/** Read-only, page-level text search. Documents and search work stay local. */
export function PdfReaderControls({ file, order, selected, output, onSelect, zoom, onZoom, locked }: {
  file: Blob; order: number[]; selected: number; output: boolean;
  onSelect: (index: number) => void; zoom: number; onZoom: (zoom: number) => void; locked: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<number[] | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const active = useRef(0);
  const destroy = useRef<(() => void) | null>(null);
  const position = order.indexOf(selected);

  const cancel = () => {
    active.current += 1;
    destroy.current?.();
    destroy.current = null;
  };
  useEffect(() => {
    setResults(null); setProgress(null); setError('');
    return () => cancel();
  }, [file, order, output]);

  const search = async () => {
    cancel();
    const term = query.trim().toLocaleLowerCase();
    setResults(null); setError('');
    if (!term) { setError('Enter text to search for.'); return; }
    const job = active.current;
    setProgress(0);
    try {
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const data = await file.arrayBuffer();
      if (job !== active.current) return;
      const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true });
      destroy.current = () => { void task.destroy(); };
      const doc = await task.promise;
      const found: number[] = [];
      for (let position = 0; position < order.length; position++) {
        if (job !== active.current) return;
        const pdfPage = await doc.getPage(output ? position + 1 : order[position] + 1);
        const content = await pdfPage.getTextContent();
        const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? ' ' : '') : '').join('').toLocaleLowerCase();
        if (text.includes(term)) found.push(order[position]);
        pdfPage.cleanup();
        if (job === active.current) setProgress(position + 1);
      }
      if (job === active.current) { setResults(found); setProgress(null); }
    } catch {
      if (job === active.current) { setError('Could not search this PDF. Try again or use a PDF reader.'); setProgress(null); }
    } finally {
      if (job === active.current) { destroy.current?.(); destroy.current = null; }
    }
  };
  return <div className="pdf-reader-controls">
    <div className="row row--wrap" aria-label="Page navigation">
      <button type="button" className="btn btn--ghost btn--sm" disabled={locked || position <= 0} onClick={() => onSelect(order[position - 1])}>Previous page</button>
      <span aria-live="polite">Page {position + 1} of {order.length} · original {selected + 1}</span>
      <button type="button" className="btn btn--ghost btn--sm" disabled={locked || position >= order.length - 1} onClick={() => onSelect(order[position + 1])}>Next page</button>
    </div>
    <div className="row row--wrap" aria-label="Preview zoom">
      <button type="button" className="btn btn--ghost btn--sm" disabled={zoom <= 50} onClick={() => onZoom(zoom - 25)} aria-label="Zoom out">−</button>
      <span aria-live="polite">Zoom {zoom}%</span>
      <button type="button" className="btn btn--ghost btn--sm" disabled={zoom >= 200} onClick={() => onZoom(zoom + 25)} aria-label="Zoom in">+</button>
      <button type="button" className="btn btn--ghost btn--sm" disabled={zoom === 100} onClick={() => onZoom(100)}>Fit width</button>
    </div>
    <form onSubmit={event => { event.preventDefault(); void search(); }} className="pdf-reader-search">
      <label htmlFor="pdf-search">Find text in kept pages</label>
      <div className="row row--wrap"><input id="pdf-search" className="input" type="search" value={query} maxLength={200} onChange={event => { cancel(); setProgress(null); setResults(null); setError(''); setQuery(event.target.value); }} />
        <button type="submit" className="btn btn--secondary" disabled={progress !== null}>Find pages</button>
        {progress !== null && <button type="button" className="btn btn--ghost" onClick={() => { cancel(); setProgress(null); }}>Stop search</button>}</div>
      <p className="field__hint">Search finds pages with selectable text, not scanned images; it does not highlight matches. Excluded pages are not searched.</p>
    </form>
    {progress !== null && <p role="status">Searching {progress} of {order.length} pages…</p>}
    {error && <p role="alert">{error}</p>}
    {results && <div role="status"><p>{results.length ? `Found on ${results.length} page${results.length === 1 ? '' : 's'}.` : 'No matching pages found.'}</p>
      {results.length > 0 && <div className="pdf-search-results" aria-label="Matching pages">{results.map(index => <button key={index} type="button" className="btn btn--ghost btn--sm" disabled={locked} onClick={() => onSelect(index)}>Original page {index + 1} · position {order.indexOf(index) + 1}</button>)}</div>}</div>}
  </div>;
}
