/** Protect spreadsheet users from cells interpreted as formulas. This changes values. */
export function csvEncode(rows: string[][], protect: boolean): { csv: string; protectedCells: number } {
  let protectedCells = 0;
  const lines = rows.map(row => row.map(value => {
    let text = value;
    if (protect && (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))) { text = `'${text}`; protectedCells++; }
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(','));
  return { csv: lines.join('\r\n'), protectedCells };
}
