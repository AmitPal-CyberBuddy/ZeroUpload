import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { runOperation } from '../src/lib/pdf/ops';
import { TOOL_CONTENT } from '../src/seo/toolContent';

describe('PDF page-copy limitations', () => {
  it('shows a warning on both tools and does not promise form preservation', () => {
    for (const name of ['MergePdfTool', 'SplitPdfTool']) {
      const source = readFileSync(`src/tools/pdf/${name}.tsx`, 'utf8');
      expect(source).toContain('Form fields, annotations, bookmarks and digital signatures may not be preserved');
    }
    expect(TOOL_CONTENT['merge-pdf'].limits.join(' ')).toContain('may not be preserved');
    expect(TOOL_CONTENT['split-pdf'].limits.join(' ')).toContain('may not be preserved');
  });

  it('documents why page-copy output must not promise editable form fields', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const field = doc.getForm().createTextField('name');
    field.setText('example'); field.addToPage(page, { x: 20, y: 20, width: 100, height: 20 });
    const bytes = await doc.save();
    const source = { name: 'form.pdf', blob: new Blob([bytes.slice()]) };
    const result = await runOperation({ kind: 'extract', source, indices: [0] }, {});
    const output = await PDFDocument.load(result.documents[0]);
    expect(output.getPageCount()).toBe(1);
    expect(output.getForm().getFields()).toHaveLength(0);
  });
});
