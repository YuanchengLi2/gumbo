import {test,expect,tell} from '../fixtures';
import type {Page,Worker} from '@playwright/test';

/** Tab end to end against the stand-in gateway: it asks after a pause with the field's context, shows the first words as
 * they stream, Tab takes it (and undo takes it back), typing through keeps it with no new request, Ctrl+→ takes a word,
 * Esc dismisses; nothing in passwords or where Gumbo is off; memory is sealed on disk and still feeds the next field. */
const tabState=(worker:Worker,page:Page)=>tell(worker,page,{type:'debug.tab'});
async function ghost(worker:Worker,page:Page){await expect.poll(async()=>(await tabState(worker,page))?.showing,{timeout:5000}).toBe(true);return tabState(worker,page);}

test('suggests after a pause, Tab accepts it into the field, Ctrl+Z takes it back',async({page,signedIn,standin})=>{
 standin.script=()=>({text:' the notes from our call.',firstMs:30,chunkMs:8});
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ta').click();
 await page.keyboard.type('Thanks for',{delay:20});
 const shown=await ghost(signedIn,page);expect(shown.rest).toBe(' the notes from our call.');
 const body=standin.bodies.find(b=>b.purpose==='tab');
 // DeepSeek by default, told not to think (a quick call).
 expect(body).toMatchObject({model:'deepseek-flash',stream:true,max_tokens:40,dream_thinking:'off'});
 // Two predictions are asked at once (only what both say shows): requests come in identical pairs, the first pair as
 // soon as a word ended ("Thanks "), the next after the pause.
 const asked=standin.bodies.filter(b=>b.purpose==='tab');expect(asked.length%2).toBe(0);
 expect(JSON.stringify(asked.at(-1).messages)).toBe(JSON.stringify(asked.at(-2).messages));
 const prompt=JSON.stringify(body.messages);expect(prompt).toContain('Thanks for⟨cursor⟩');expect(prompt).toContain('What the field is for');
 await page.keyboard.press('Tab');
 await expect(page.locator('#ta')).toHaveValue('Thanks for the notes from our call.');
 // Focus stayed in the field: Tab was Gumbo's, not the page's.
 expect(await page.evaluate(()=>document.activeElement?.id)).toBe('ta');
 await page.keyboard.press('Control+z');await expect(page.locator('#ta')).toHaveValue('Thanks for');
 await expect.poll(async()=>(await signedIn.evaluate(()=>(globalThis as any).gumbo.stats())).accepted).toBe(1);
});

test('typing the same letters keeps the suggestion with no new request; Esc dismisses; Ctrl+→ takes one word',async({page,signedIn,standin})=>{
 standin.script=()=>({text:' the notes from our call.',firstMs:20});
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ta').click();
 await page.keyboard.type('Thanks for',{delay:20});await ghost(signedIn,page);
 const asked=standin.bodies.filter(b=>b.purpose==='tab').length;
 await page.keyboard.type(' the',{delay:30});
 const after=await tabState(signedIn,page);expect(after.rest).toBe(' notes from our call.');
 await page.waitForTimeout(400);expect(standin.bodies.filter(b=>b.purpose==='tab').length).toBe(asked);
 await page.keyboard.press('Control+ArrowRight');await expect(page.locator('#ta')).toHaveValue('Thanks for the notes');
 expect((await tabState(signedIn,page)).rest).toBe(' from our call.');
 await page.keyboard.press('Escape');expect((await tabState(signedIn,page)).showing).toBe(false);
 await expect(page.locator('#ta')).toHaveValue('Thanks for the notes');
 // Tab with nothing showing moves focus as always.
 await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.activeElement?.id)).toBe('in');
});

test('shows the first word quickly: little time on top of the pause and the model',async({page,signedIn,standin})=>{
 standin.script=()=>({text:' and see you tomorrow.',firstMs:0,chunkMs:0});
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ta').click();
 await page.keyboard.type('Sounds good',{delay:15});await ghost(signedIn,page);
 const timings:any[]=await signedIn.evaluate(async()=>{const {recentTimings}=(globalThis as any).gumbo.db;return recentTimings(10);});
 const tab=timings.find(t=>t.surface==='tab');expect(tab).toBeTruthy();
 console.log(`first ghost word ${Math.round(tab.ms)} ms after the last keystroke (120 ms of it the pause), stand-in model at 0 ms`);
 expect(tab.ms).toBeLessThan(120+180);
});

