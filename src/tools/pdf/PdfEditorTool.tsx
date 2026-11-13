import { useEffect, useRef, useState } from 'react';

import { ToolLayout } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { Notice } from '../../components/ui/controls';
import { assertWithinSize, toToolError } from '../../lib/files/errors';
import { triggerDownload } from '../../lib/files/download';
import { useRunControl } from '../../hooks/useRunControl';
import type { PageInfo, PdfEdit } from '../../lib/pdf/pdf';
import { PdfReaderControls } from './PdfReaderControls';
import { toolDefinition } from '../../registry/useToolDefinition';

const tool = toolDefinition('pdf-editor');
type Kind = PdfEdit['kind'];

interface Viewport {
  width: number;
  height: number;
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

function PdfPreview({ file, page, info, x, y, zoom, onPlace }: {
  file: Blob; page: number; info: PageInfo; x: number; y: number; zoom: number;
  onPlace: (x: number, y: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    setError(''); setViewport(null);
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const data = await file.arrayBuffer();
        if (cancelled) return;
        const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true });
        destroy = () => { void task.destroy(); };
        const doc = await task.promise;
        const pdfPage = await doc.getPage(page);
        const unscaled = pdfPage.getViewport({ scale: 1 });
        const view = pdfPage.getViewport({ scale: Math.min(2, 1600 / Math.max(unscaled.width, unscaled.height)) });
        if (cancelled || !canvas.current) return;
        const element = canvas.current;
        element.width = Math.ceil(view.width); element.height = Math.ceil(view.height);
        const context = element.getContext('2d');
        if (!context) throw new Error('Canvas is unavailable.');
        await pdfPage.render({ canvasContext: context, viewport: view }).promise;
        if (!cancelled) setViewport(view);
      } catch {
        if (!cancelled) setError('Preview could not be rendered. You can still use the coordinate controls and check the downloaded PDF in a reader.');
      }
    })();
    return () => { cancelled = true; destroy?.(); };
  }, [file, page]);
  const point = viewport && Number.isFinite(x) && Number.isFinite(y)
    ? viewport.convertToViewportPoint(x + info.originX, y + info.originY) : null;
  const visible = point && viewport && point[0] >= 0 && point[1] >= 0 && point[0] <= viewport.width && point[1] <= viewport.height;
  return <div className="pdf-editor-preview" role="region" aria-label="PDF page preview, scroll to inspect" tabIndex={0}>
    {error ? <p role="status">{error}</p> : !viewport ? <p role="status">Rendering page preview…</p> : null}
    <div className="pdf-editor-sheet" style={{ width: `${zoom}%`, maxWidth: viewport ? `${viewport.width * zoom / 100}px` : undefined }}>
      <canvas ref={canvas} aria-label={`Visual preview of page ${page}. Use the position fields to place an addition.`}
        onClick={event => {
          if (!viewport || event.button !== 0) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const [pdfX, pdfY] = viewport.convertToPdfPoint((event.clientX - bounds.left) * viewport.width / bounds.width, (event.clientY - bounds.top) * viewport.height / bounds.height);
          onPlace(Math.round((pdfX - info.originX) * 10) / 10, Math.round((pdfY - info.originY) * 10) / 10);
        }} />
      {visible && viewport && point && <span aria-hidden="true" className="pdf-editor-marker" style={{ left: `${point[0] / viewport.width * 100}%`, top: `${point[1] / viewport.height * 100}%` }} />}
    </div>
  </div>;
}

