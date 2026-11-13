import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream, degrees } from '@cantoo/pdf-lib';
import { runOperation } from '../src/lib/pdf/ops';
import type { PdfEdit } from '../src/lib/pdf/protocol';

async function source() {
  const pdf = await PDFDocument.create(); pdf.addPage([300, 400]); pdf.addPage([500, 600]);
  const bytes = await pdf.save(); return { name: 'test.pdf', blob: new Blob([bytes.slice()]) };
}
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aN8AAAAASUVORK5CYII=', 'base64'));
describe('PDF editor operation', () => {
  it('reorders and removes pages and writes text, rectangle and image additions', async () => {
    const edits: PdfEdit[] = [
      { kind: 'text', page: 1, x: 20, y: 30, text: 'Hello', size: 18 },
      { kind: 'rectangle', page: 1, x: 50, y: 60, width: 20, height: 30, color: '#123456' },
      { kind: 'image', page: 1, x: 10, y: 10, width: 20, height: 20, image: new Blob([png], {type: 'image/png'}), imageType: 'image/png' },
    ];
    const result = await runOperation({kind:'edit', source: await source(), indices:[1,0], edits});
    const pdf = await PDFDocument.load(result.documents[0]);
    expect(pdf.getPages().map(p => p.getWidth())).toEqual([500, 300]);
    expect(pdf.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'))).toBeDefined();
    expect(pdf.getPage(0).node.Contents()).toBeDefined();
    const removed = await runOperation({kind:'edit', source: await source(), indices:[1], edits: []});
    expect((await PDFDocument.load(removed.documents[0])).getPageCount()).toBe(1);
  });
  it('keeps an unchanged document byte-for-byte and retains a form on the add-only path', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    doc.setTitle('Original metadata');
    const field = doc.getForm().createTextField('name');
    field.setText('Original value'); field.addToPage(page, { x: 20, y: 20, width: 100, height: 20 });
    const bytes = await doc.save();
    const input = { name: 'form.pdf', blob: new Blob([bytes.slice()]) };
    const unchanged = await runOperation({kind: 'edit', source: input, indices: [0], edits: []});
    expect(unchanged.documents[0]).toEqual(bytes);
    const changed = await runOperation({kind: 'edit', source: input, indices: [0], edits: [{kind:'text', page: 0, x: 40, y: 80, text: 'Added', size: 12}]});
    const reopened = await PDFDocument.load(changed.documents[0]);
    expect(reopened.getForm().getTextField('name').getText()).toBe('Original value');
    expect(reopened.getTitle()).toBe('Original metadata');
  });
  it('positions additions relative to a non-zero media-box origin on a rotated page', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    page.setMediaBox(40, 50, 300, 400);
    page.setRotation(degrees(90));
    const bytes = await doc.save();
    const src = { name: 'offset.pdf', blob: new Blob([bytes.slice()]) };
    const description = await runOperation({kind: 'describe', source: src});
    expect(description.pages[0]).toMatchObject({ width: 300, height: 400, originX: 40, originY: 50, rotation: 90 });
    const result = await runOperation({kind: 'edit', source: src, indices: [0], edits: [{kind: 'text', page: 0, x: 150, y: 200, size: 12, text: 'Offset'}]});
    const output = await PDFDocument.load(result.documents[0]);
    const streams = output.getPage(0).node.Contents() as PDFArray;
    const content = Array.from({length: streams.size()}, (_, i) => new TextDecoder().decode(decodePDFRawStream(streams.lookup(i) as PDFRawStream).decode())).join('');
    expect(content).toContain('1 0 0 1 190 250 Tm');
    expect(output.getPage(0).getRotation().angle).toBe(90);
  });
  it('rejects empty, duplicate, invalid pages and additions on removed pages', async () => {
    const s = await source();
    for (const indices of [[], [0,0], [4]]) await expect(runOperation({kind:'edit', source:s, indices, edits:[]})).rejects.toThrow();
    await expect(runOperation({kind:'edit', source:s, indices:[0], edits:[{kind:'text', page:1, x:0,y:0,text:'hi',size:12}]})).rejects.toThrow(/removed page/);
    await expect(runOperation({kind:'edit', source:s, indices:[0], edits:[{kind:'rectangle', page:0, x:299,y:0,width:2,height:3,color:'#000000'}]})).rejects.toThrow(/beyond/);
    await expect(runOperation({kind:'edit', source:s, indices:[0], edits:[{kind:'text', page:0, x:1,y:1,text:'नमस्ते',size:12}]})).rejects.toThrow(/cannot encode/);
  });
});