test('never asks in a password field, and not where Gumbo is off',async({page,signedIn,standin})=>{
 standin.script=()=>({text:' secret'});
 await page.goto(`${standin.url}/pages/plain.html`);
 await page.locator('#pw').click();await page.keyboard.type('hunter2 is my',{delay:20});await page.waitForTimeout(500);
 expect(standin.bodies.filter(b=>b.purpose==='tab')).toHaveLength(0);
 await signedIn.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');await chrome.storage.local.set({settings:{...(settings as any),siteOff:['127.0.0.1']}});});
 await page.locator('#ta').click();await page.keyboard.type('Thanks for',{delay:20});await page.waitForTimeout(500);
 expect(standin.bodies.filter(b=>b.purpose==='tab')).toHaveLength(0);
});

test('memory is sealed on disk and feeds the next field: the user\'s own writing becomes the example',async({page,signedIn,standin})=>{
 standin.script=()=>({text:''});
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ce').click();
 const mine='Hey team, quick update: the Lisbon offsite moved to the second week of March. Cheers, Dana';
 await page.keyboard.type(mine);await page.locator('#ta').click();
 // Kept, sealed: the raw database holds no readable text of it.
 await expect.poll(async()=>(await signedIn.evaluate(()=>(globalThis as any).gumbo.db.counts())).writing,{timeout:5000}).toBe(1);
 const raw:string=await signedIn.evaluate(async()=>{
  const names=(await indexedDB.databases()).map(d=>d.name!).filter(n=>n.startsWith('gumbo-memory-'));
  const db:IDBDatabase=await new Promise((ok,no)=>{const r=indexedDB.open(names[0]);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
  const rows:any[]=await new Promise(ok=>{const r=db.transaction('writing').objectStore('writing').getAll();r.onsuccess=()=>ok(r.result);});
  return rows.map(row=>JSON.stringify({...row,box:undefined})+new TextDecoder('latin1').decode(row.box.data)).join('\n');
 });
 expect(raw).not.toContain('Lisbon');expect(raw).not.toContain('127.0.0.1');expect(raw.length).toBeGreaterThan(50);
 // The next comment-like field asks with that writing as an example of the user's voice.
 await page.locator('#rtl').click();await page.keyboard.type('Quick update',{delay:20});
 const second=()=>standin.bodies.find(b=>b.purpose==='tab'&&JSON.stringify(b.messages).includes('Quick update⟨cursor⟩'));
 await expect.poll(()=>!!second(),{timeout:5000}).toBe(true);
 const prompt=JSON.stringify(second().messages);
 expect(prompt).toContain('examples_of_their_own_writing');expect(prompt).toContain('Lisbon offsite');
});

test('every suggestion carries what memory knows, and a fact from memory may be suggested',async({page,signedIn,standin})=>{
 // Read days ago: in memory, not on this page.
 await signedIn.evaluate(()=>(globalThis as any).gumbo.capture({url:'https://notes.example.com/offsite',title:'Offsite plan',text:'The team offsite is at the Lakeview Lodge on Friday. Bring the Q3 roadmap.'}));
 standin.script=b=>b.purpose==='tab'?{text:' Lakeview Lodge on Friday.'}:{text:''};
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ta').click();
 await page.keyboard.type('See you at the team offsite next week at the',{delay:15});
 // The place comes from memory, so the facts guard lets it through (a place nobody mentioned would be cut).
 await expect.poll(async()=>(await tabState(signedIn,page))?.rest,{timeout:8000}).toBe(' Lakeview Lodge on Friday.');
 const prompt=JSON.stringify(standin.bodies.filter(b=>b.purpose==='tab').at(-1).messages);
 expect(prompt).toContain('from_their_memory');expect(prompt).toContain('Bring the Q3 roadmap');
});
