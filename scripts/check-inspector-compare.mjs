#!/usr/bin/env node
// Run against a built preview; set BASE_URL, BROWSER_PATH and BROWSER_ARGS.
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const browser = await chromium.launch({executablePath: process.env.BROWSER_PATH || undefined, args: (process.env.BROWSER_ARGS || '').split(',').filter(Boolean)});
const base = process.env.BASE_URL || 'http://localhost:4173';
const file = (name, value) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(value) });
try {
  for (const width of [320, 1366]) {
    const page = await browser.newPage({viewport:{width,height:850}}); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
    await page.goto(`${base}/tools/file-inspector/`, {waitUntil:'networkidle'});
    await page.locator('input[type=file]').first().setInputFiles(file('one.txt','same text'));
    await page.getByRole('button',{name:'Compute SHA-256'}).waitFor();
    await page.getByRole('button',{name:'Compare two files'}).click();
    await page.locator('input[type=file]').last().setInputFiles(file('other.txt','same text'));
    await page.getByText('Files match byte for byte').waitFor();
    const sha = createHash('sha256').update('same text').digest('hex');
    assert.equal(await page.getByText(sha,{exact:true}).count(),2);
    await page.getByRole('button',{name:'Remove other.txt'}).click();
    await page.locator('input[type=file]').last().setInputFiles(file('modified.txt','same teXt'));
    await page.getByText('Files are different',{exact:true}).waitFor();
    assert.equal(await page.getByText(sha,{exact:true}).count(),1);
    await page.getByRole('button',{name:'Close comparison'}).click();
    assert.ok(await page.getByRole('button',{name:'Compute SHA-256'}).isVisible());
    await page.getByRole('button',{name:'Inspect another'}).click();
    await page.locator('input[type=file]').first().setInputFiles([file('first.txt','aaa'),file('second.txt','bbb')]);
    await page.getByText('Files are different',{exact:true}).waitFor();
    assert.ok(await page.getByText('second.txt',{exact:true}).isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth), 0);
    assert.deepEqual(errors,[]);
    console.log(`Inspector: ${width}px single-file, optional and two-file intake, match and same-size mismatch passed`);
    await page.goto('about:blank');
  }
} finally { await browser.close(); }
