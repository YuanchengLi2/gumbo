import {test,expect} from '../fixtures';
import {memory,questions} from '../fixtures/memory';

/** Memory in the extension itself: pages go in (sealed, split into passages), the offscreen document embeds them with the
 * model the extension ships, and questions asked in other words come back with the right page in the top five. */
test('remembers what was read and finds it by meaning',async({signedIn})=>{
 const pages=memory.filter(d=>d.kind==='page');
 await signedIn.evaluate(async pages=>{const g=(globalThis as any).gumbo;for(const p of pages)await g.capture({url:p.url,title:p.title,text:p.text});},pages.map(p=>({url:p.url,title:p.title,text:p.text})));
 // Every passage gets its embedding in the background.
 await expect.poll(async()=>{const s=await signedIn.evaluate(()=>(globalThis as any).gumbo.offscreen({type:'index.stats'}));return s.docs>0&&s.vectors===s.docs;},{timeout:90_000,intervals:[1000]}).toBe(true);
 const asked=questions.filter(q=>pages.some(p=>p.id===q.answer));
 const urlOf=(id:string)=>pages.find(p=>p.id===id)!.url;
 const misses:string[]=[];
 for(const q of asked){
  const found:any[]=await signedIn.evaluate(query=>(globalThis as any).gumbo.search(query,{k:5}),q.q);
  if(!found.some(f=>f.url===urlOf(q.answer)))misses.push(`${q.q} → ${found.map(f=>f.title).join(' | ')}`);
 }
 console.log(`memory search in the extension: ${asked.length-misses.length}/${asked.length} in the top five`);
 expect(misses).toEqual([]);
});

/** A page's facts, read by the content script from its structure: on the tab's "now" at once, on the sealed page, and
 * found by a search as the fact itself (the invoice's total sits at the bottom, below its items and small print). */
test('takes in the facts on a page, and a search finds the fact itself',async({page,signedIn,standin})=>{
 await page.goto(`${standin.url}/pages/invoice.html`);await page.bringToFront();
 const url=page.url();
 const total=(facts?:any[])=>facts?.find(f=>f.key==='Total due')?.value;
 await expect.poll(()=>signedIn.evaluate(u=>(globalThis as any).gumbo.memory.live().then((s:any)=>Object.values(s.tabs).map((t:any)=>t.now).find((n:any)=>n?.url===u)?.facts),url).then(total),{timeout:15_000}).toBe('$482.00');
 await expect.poll(()=>signedIn.evaluate(u=>(globalThis as any).gumbo.db.recent('pages',20).then((p:any[])=>p.find(x=>x.url===u)?.facts),url).then(total),{timeout:15_000}).toBe('$482.00');
 const facts:any[]=await signedIn.evaluate(u=>(globalThis as any).gumbo.db.recent('pages',20).then((p:any[])=>p.find(x=>x.url===u).facts),url);
 expect(JSON.stringify(facts)).not.toMatch(/4242|Dashboard|Privacy/);
 await expect.poll(async()=>{
  const found:any[]=await signedIn.evaluate(q=>(globalThis as any).gumbo.search(q,{k:5}),'how much is due on the Northwind invoice');
  return found.some(f=>f.kind==='fact'&&f.text.startsWith('Total due: $482.00')&&f.title.includes('INV-4471'));
 },{timeout:30_000,intervals:[1000]}).toBe(true);
});
