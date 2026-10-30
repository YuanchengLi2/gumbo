import {test,expect} from '../fixtures';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

/** A PDF read in Chrome's own viewer (where no extension's script runs) is kept in memory from the file itself: its words
 * as passages and its facts, found by a question in other words. The PDF is made from a test page by the browser. */
test.describe.configure({timeout:240_000});
test('a PDF on screen is read into memory, its facts and its words',async({page,context,signedIn,standin})=>{
 await page.goto(`${standin.url}/pages/useful/invoice.html`);
 const dir=resolve(import.meta.dirname,'../pages/build');mkdirSync(dir,{recursive:true});
 writeFileSync(resolve(dir,'invoice-1043.pdf'),await page.pdf({format:'A4'}));
 const pdf=await context.newPage();
 await pdf.goto(`${standin.url}/pages/build/invoice-1043.pdf`).catch(()=>{});await pdf.bringToFront();
 await expect.poll(async()=>(await signedIn.evaluate(()=>(globalThis as any).gumbo.db.recent('pages',10))).some((p:any)=>/invoice-1043\.pdf$/.test(p.url)),{timeout:20_000}).toBe(true);
 const kept=(await signedIn.evaluate(()=>(globalThis as any).gumbo.db.recent('pages',10))).find((p:any)=>/invoice-1043\.pdf$/.test(p.url));
 expect(kept.text).toContain('Total due: $482.00');
 expect(JSON.stringify(kept.facts)).toContain('482.00');
 // Found by meaning and by words, like any page read, once its pieces are embedded (headless Chromium runs the model on
 // the processor, slowly at first).
 await expect.poll(async()=>{const s=await signedIn.evaluate(()=>(globalThis as any).gumbo.offscreen({type:'index.stats'}));return s.docs>0&&s.vectors===s.docs;},{timeout:120_000,intervals:[1000]}).toBe(true);
 await expect.poll(async()=>(await signedIn.evaluate(()=>(globalThis as any).gumbo.search('what is the total due on the Acme invoice',{k:5}))).some((f:any)=>/482/.test(f.text)),{timeout:30_000}).toBe(true);
});
