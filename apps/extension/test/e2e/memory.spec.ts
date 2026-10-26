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
