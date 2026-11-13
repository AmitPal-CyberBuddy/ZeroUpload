#!/usr/bin/env node
// Run against a built preview; set BASE_URL, BROWSER_PATH and BROWSER_ARGS.
import { chromium } from 'playwright-core';
import { zipSync, strToU8 } from 'fflate';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relations='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const files={
  'xl/workbook.xml':`<workbook xmlns="${ns}" xmlns:r="${relations}"><sheets><sheet name="Missing cache" sheetId="1" r:id="rId1"/><sheet name="Values" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relations}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relations}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
  'xl/worksheets/sheet1.xml':`<worksheet xmlns="${ns}"><sheetData><row><c r="A1"><f>2+2</f><v/></c></row></sheetData></worksheet>`,
  'xl/worksheets/sheet2.xml':`<worksheet xmlns="${ns}"><sheetData><row><c r="A1" t="inlineStr"><is><t>a,b</t></is></c><c r="B1" t="inlineStr"><is><t>=1+2</t></is></c></row><row><c r="B2"><v>-12</v></c></row></sheetData></worksheet>`
};
const bytes=Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name,value])=>[name,strToU8(value)]))));
const browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||undefined,args:(process.env.BROWSER_ARGS||'').split(',').filter(Boolean)});
try {for(const width of [320,1366]) {
 const page=await browser.newPage({viewport:{width,height:850},acceptDownloads:true});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error') errors.push(m.text())});
 await page.goto(`${process.env.BASE_URL||'http://localhost:4173'}/`);
 await page.locator('input[type=file]').first().setInputFiles({name:'book.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes});
 await page.getByRole('link',{name:'Export a sheet to CSV'}).click();
 await page.getByText('Formula in A1 has no cached result.').waitFor();
 await page.getByLabel('Worksheet').selectOption({label:'Values'});
 await page.getByRole('button',{name:'Download CSV'}).waitFor();
 assert.ok(await page.getByText('On by default:',{exact:false}).isVisible());
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download CSV'}).click()]);
 assert.equal((await readFile(await download.path())).toString(),'\ufeff"a,b",\'=1+2\r\n,\'-12');
 await page.getByLabel('Prefix potentially formula-like values with an apostrophe').uncheck();
 assert.equal(await page.getByRole('button',{name:'Download CSV'}).isDisabled(),true);
 await page.getByLabel('I understand the spreadsheet formula risk.').check();
 const [raw]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download CSV'}).click()]);
 assert.equal((await readFile(await raw.path())).toString(),'\ufeff"a,b",=1+2\r\n,-12');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0); assert.deepEqual(errors,[]);
 console.log(`XLSX to CSV: ${width}px inspector handoff, sheet selection, missing cache and protected/raw downloads passed`);
 await page.goto('about:blank');
}} finally {await browser.close();}
