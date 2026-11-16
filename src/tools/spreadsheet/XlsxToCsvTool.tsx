import { useEffect, useMemo, useState } from 'react';

import { ToolLayout } from '../../components/tool/ToolLayout';
import { FileDrop } from '../../components/file/FileDrop';
import { FileCard } from '../../components/tool/FileCard';
import { Notice } from '../../components/ui/controls';
import { triggerDownload } from '../../lib/files/download';
import { toToolError } from '../../lib/files/errors';
import { csvEncode } from '../../lib/spreadsheet/csv';
import { MAX_XLSX_BYTES, openWorkbook, readWorksheet, type Workbook } from '../../lib/spreadsheet/xlsx';
import { toolDefinition } from '../../registry/useToolDefinition';

const tool = toolDefinition('xlsx-to-csv');
export default function XlsxToCsvTool() {
  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [selected, setSelected] = useState(0);
  const [data, setData] = useState<{rows: string[][]; formulas: number} | null>(null);
  const [protect, setProtect] = useState(true);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const load = async (next: File) => {
    setBusy(true); setFile(null); setWorkbook(null); setData(null); setError(null); setSelected(0); setProtect(true); setAck(false);
    try { const opened = await openWorkbook(next); setFile(next); setWorkbook(opened); }
    catch (err) { const problem = toToolError(err); setError({message: problem.message, hint: problem.hint}); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!workbook) return;
    try { setData(readWorksheet(workbook, selected)); setError(null); }
    catch (err) { const problem = toToolError(err); setData(null); setError({message: problem.message, hint: problem.hint}); }
  }, [workbook, selected]);
  const output = useMemo(() => data ? csvEncode(data.rows, protect) : null, [data, protect]);
  const sheet = workbook?.sheets[selected];
  const filename = `${file?.name.replace(/\.xlsx$/i, '') ?? 'workbook'}-${(sheet?.name ?? 'sheet').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')}.csv`;
  return <ToolLayout tool={tool}><div className="tool-body">
    {!file ? <><FileDrop handoffTarget="xlsx-to-csv" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" maxSize={MAX_XLSX_BYTES} disabled={busy} onFiles={files => void load(files[0])} title="Choose an XLSX workbook" hint="One .xlsx up to 10 MB; converted on this device. Older .xls files are not supported." icon="file" />{busy && <p role="status">Opening workbook locally…</p>}</> : <>
      <FileCard file={file} onRemove={() => { setFile(null); setWorkbook(null); setData(null); setError(null); }} />
      <Notice tone="warn" title="CSV is not a workbook">Only the selected sheet’s cell values are exported. Formatting, formulas, other sheets, charts, merged cells and workbook features are not preserved. The original remains unchanged.</Notice>
      <label className="field"><span className="field__label">Worksheet</span><select className="input" value={selected} onChange={event => { setData(null); setError(null); setSelected(Number(event.target.value)); setAck(false); }}>
        {workbook?.sheets.map((item, index) => <option key={index} value={index}>{item.name}{item.state !== 'visible' ? ` (${item.state})` : ''}</option>)}
      </select></label>
      {data && <>
        <p>Exporting {data.rows.length.toLocaleString()} rows. Empty trailing rows and columns are omitted; intermediate empty cells remain.</p>
        <Notice tone="warn" title="Check values before use">Numbers are exported as stored, not as displayed; date-formatted numbers may appear as Excel serial numbers. Formulas are not calculated; {data.formulas.toLocaleString()} cached formula result(s) may be stale. Missing cached results and error cells are refused.</Notice>
        <label className="row row--wrap"><input type="checkbox" checked={protect} onChange={e => { setProtect(e.target.checked); setAck(false); }} /> Prefix potentially formula-like values with an apostrophe</label>
        <p className="hint">On by default: this changes {output?.protectedCells ?? 0} value(s), including some negative numbers. It reduces formula-injection risk when opening CSV in spreadsheet apps, but is not a guarantee.</p>
        {!protect && <><Notice tone="danger" title="Unprotected CSV can be dangerous" announce={false}>Values beginning with formula-like characters may execute as formulas when opened in spreadsheet software. Only use with trusted data.</Notice><label className="row row--wrap"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /> I understand the spreadsheet formula risk.</label></>}
        <section aria-labelledby="csv-preview"><h2 id="csv-preview">CSV preview</h2><p>First 20 rows and 10 columns. Download includes the whole selected sheet.</p><pre className="textarea" tabIndex={0} role="region" aria-label="CSV preview" style={{maxHeight: '18rem', overflow: 'auto', whiteSpace: 'pre'}}>{csvEncode(data.rows.slice(0,20).map(row => row.slice(0,10)), protect).csv || '(empty sheet)'}</pre></section>
        <button className="btn btn--primary" type="button" disabled={!protect && !ack} onClick={() => output && triggerDownload(new Blob(['\ufeff', output.csv], { type: 'text/csv;charset=utf-8' }), filename)}>Download CSV</button>
      </>}
    </>}
    {error && <Notice tone="danger" title="Could not convert this workbook">{error.message}{error.hint && <div className="hint">{error.hint}</div>}</Notice>}
  </div></ToolLayout>;
}
