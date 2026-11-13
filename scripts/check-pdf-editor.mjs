#!/usr/bin/env node
// Opt-in browser regression: run a built app (npm run preview), set BASE_URL and BROWSER_PATH.
import { chromium } from 'playwright-core';
import { PDFDocument, degrees, PDFArray, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.BASE_URL || 'http://localhost:4173';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined, args: (process.env.BROWSER_ARGS || '').split(',').filter(Boolean) });
const source = await PDFDocument.create();
const page1 = source.addPage([300, 400]);
page1.setMediaBox(40, 50, 300, 400); page1.setRotation(degrees(90)); page1.drawText('First page sample', {x: 60, y: 80});
source.addPage([500, 600]).drawText('Second unique needle', {x: 20, y: 20});
const bytes = Buffer.from(await source.save());
try {
  for (const width of [320, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 850 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('input[type=file]').first().setInputFiles({name: 'sample.pdf', mimeType: 'application/pdf', buffer: bytes});
    await page.getByRole('link', {name: 'Edit this PDF'}).click();
    await page.getByRole('heading', {name: 'Arrange pages'}).waitFor();
    await page.locator('.pdf-editor-marker').waitFor();
    await page.getByLabel('Find text in kept pages').fill('unique needle');
    await page.getByRole('button', {name: 'Find pages'}).click();
    await page.getByText('Found on 1 page.').waitFor();
    await page.getByRole('button', {name: 'Original page 2 · position 2'}).click();
    await page.getByRole('button', {name: 'Previous page'}).click();
    await page.locator('.pdf-editor-marker').waitFor();
    await page.getByRole('button', {name: 'Zoom in'}).click();
    await page.getByRole('button', {name: 'Zoom in'}).click();
    assert.ok(await page.getByText('Zoom 150%').isVisible());
    const canvas = page.locator('.pdf-editor-sheet canvas');
    const box = await canvas.boundingBox();
    assert.ok(box);
    await canvas.click({position: {x: box.width / 2, y: box.height / 2}});
    const x = Number(await page.getByLabel('X from left (points)').inputValue());
    const y = Number(await page.getByLabel('Y from bottom (points)').inputValue());
    assert.ok(Math.abs(x - 150) <= 1 && Math.abs(y - 200) <= 1, `Unexpected position: ${x}, ${y}`);
    await page.getByLabel('Text (built-in Latin font)').fill('First');
    await page.getByRole('button', {name: 'Add to page'}).click();
    await page.getByRole('button', {name: 'Edit addition 1'}).click();
    assert.equal(await page.getByRole('button', {name: 'Generate preview and PDF'}).isDisabled(), true);
    await page.getByLabel('Text (built-in Latin font)').fill('Updated');
    await page.getByRole('button', {name: 'Update addition'}).click();
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', {name: 'Remove sample.pdf'}).click();
    assert.ok(await page.getByRole('heading', {name: /Arrange pages/}).isVisible());
    await page.getByRole('button', {name: 'Exclude page 1'}).click();
    assert.ok(await page.getByText(/excluded from output/).isVisible());
    await page.getByRole('button', {name: 'Restore page 1'}).click();
    assert.equal(await page.getByRole('button', {name: 'Edit addition 1'}).isEnabled(), true);
    await page.getByRole('button', {name: 'Page 1', exact: true}).click();
    const [original] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', {name: 'Download original'}).click()]);
    assert.deepEqual(await readFile(await original.path()), bytes);
    await page.getByRole('button', {name: 'Generate preview and PDF'}).click();
    await page.getByRole('button', {name: 'Download edited PDF'}).waitFor({timeout: 30000});
    await page.locator('.pdf-editor-marker').waitFor();
    await page.getByRole('button', {name: 'View original'}).click();
    await page.getByRole('heading', {name: 'Original preview · page 1'}).waitFor();
    await page.getByRole('button', {name: 'View generated copy'}).click();
    await page.getByRole('heading', {name: 'Output preview · page 1'}).waitFor();
    await page.getByLabel('Find text in kept pages').fill('Updated');
    await page.getByRole('button', {name: 'Find pages'}).click();
    await page.getByText('Found on 1 page.').waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', {name: 'Download edited PDF'}).click()]);
    const output = await PDFDocument.load(await readFile(await download.path()));
    assert.deepEqual(output.getPages().map(p => p.getWidth()), [500, 300]);
    const streams = output.getPage(1).node.Contents();
    assert.ok(streams instanceof PDFArray);
    const content = Array.from({length: streams.size()}, (_, i) => new TextDecoder().decode(decodePDFRawStream(streams.lookup(i)).decode())).join('');
    assert.ok(content.includes(`1 0 0 1 ${x + 40} ${y + 50} Tm`), 'Output uses the selected point and media-box origin');
    assert.match(content, /55706461746564/); // Updated, encoded as hex by pdf-lib
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
    assert.deepEqual(errors, []);
    console.log(`PDF editor: ${width}px handoff, search, zoom, rotated placement, restore, compare and downloads passed`);
    await page.goto('about:blank');
  }
} finally { await browser.close(); }