export default function PdfEditorTool() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [selected, setSelected] = useState(0);
  const [edits, setEdits] = useState<PdfEdit[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [placementMessage, setPlacementMessage] = useState('');
  const [zoom, setZoom] = useState(100);
  const [kind, setKind] = useState<Kind>('text');
  const [text, setText] = useState('');
  const [x, setX] = useState(40); const [y, setY] = useState(40);
  const [width, setWidth] = useState(100); const [height, setHeight] = useState(50);
  const [size, setSize] = useState(18); const [color, setColor] = useState('#000000');
  const [image, setImage] = useState<File | null>(null);
  const [result, setResult] = useState<Blob | null>(null);
  const [viewOutput, setViewOutput] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const control = useRunControl();
  const info = pages.find(p => p.index === selected);
  const resultPage = Math.max(1, order.indexOf(selected) + 1);
  const hasDraft = edits.length > 0 || order.length !== pages.length || order.some((index, position) => index !== pages[position]?.index);
  useEffect(() => {
    if (!file || !hasDraft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [file, hasDraft]);
  const invalidate = () => { setResult(null); setViewOutput(false); };

  const load = async (next: File) => {
    setError(''); setResult(null); setFile(null); setPages([]); setOrder([]); setEdits([]); setEditing(null);
    try {
      assertWithinSize(next, 'pdf'); setBusy(true);
      const { describePdf } = await import('../../lib/pdf/pdf');
      const list = await describePdf(next);
      if (!list.length || list.length > 500) throw new Error('Choose a PDF with 1–500 pages.');
      setPages(list); setOrder(list.map(p => p.index)); setSelected(list[0].index); setFile(next);
    } catch (err) { setError(toToolError(err).message); }
    finally { setBusy(false); }
  };
  const move = (position: number, direction: number) => {
    const next = [...order]; const target = position + direction;
    if (target < 0 || target >= next.length) return;
    [next[position], next[target]] = [next[target], next[position]]; setOrder(next); invalidate();
  };
  const removePage = (index: number) => {
    const next = order.filter(p => p !== index); setOrder(next); setEditing(null);
    if (selected === index && next.length) setSelected(next[0]); invalidate();
  };
  const add = () => {
    setError('');
    if (!info || (editing === null && edits.length >= 100)) { setError('The editor allows at most 100 additions.'); return; }
    if (![x,y].every(Number.isFinite) || x < 0 || y < 0 || x > info.width || y > info.height) { setError('Coordinates must be inside the original page.'); return; }
    if (kind !== 'text' && (![width,height].every(Number.isFinite) || width <= 0 || height <= 0 || x + width > info.width || y + height > info.height)) { setError('The addition must fit inside the original page.'); return; }
    let item: PdfEdit;
    if (kind === 'text') {
      if (!text.trim() || text.length > 500 || !Number.isFinite(size) || size < 4 || size > 144) { setError('Enter text (up to 500 characters) and a font size from 4 to 144.'); return; }
      item = { kind, page: selected, x, y, text, size };
    } else if (kind === 'rectangle') item = { kind, page: selected, x, y, width, height, color };
    else {
      const type = image?.type || (image && /\.png$/i.test(image.name) ? 'image/png' : image && /\.jpe?g$/i.test(image.name) ? 'image/jpeg' : '');
      if (!image || !['image/png','image/jpeg'].includes(type) || !image.size || image.size > 10 * 1024 * 1024) { setError('Choose a JPEG or PNG image up to 10 MB.'); return; }
      if (edits.reduce((total, edit, index) => total + (index !== editing && edit.kind === 'image' ? edit.image.size : 0), 0) + image.size > 50 * 1024 * 1024) { setError('Images in one edit are limited to 50 MB in total.'); return; }
      item = { kind, page: selected, x, y, width, height, image, imageType: type as 'image/png' | 'image/jpeg' };
    }
    setEdits(editing === null ? [...edits, item] : edits.map((edit, index) => index === editing ? item : edit));
    setEditing(null); invalidate();
  };
  const editAddition = (index: number) => {
    const edit = edits[index];
    setEditing(index); setSelected(edit.page); setKind(edit.kind); setX(edit.x); setY(edit.y);
    if (edit.kind === 'text') { setText(edit.text); setSize(edit.size); }
    else {
      setWidth(edit.width); setHeight(edit.height);
      if (edit.kind === 'rectangle') setColor(edit.color);
      else setImage(edit.image instanceof File ? edit.image : new File([edit.image], 'image', { type: edit.imageType }));
    }
    setError('');
    document.getElementById('editor-add')?.focus();
  };
  const create = async () => {
    if (!file || !order.length) return;
    setBusy(true); setError(''); const signal = control.begin();
    try {
      const { editPdf, pdfBytesToBlob } = await import('../../lib/pdf/pdf');
      const bytes = await editPdf(file, order, edits.filter(edit => order.includes(edit.page)), { signal });
      setResult(pdfBytesToBlob(bytes)); setViewOutput(true);
    } catch (err) { setError(toToolError(err).message); }
    finally { control.finish(); setBusy(false); }
  };
  const numeric = (label: string, value: number, setter: (value: number) => void) => <label className="field"><span className="field__label">{label}</span><input type="number" className="input" value={Number.isNaN(value) ? '' : value} onChange={e => setter(e.target.value === '' ? NaN : Number(e.target.value))} /></label>;
  return <ToolLayout tool={tool}><div className="tool-body">
    {!file ? <><FileDrop handoffTarget="pdf-editor" accept="application/pdf,.pdf" onFiles={files => void load(files[0])} disabled={busy} title="Drop a PDF to edit" hint="Up to 200 MB and 500 pages. Processing stays on your device." icon="pdf" />{busy && <p role="status">Opening PDF…</p>}</> : <>
      <FileCard file={file} subtitle={`${pages.length} pages`} onRemove={busy ? undefined : () => { if (hasDraft && !window.confirm('Discard this editing session? Your original file is unchanged, but page changes and additions will be lost.')) return; setFile(null); setResult(null); setPages([]); setOrder([]); setEdits([]); setEditing(null); }} />
      <p className="field__hint">Changes are held only in this tab. Download your work before leaving; navigating away discards the draft.</p>
      <Notice tone="warn" title="Keep your original">Copied pages may lose interactive forms, annotations, bookmarks and signatures. Added rectangles are not secure redaction: underlying content remains.</Notice>
      <section aria-labelledby="editor-pages"><h2 id="editor-pages">Arrange pages</h2><p>Choose a page to preview or add content. Excluded pages and their additions can be restored before generating.</p>
        <ol className="pdf-editor-pages">{order.map((index, position) => <li key={index}>
          <button type="button" className="btn btn--ghost btn--sm" aria-pressed={selected === index} disabled={editing !== null} onClick={() => { setSelected(index); setEditing(null); }}>Page {index + 1}{selected === index ? ' · selected' : ''}</button>
          <div className="row row--wrap"><button type="button" className="btn btn--ghost btn--sm" disabled={busy || editing !== null || position === 0} onClick={() => move(position, -1)} aria-label={`Move page ${index + 1} earlier`}>↑</button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy || editing !== null || position === order.length - 1} onClick={() => move(position, 1)} aria-label={`Move page ${index + 1} later`}>↓</button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy || editing !== null || order.length === 1} onClick={() => removePage(index)} aria-label={`Exclude page ${index + 1}`}>Exclude</button></div>
        </li>)}</ol>
        {pages.some(page => !order.includes(page.index)) && <div><h3>Excluded pages</h3><p>Excluded pages and their additions will not appear in the generated PDF. Restore a page to bring its additions back.</p><div className="pdf-search-results">{pages.filter(page => !order.includes(page.index)).map(page => <button key={page.index} type="button" className="btn btn--ghost btn--sm" disabled={busy || editing !== null} onClick={() => { setOrder([...order, page.index]); invalidate(); }}>Restore page {page.index + 1}</button>)}</div></div>}
      </section>
      {info && <section aria-labelledby="editor-preview"><h2 id="editor-preview">{result && viewOutput ? 'Output preview' : 'Original preview'} · page {selected + 1}</h2>{result && <div className="row row--wrap" role="group" aria-label="Preview version"><button type="button" className="btn btn--ghost btn--sm" aria-pressed={!viewOutput} onClick={() => setViewOutput(false)}>View original</button><button type="button" className="btn btn--ghost btn--sm" aria-pressed={viewOutput} onClick={() => setViewOutput(true)}>View generated copy</button></div>}
      <PdfReaderControls file={viewOutput && result ? result : file} order={order} selected={selected} output={!!result && viewOutput} onSelect={index => { setSelected(index); setEditing(null); }} zoom={zoom} onZoom={setZoom} locked={editing !== null} /><p>{result && viewOutput ? 'This is the generated copy. Make changes and generate again to update the preview.' : 'This is the original. Additions appear only in the generated copy.'} Tap or click the preview to set the placement point, or use the position fields below. The marker indicates the text baseline or the lower-left corner of an image or rectangle.</p><PdfPreview key={`${viewOutput && result ? 'output' : 'original'}-${selected}`} file={viewOutput && result ? result : file} page={result && viewOutput ? resultPage : selected + 1} info={info} x={x} y={y} zoom={zoom} onPlace={(nextX, nextY) => { setX(nextX); setY(nextY); setPlacementMessage(`Position set to ${nextX} points from left and ${nextY} points from bottom.`); }} /><span className="visually-hidden" aria-live="polite">{placementMessage}</span>
      <p>Original page: {Math.round(info.width * 10) / 10} × {Math.round(info.height * 10) / 10} points; rotation {info.rotation}°. Coordinates are measured from the lower-left of the unrotated media box. Text may run off the page; check the generated preview.</p></section>}
      <section aria-labelledby="editor-add"><h2 id="editor-add" tabIndex={-1}>{editing === null ? `Add to page ${selected + 1}` : `Edit addition ${editing + 1} on page ${selected + 1}`}</h2>
        <label className="field"><span className="field__label">Addition type</span><select className="input" value={kind} onChange={e => setKind(e.target.value as Kind)}><option value="text">Text</option><option value="rectangle">Rectangle</option><option value="image">Image</option></select></label>
        {kind === 'text' && <><label className="field"><span className="field__label">Text (built-in Latin font)</span><textarea className="input" value={text} maxLength={500} onChange={e => setText(e.target.value)} /></label>{numeric('Font size (points)', size, setSize)}</>}
        {kind === 'image' && <label className="field"><span className="field__label">JPEG or PNG image</span><input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={e => setImage(e.target.files?.[0] ?? null)} />{image && <span className="field__hint">Selected: {image.name}</span>}</label>}
        {kind === 'rectangle' && <label className="field"><span className="field__label">Rectangle colour</span><input type="color" value={color} onChange={e => setColor(e.target.value)} /></label>}
        <div className="pdf-editor-fields">{numeric('X from left (points)', x, setX)}{numeric('Y from bottom (points)', y, setY)}{kind !== 'text' && <>{numeric('Width (points)', width, setWidth)}{numeric('Height (points)', height, setHeight)}</>}</div>
        <button type="button" className="btn btn--secondary" disabled={busy} onClick={add}>{editing === null ? 'Add to page' : 'Update addition'}</button>{editing !== null && <button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>Cancel editing</button>}
      </section>
      <section aria-labelledby="editor-additions"><h2 id="editor-additions">Additions ({edits.length})</h2>{edits.length === 0 ? <p>No additions yet. You can also generate a copy with only page changes.</p> : <ol className="pdf-editor-pages">{edits.map((edit, index) => <li key={index}><span>Page {edit.page + 1}{!order.includes(edit.page) ? ' · excluded from output' : ''} · {edit.kind}{edit.kind === 'text' ? `: ${edit.text}` : ''} · {edit.x}, {edit.y} pt</span><div className="row row--wrap"><button type="button" className="btn btn--ghost btn--sm" disabled={busy || editing !== null || !order.includes(edit.page)} aria-label={`Edit addition ${index + 1}`} onClick={() => editAddition(index)}>Edit</button><button type="button" className="btn btn--ghost btn--sm" disabled={busy || editing !== null} aria-label={`Remove addition ${index + 1}`} onClick={() => { setEdits(edits.filter((_, i) => i !== index)); setEditing(null); invalidate(); }}>Remove</button></div></li>)}</ol>}</section>
      {editing !== null && <p role="status">Update or cancel the addition you are editing before changing pages, generating or downloading the copy.</p>}
      <div className="row row--wrap"><button type="button" className="btn btn--ghost" onClick={() => triggerDownload(file, file.name)}>Download original</button><button type="button" className="btn btn--primary" disabled={busy || editing !== null} onClick={() => void create()}>{busy ? 'Generating…' : 'Generate preview and PDF'}</button>{busy && control.cancellable && <button type="button" className="btn btn--ghost" onClick={control.cancel}>Cancel</button>}{result && <button type="button" className="btn btn--secondary" disabled={editing !== null} onClick={() => triggerDownload(result, `${file.name.replace(/\.pdf$/i, '')}-edited.pdf`)}>Download edited PDF</button>}</div>
    </>}
    {error && <Notice tone="danger" title="Could not continue">{error}</Notice>}
  </div></ToolLayout>;
}
