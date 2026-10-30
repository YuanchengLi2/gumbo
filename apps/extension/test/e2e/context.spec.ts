import {test,expect,extensionPage} from '../fixtures';
import type {Page,Frame} from '@playwright/test';
async function card(page:Page):Promise<Frame>{
 await expect.poll(()=>page.frames().some(f=>f.url().includes('card.html')),{timeout:5000}).toBe(true);
 const frame=page.frames().find(f=>f.url().includes('card.html'))!;await frame.locator('#instruction').waitFor();return frame;
}

/** Ctrl+K and the sidebar get their memory from getContext: the profile and the project first, then this session (the
 * page before this one) and the past; Ctrl+K in a field also gets the page it is on. */
test('Ctrl+K in a field is given the page, this session and who they are',async({page,signedIn,standin})=>{
 standin.script=b=>b.purpose==='inline'?{text:'EDIT\nThanks for the notes.'}:{text:''};
 await signedIn.evaluate(()=>chrome.storage.local.set({settings:{enabled:true,pausedUntil:0,siteOff:[],altK:[],facts:{name:'Dana Park',signOff:'Best, Dana'},listen:false,listenOff:[],mic:false}}));
 await page.goto(`${standin.url}/pages/trail.html`);await page.waitForTimeout(800);
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ta').click();
 // The page before is about what they write (the notes on tide pools): this session comes when it bears on the moment,
 // not whatever page came before (memory/context.ts, the relevance bar of Oct 30).
 await page.keyboard.type('thx for the notes on the tide pools and the sea stars');await page.keyboard.press('Control+a');await page.keyboard.press('Control+k');
 await card(page);await page.keyboard.type('more formal');await page.keyboard.press('Enter');
 await expect.poll(()=>standin.bodies.filter((b:any)=>b.purpose==='inline').length,{timeout:8000}).toBeGreaterThan(0);
 const sent=JSON.stringify(standin.bodies.find((b:any)=>b.purpose==='inline').messages);
 expect(sent).toContain('<about_them>');expect(sent).toContain('Dana Park');
 // The page it is on, though the cursor is in a field.
 expect(sent).toContain('<page_text>');expect(sent).toContain('Plain fields');
 // This session: where they were just before.
 expect(sent).toContain('<this_session>');expect(sent).toContain('tide pools');
});
import {memory} from '../fixtures/memory';
/** One context for every surface: getContext gives the profile and project first, then this session and the past,
 * ranked, and for Tab it is put together in well under 50 ms (its search is kept per field and refreshed behind it). */
test('getContext ranks the session and the past, fast enough for Tab',async({signedIn,page,standin})=>{
 const pages=memory.filter(d=>d.kind==='page').slice(0,8);
 await signedIn.evaluate(async pages=>{const g=(globalThis as any).gumbo;for(const p of pages)await g.capture({url:p.url,title:p.title,text:p.text});},pages.map(p=>({url:p.url,title:p.title,text:p.text})));
 // The page before is read as a person reads it (a few seconds on it): memory keeps what was on screen, not a glance.
 await page.goto(`${standin.url}/pages/trail.html`);await page.waitForTimeout(3500);
 await page.goto(`${standin.url}/pages/plain.html`);
 const ask=(query:string)=>signedIn.evaluate(async query=>{
  const [tab]=await chrome.tabs.query({url:'*://*/pages/plain.html'});
  return (globalThis as any).gumbo.memory.context({surface:'tab-text',tab:tab.id,url:tab.url,query,field:{intent:'email',label:'Notes'},budget:1500,key:'test-field'});
 },query);
 const query=`${pages[0].title} ${pages[0].text.slice(0,120)}`;
 // The first ask starts the search; once it is in, an ask is answered from it at once.
 await expect.poll(async()=>(await ask(query)).items.some((i:any)=>i.layer==='past'&&i.url===pages[0].url),{timeout:60_000,intervals:[500]}).toBe(true);
 const times:number[]=[];for(let i=0;i<5;i++)times.push((await ask(query)).ms);
 times.sort((a,b)=>a-b);console.log(`getContext for Tab: ${times.join(', ')} ms`);
 expect(times[2]).toBeLessThan(50);
 const bundle=await ask(query);
 expect(bundle.fresh).toContain('<their_memory>');
 // This session: the page before this one in the tab, its passage that matches when the moment is about it (text Tab
 // takes what matches from the tabs around, never a tab's screen whole).
 const about=await ask('the sea stars that pry mussels open at low tide');
 expect(about.items.some((i:any)=>i.layer==='session'&&i.title.includes('tide pools')),JSON.stringify(about.items.map((i:any)=>[i.layer,i.kind,i.title]))).toBe(true);
 // The debug page shows it, with why.
 const debug=await page.context().newPage();await debug.goto(extensionPage('debug.html'));
 await expect(debug.getByText('tab-text',{exact:false}).first()).toBeVisible({timeout:10_000});
});
