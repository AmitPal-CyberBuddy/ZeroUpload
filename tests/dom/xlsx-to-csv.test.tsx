import { describe, expect, it } from 'vitest';
import { csvEncode } from '../../src/lib/spreadsheet/csv';
import { readWorksheet, type Workbook } from '../../src/lib/spreadsheet/xlsx';

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function workbook(content: string, shared: string[] = []): Workbook {
  return { sheets: [{ name: 'Test', path: 'sheet.xml', state: 'visible' }], files: new Map([['sheet.xml', new TextEncoder().encode(`<worksheet xmlns="${ns}"><sheetData>${content}</sheetData></worksheet>`)]]), shared };
}
describe('XLSX worksheet export', () => {
  it('preserves sparse positions, raw numbers, strings and booleans', () => {
    const result = readWorksheet(workbook('<row><c r="A1" t="s"><v>0</v></c><c r="C2"><v>12345678901234567890</v></c><c r="B3" t="b"><v>1</v></c></row>', ['  value  ']), 0);
    expect(result.rows).toEqual([['  value  ', '', ''], ['', '', '12345678901234567890'], ['', 'TRUE', '']]);
  });
  it('rejects formula cells without a cached value, errors, and excessively sparse sheets', () => {
    for (const input of ['<c r="A1"><f>1+1</f></c>', '<c r="A1"><f>1+1</f><v></v></c>', '<c r="A1" t="e"><v>#DIV/0!</v></c>', '<c r="IV10000"><v>1</v></c>']) expect(() => readWorksheet(workbook(`<row>${input}</row>`), 0)).toThrow();
    expect(readWorksheet(workbook('<row><c r="A1"><f>1+1</f><v>2</v></c></row>'), 0).formulas).toBe(1);
  });
  it('quotes CSV and offers explicit formula-risk mitigation without changing raw mode', () => {
    const rows = [['a,b', '"hello"', 'line\nbreak', '=2+2', '-3', '  @evil']];
    expect(csvEncode(rows, false).csv).toBe('"a,b","""hello""","line\nbreak",=2+2,-3,  @evil');
    const safe = csvEncode(rows, true);
    expect(safe.protectedCells).toBe(3); expect(safe.csv).toContain("'=2+2,'-3,'  @evil");
  });
});
