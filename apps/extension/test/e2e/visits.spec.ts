import {test,expect} from '../fixtures';
/** Memory's visits: every navigation in every tab is a record, chained to where it came from (the page before it in the
 * tab, or the tab that opened it), timed, and what was read on it counted. */
const visits=(worker:any)=>worker.evaluate(async()=>{const g=(globalThis as any).gumbo;await g.memory.flush();return(await g.db.recent('visits',50)).reverse();});

test('every navigation adds a chained visit',async({signedIn,context,page,standin})=>{
 await page.goto(`${standin.url}/pages/trail.html`);
 await expect.poll(async()=>(await visits(signedIn)).length,{timeout:10_000}).toBe(1);
 // A route in an app that never reloads.
 await page.click('#next');
 await expect.poll(async()=>(await visits(signedIn)).map((v:any)=>v.transition),{timeout:10_000}).toContain('route');
 // A new tab opened from a link.
 const [popup]=await Promise.all([context.waitForEvent('page'),page.click('#reading')]);
 await popup.waitForLoadState();
 // A link followed in the same tab.
 await page.bringToFront();await page.click('#course');await page.waitForURL(/course\.html/);
 await expect.poll(async()=>(await visits(signedIn)).length,{timeout:10_000}).toBe(4);
 const all:any[]=await visits(signedIn);
 const [start,section,reading,course]=['trail.html','section=2','assignments.html','course.html'].map(p=>all.find(v=>v.url.includes(p)));
 expect(section.from).toBe(start.id);expect(section.transition).toBe('route');
 expect(reading.from).toBe(section.id);expect(reading.opener).toBe(start.tab);expect(reading.tab).not.toBe(start.tab);
 expect(course.from).toBe(section.id);expect(course.transition).toContain('link');
 // The page left has its time out, and its kind.
 expect(section.out).toBeGreaterThanOrEqual(section.in);
 expect(course.kind).toBeTruthy();
});

test('what was read is counted on the visit and its passages',async({signedIn,page,standin})=>{
 await page.goto(`${standin.url}/pages/trail.html`);
 // Reading: the user is about (the pointer moves) while the text is in view.
 for(let i=0;i<6;i++){await page.mouse.move(200+i*10,200);await page.waitForTimeout(1000);}
 await expect.poll(async()=>signedIn.evaluate(async()=>{const live=await (globalThis as any).gumbo.memory.live();const tab=Object.values(live.tabs as Record<string,any>).find((t:any)=>t.visits.at(-1)?.url.includes('trail.html'));return tab?.visits.at(-1)?.readMs??0;}),{timeout:15_000}).toBeGreaterThan(2000);
 // Leaving the page puts what was read on its passages.
 await page.click('#course');await page.waitForURL(/course\.html/);
 await expect.poll(async()=>signedIn.evaluate(async()=>{const p=await (globalThis as any).gumbo.db.recent('passages',50);return p.filter((x:any)=>x.url?.includes('trail.html')&&x.seenMs>0).length;}),{timeout:15_000}).toBeGreaterThan(0);
});
