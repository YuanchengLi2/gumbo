/** Draws the toolbar icons (the bowl on paper) from SVG with headless Chromium; run once after changing the mark.
 *   npx tsx apps/extension/scripts/icons.ts */
import {chromium} from '@playwright/test';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="#FFFBEF"/><path d="M8 29h48c0 14.5-10.7 25-24 25S8 43.5 8 29z" fill="#E2552A"/><path d="M23 22c-2.6-3 2.6-5.2 0-8.6M32 22c-2.6-3 2.6-5.2 0-8.6M41 22c-2.6-3 2.6-5.2 0-8.6" fill="none" stroke="#1F1A17" stroke-width="3.6" stroke-linecap="round"/></svg>`;
const out=resolve(import.meta.dirname,'../public/icons');mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});
for(const size of [16,32,48,128]){
 const page=await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
 await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ',`<svg width="${size}" height="${size}" `)}</body></html>`);
 writeFileSync(resolve(out,`${size}.png`),await page.screenshot({omitBackground:true,clip:{x:0,y:0,width:size,height:size}}));await page.close();
}
await browser.close();console.log('icons written');
