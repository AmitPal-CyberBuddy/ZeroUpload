import { readZip } from '../zip/zip';
import { ToolError } from '../files/errors';

export const MAX_XLSX_BYTES = 10 * 1024 * 1024;
const LIMITS = { maxEntries: 1000, maxTotalBytes: 24 * 1024 * 1024, maxEntryBytes: 8 * 1024 * 1024 };
const MAX_ROWS = 10_000, MAX_COLUMNS = 256, MAX_GRID = 200_000;
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
type Sheet = { name: string; path: string; state: string };
export type Workbook = { sheets: Sheet[]; files: Map<string, Uint8Array>; shared: string[] };

function xml(data: Uint8Array | undefined, name: string): Document {
  if (!data) throw new ToolError('corrupt-file', `The workbook is missing ${name}.`);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ToolError('unsupported-type', 'This workbook uses unsupported XML declarations.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new ToolError('corrupt-file', `Could not read ${name}.`);
  return doc;
}
function elements(parent: Document | Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS(XML_NS, name));
}
function textRuns(element: Element): string {
  return elements(element, 't').filter(t => !t.closest('rPh')).map(t => t.textContent ?? '').join('');
}
function resolveTarget(target: string): string {
  if (/^[a-z]+:/i.test(target) || target.includes('\\') || target.includes('?') || target.includes('#')) throw new ToolError('unsupported-type', 'The workbook uses unsupported external or unusual sheet paths.');
  const segments = (target.startsWith('/') ? target.slice(1) : `xl/${target}`).split('/');
  const out: string[] = [];
  for (const part of segments) { if (part === '..') { if (!out.length) throw new ToolError('corrupt-file', 'Invalid workbook path.'); out.pop(); } else if (part && part !== '.') out.push(part); }
  const path = out.join('/');
  if (!path.startsWith('xl/')) throw new ToolError('unsupported-type', 'This workbook uses a sheet outside the workbook directory.');
  return path;
}
export async function openWorkbook(file: File): Promise<Workbook> {
  if (!/\.xlsx$/i.test(file.name)) throw new ToolError('unsupported-type', 'Choose an .xlsx workbook. Older .xls files are not supported.');
  if (!file.size || file.size > MAX_XLSX_BYTES) throw new ToolError('too-large', 'Choose a non-empty .xlsx file up to 10 MB.');
  const archive = await readZip(file, LIMITS);
  if (archive.warnings.length) throw new ToolError('corrupt-file', 'This workbook has duplicate or unsafe archive entries.');
  const files = new Map(archive.entries.map(entry => [entry.meta.name, entry.data]));
  const workbook = xml(files.get('xl/workbook.xml'), 'workbook.xml');
  const rels = xml(files.get('xl/_rels/workbook.xml.rels'), 'workbook relationships');
  const relationships = new Map<string, string>();
  for (const rel of Array.from(rels.getElementsByTagNameNS('*', 'Relationship'))) {
    const id = rel.getAttribute('Id'), type = rel.getAttribute('Type'), target = rel.getAttribute('Target');
    if (id && type?.endsWith('/worksheet') && target && rel.getAttribute('TargetMode') !== 'External') relationships.set(id, resolveTarget(target));
  }
  const sheets = elements(workbook, 'sheet').map(sheet => {
    const name = sheet.getAttribute('name') ?? '';
    const id = sheet.getAttributeNS(REL_NS, 'id');
    const path = id && relationships.get(id);
    if (!name || !path || !files.has(path)) throw new ToolError('unsupported-type', 'This workbook contains a sheet that cannot be read.', 'Only standard .xlsx worksheets are supported.');
    return { name, path, state: sheet.getAttribute('state') ?? 'visible' };
  });
  if (!sheets.length || sheets.length > 50) throw new ToolError('limit-exceeded', 'Choose a workbook with 1–50 standard worksheets.');
  const sharedFile = files.get('xl/sharedStrings.xml');
  const shared = sharedFile ? elements(xml(sharedFile, 'shared strings'), 'si').map(textRuns) : [];
  return { sheets, files, shared };
}
function coordinates(ref: string): [number, number] {
  const match = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(ref);
  if (!match) throw new ToolError('corrupt-file', `Unsupported cell reference: ${ref || '(missing)'}.`);
  let column = 0; for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (row > MAX_ROWS || column > MAX_COLUMNS) throw new ToolError('limit-exceeded', 'The selected sheet exceeds 10,000 rows or 256 columns.');
  return [row - 1, column - 1];
}
export function readWorksheet(workbook: Workbook, index: number): { rows: string[][]; formulas: number } {
  const sheet = workbook.sheets[index];
  if (!sheet) throw new ToolError('invalid-input', 'Choose a worksheet.');
  const doc = xml(workbook.files.get(sheet.path), sheet.name);
  const containers = elements(doc, 'sheetData');
  if (containers.length !== 1) throw new ToolError('corrupt-file', 'The worksheet data is missing or ambiguous.');
  const cells = elements(containers[0], 'c');
  const values: { row: number; col: number; value: string }[] = [];
  const seen = new Set<string>(); let maxRow = -1, maxCol = -1, formulas = 0;
  for (const cell of cells) {
    const ref = cell.getAttribute('r') ?? '';
    if (seen.has(ref)) throw new ToolError('corrupt-file', `Duplicate cell ${ref}.`);
    seen.add(ref);
    const [row, col] = coordinates(ref);
    const type = cell.getAttribute('t') ?? 'n';
    const v = elements(cell, 'v')[0]; const formula = elements(cell, 'f')[0];
    if (type === 'e') throw new ToolError('unsupported-type', `Cell ${ref} contains a spreadsheet error.`, 'Fix errors in the workbook before exporting.');
    if (formula) { formulas++; if (!v || (type !== 'str' && !v.textContent?.trim())) throw new ToolError('unsupported-type', `Formula in ${ref} has no cached result.`, 'Open and recalculate the workbook in a spreadsheet app, then save it and try again.'); }
    let value = v?.textContent ?? '';
    if (type === 's') {
      if (!v || !/^\d+$/.test(value) || workbook.shared[Number(value)] === undefined) throw new ToolError('corrupt-file', `Invalid shared string in ${ref}.`);
      value = workbook.shared[Number(value)];
    } else if (type === 'inlineStr') {
      const inline = elements(cell, 'is')[0]; if (!inline) throw new ToolError('corrupt-file', `Missing text in ${ref}.`); value = textRuns(inline);
    } else if (type === 'b') {
      if (value !== '0' && value !== '1') throw new ToolError('corrupt-file', `Invalid boolean in ${ref}.`);
      value = value === '1' ? 'TRUE' : 'FALSE';
    } else if (!['n', 'str', 'd'].includes(type)) throw new ToolError('unsupported-type', `Cell ${ref} uses an unsupported value type.`);
    if (/_x[0-9a-f]{4}_/i.test(value)) throw new ToolError('unsupported-type', `Cell ${ref} contains an Excel-escaped character this exporter cannot safely interpret.`);
    if (type === 'n' && value && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) throw new ToolError('corrupt-file', `Invalid numeric value in ${ref}.`);
    if (!value && !formula) continue;
    maxRow = Math.max(maxRow, row); maxCol = Math.max(maxCol, col);
    if ((maxRow + 1) * (maxCol + 1) > MAX_GRID) throw new ToolError('limit-exceeded', 'The selected sheet exceeds 200,000 output cells, including blank cells.');
    values.push({ row, col, value });
  }
  const rows = Array.from({ length: maxRow + 1 }, () => Array<string>(maxCol + 1).fill(''));
  for (const { row, col, value } of values) rows[row][col] = value;
  return { rows, formulas };
}
