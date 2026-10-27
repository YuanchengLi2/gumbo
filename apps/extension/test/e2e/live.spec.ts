import {test,expect,tell,extensionPage} from '../fixtures';
import {liveLog,liveSpent} from '../standin';
import type {Page,Frame,Worker,BrowserContext} from '@playwright/test';
import {appendFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';

/** Live: Tab, Ctrl+K and the agent with the real model (GUMBO_LIVE=1; it costs money, a few cents a run, and stops at
 * the ledger's cap). Every request goes through the gateway's own code to Anthropic, as it does when deployed; the
 * agent runs on Haiku here (the DeepSeek key lives only on the server). Each scenario is something a person does, with
 * what a mind-reader would offer: what was copied goes into the form that asks for it, a written reply gets sent, the
 * search they were about to run is typed. What each surface did is printed at the end, with its time and cost. */
test.skip(!process.env.GUMBO_LIVE,'Set GUMBO_LIVE=1 to run against the real model (costs money).');
// Every scenario runs even when one before it fails (one worker keeps them in order and shares the results list).
test.describe.configure({timeout:240_000});
const results:string[]=[];
/** Each result also goes to a file: a failed test restarts the worker, and the list with it. */
const resultsFile=process.env.GUMBO_LIVE_RESULTS??resolve(tmpdir(),'gumbo-live-results.txt');
const note=(line:string)=>{results.push(line);appendFileSync(resultsFile,line+'\n');};
test.afterAll(()=>{
 const usd=liveLog.reduce((s,c)=>s+c.usd,0),by=new Map<string,{n:number;usd:number;first:number[]}>();
 for(const c of liveLog){const b=by.get(c.purpose)??{n:0,usd:0,first:[]};b.n++;b.usd+=c.usd;if(c.firstMs!==undefined)b.first.push(c.firstMs);by.set(c.purpose,b);}
 const mid=(a:number[])=>a.length?a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)]:0;
 console.log(`\nLive results:\n${results.join('\n')}\n\nCalls: ${[...by].map(([p,b])=>`${p} ${b.n} ($${b.usd.toFixed(4)}, first token p50 ${mid(b.first)} ms)`).join('; ')}\nThis run: $${usd.toFixed(4)} · all live runs so far: $${liveSpent().toFixed(4)}`);
});
const predict=(w:Worker,p:Page)=>tell(w,p,{type:'debug.predict'});
const setModels=(w:Worker,models:Record<string,string>)=>w.evaluate(m=>chrome.storage.local.get('settings').then(({settings})=>chrome.storage.local.set({settings:{...(settings as any),models:{...(settings as any)?.models,...m}}})),models);
/** Copies words from a page as a person would (select, Ctrl+C). */
async function copy(page:Page,selector:string,words:string){
 await page.bringToFront();
 await page.evaluate(([sel,t])=>{const node=document.querySelector(sel)!.firstChild!,s=node.textContent!,i=s.indexOf(t),r=document.createRange();r.setStart(node,i);r.setEnd(node,i+t.length);getSelection()!.removeAllRanges();getSelection()!.addRange(r);},[selector,words]);
 await page.keyboard.press('Control+c');await page.waitForTimeout(300);
 await page.evaluate(()=>getSelection()?.removeAllRanges());
}
/** Waits for Tab's guess (its whole plan), and how long it took to show from now. */
async function guess(w:Worker,p:Page,ms=15_000):Promise<{state:any;shownMs?:number}>{
 const started=Date.now();let shownMs:number|undefined;
 await expect.poll(async()=>{const s=await predict(w,p).catch(()=>null);if(s?.showing&&shownMs===undefined)shownMs=Date.now()-started;return !!(s?.showing&&s.final);},{timeout:ms,intervals:[150]}).toBe(true).catch(()=>{});
 return{state:await predict(w,p).catch(()=>null),shownMs};
}
const describe=(s:any)=>s?.showing?`“${s.label}” → ${(s.plan?.steps??[]).map((x:any)=>x.do==='type'?`type “${x.text}”`:x.do==='select'?`choose “${x.option}”`:x.do==='key'?`press ${x.combo}`:x.do==='open'?`open ${x.url}`:x.do==='drag'?`drag${x.at?` from ${x.at}`:''}${x.to?` onto ${x.to}`:x.toAt?` to ${x.toAt}`:` by ${x.by}`}`:`${x.do.replace('_','-')}${x.at?` at ${x.at}`:''}`).join(', ')}${s.plan?.then?` · then ${s.plan.then.do}${s.plan.then.name?` “${s.plan.then.name}”`:s.plan.then.combo?` ${s.plan.then.combo}`:''}`:''}`:'nothing offered';
async function card(page:Page):Promise<Frame>{
 await expect.poll(()=>page.frames().some(f=>f.url().includes('card.html')),{timeout:5000}).toBe(true);
 const frame=page.frames().find(f=>f.url().includes('card.html'))!;await frame.locator('#instruction').waitFor();return frame;
}
// What the worker logged, and what was asked of the model, print when a scenario fails.
const logs:string[]=[];
test.beforeEach(({standin,worker})=>{standin.script=()=>({live:true});logs.length=0;worker.on('console',m=>logs.push(`worker ${m.type()}: ${m.text()}`));});
test.afterEach(({standin},info)=>{if(info.status!==info.expectedStatus)console.log(`asked: ${standin.bodies.map((b:any)=>b.purpose).join(', ')}\n${logs.slice(-30).join('\n')}`);});

test('Tab: an address copied in another tab goes into the shipping form',async({page,context,signedIn,standin})=>{
 await page.goto(`${standin.url}/pages/notes.html`);
 await copy(page,'#hotel','3-7-1-2 Nishishinjuku, Shinjuku City, Tokyo');
 const shop=await context.newPage();await shop.goto(`${standin.url}/pages/shipping.html`);await shop.bringToFront();await shop.locator('#street').click();
 const {state,shownMs}=await guess(signedIn,shop);
 note(`  Copied address → shipping form: ${describe(state)}${shownMs!==undefined?` (shown ${shownMs} ms after the click)`:''}${state?.preview?` · previewed “${state.preview}”`:''}`);
 expect(state?.showing).toBe(true);
 expect(JSON.stringify(state.plan.steps)).toContain('Nishishinjuku');
 await shop.keyboard.press('Alt+q');
 await expect.poll(()=>shop.locator('#street').inputValue(),{timeout:8000}).toContain('Nishishinjuku');
 await expect.poll(()=>shop.locator('#city').inputValue(),{timeout:5000}).not.toBe('').catch(()=>{});
 note(`    Tab filled: street “${await shop.locator('#street').inputValue()}”, city “${await shop.locator('#city').inputValue()}”`);
});

test('Tab, asked ahead: the pointer rests on the field, and the click finds the guess ready',async({page,context,signedIn,standin})=>{
 await page.goto(`${standin.url}/pages/notes.html`);
 await copy(page,'#hotel','3-7-1-2 Nishishinjuku, Shinjuku City, Tokyo');
 const shop=await context.newPage();await shop.goto(`${standin.url}/pages/shipping.html`);await shop.bringToFront();
 await shop.waitForTimeout(2500);
 // As a person does: the pointer comes to rest on the field a moment before the click.
 await shop.locator('#street').hover();await shop.waitForTimeout(2500);
 await shop.locator('#street').click();
 const {state,shownMs}=await guess(signedIn,shop);
 note(`  Asked ahead, then clicked: ${describe(state)}${shownMs!==undefined?` (shown ${shownMs} ms after the click)`:''}`);
 expect(state?.showing).toBe(true);
 expect(shownMs??9999).toBeLessThan(600);
});

test('Tab, Tab: after one move, the next is already there',async({page,context,signedIn,standin})=>{
 await page.goto(`${standin.url}/pages/notes.html`);
 await copy(page,'#hotel','3-7-1-2 Nishishinjuku, Shinjuku City, Tokyo');
 const shop=await context.newPage();await shop.goto(`${standin.url}/pages/shipping.html`);await shop.bringToFront();
 await shop.waitForTimeout(2000);await shop.locator('#street').hover();await shop.waitForTimeout(2500);await shop.locator('#street').click();
 const first=await guess(signedIn,shop);
 note(`  Tab, Tab — first: ${describe(first.state)}${first.state?.plan?.then?` · then: ${JSON.stringify(first.state.plan.then)}`:''}`);
 expect(first.state?.showing).toBe(true);
 const pressed=Date.now();await shop.keyboard.press('Alt+q');
 let nextMs:number|undefined;
 await expect.poll(async()=>{const s=await predict(signedIn,shop);if(s?.showing&&nextMs===undefined&&JSON.stringify(s.plan?.steps)!==JSON.stringify(first.state.plan.steps))nextMs=Date.now()-pressed;return nextMs!==undefined;},{timeout:8000,intervals:[50]}).toBe(true).catch(()=>{});
 const next=await predict(signedIn,shop);
 note(`    then, ${nextMs!==undefined?`${nextMs} ms after Tab`:'nothing'}: ${describe(next)}${next?.source?` (${next.source})`:''}`);
 expect(nextMs??9999).toBeLessThan(1500);
});

test('Studying: an assistant chat in one tab, the course\'s quiz in a frame in the other; nothing copied',async({page,context,signedIn,standin})=>{
 await page.goto(`${standin.url}/pages/chat.html`);await page.bringToFront();await page.waitForTimeout(1500);
 const lesson=await context.newPage();await lesson.goto(`${standin.url}/pages/lesson.html`);await lesson.bringToFront();await lesson.waitForTimeout(1500);
 const activity=lesson.frameLocator('#activity');
 await activity.locator('#answer').hover();await lesson.waitForTimeout(2000);await activity.locator('#answer').click();
 const {state,shownMs}=await guess(signedIn,lesson,12_000);
 note(`  Studying, quiz in a frame, after reading the answer in the chat tab: ${describe(state)}${shownMs!==undefined?` (${shownMs} ms after the click)`:''}`);
 expect(state?.showing).toBe(true);
 await lesson.keyboard.press('Alt+q');
 await expect.poll(()=>activity.locator('#answer').inputValue(),{timeout:6000}).not.toBe('');
 note(`    Tab typed: “${await activity.locator('#answer').inputValue()}”`);
 const next=await guess(signedIn,lesson,3000);
 note(`    next: ${describe(next.state)}`);
});

test('Tab, cold: a field clicked a moment after the page opens, no resting on it first',async({page,context,signedIn,standin})=>{
 await page.goto(`${standin.url}/pages/notes.html`);
 await copy(page,'#hotel','3-7-1-2 Nishishinjuku, Shinjuku City, Tokyo');
 const shop=await context.newPage();await shop.goto(`${standin.url}/pages/shipping.html`);await shop.bringToFront();
 await shop.waitForTimeout(3000);
 await shop.locator('#street').click();
 const {state,shownMs}=await guess(signedIn,shop);
 note(`  Cold click 3 s after the page opened: ${describe(state)}${shownMs!==undefined?` (shown ${shownMs} ms after the click)`:''} · ${state?.outlined??0} outlined, previews ${JSON.stringify(state?.previews??[])}`);
 expect(state?.showing).toBe(true);
});

test('Memory: a page read earlier (its tab since closed) is what Tab and Ctrl+K draw on',async({page,context,signedIn,standin})=>{
 const notes=await context.newPage();await notes.goto(`${standin.url}/pages/notes.html`);await notes.bringToFront();await notes.waitForTimeout(4000);
 await notes.close();
 await expect.poll(()=>signedIn.evaluate(()=>(globalThis as any).gumbo.db.recent('pages',10).then((p:any[])=>p.some(x=>x.title==='Trip notes'))),{timeout:15_000}).toBe(true);
 await page.goto(`${standin.url}/pages/checkin.html`);await page.bringToFront();await page.waitForTimeout(2500);
 await page.locator('#flight').hover();await page.waitForTimeout(1500);await page.locator('#flight').click();
 const {state,shownMs}=await guess(signedIn,page,12_000);
 note(`  Check-in form, trip notes read earlier and closed: ${describe(state)}${shownMs!==undefined?` (${shownMs} ms)`:''} · previews ${JSON.stringify(state?.previews??[])}`);
 // Ctrl+K on the same page, nothing selected: a question only memory can answer.
 await page.keyboard.press('Escape');await page.locator('h1').click();await page.evaluate(()=>getSelection()?.removeAllRanges());
 const started=Date.now();await page.keyboard.press('Control+k');const frame=await card(page);
 await page.keyboard.type('when does my flight leave?');await page.keyboard.press('Enter');
 let firstMs:number|undefined;
 await expect.poll(async()=>{const t=((await frame.locator('.body').textContent().catch(()=>''))??'').trim();if(t&&firstMs===undefined&&!/Thinking/.test(t))firstMs=Date.now()-started;return /November|Nov|11:05/i.test(t);},{timeout:20_000,intervals:[100]}).toBe(true).catch(()=>{});
 const answer=((await frame.locator('.body').textContent())??'').replace(/\s+/g,' ').trim();
 note(`  Ctrl+K “when does my flight leave?” (first words ${firstMs??'?'} ms after Ctrl+K): ${answer.slice(0,200)}`);
 expect(answer).toMatch(/November 12|Nov(ember)? 12/i);
});

test('Tab, first second: a field clicked half a second after the page opens',async({page,context,signedIn,standin})=>{
 await page.goto(`${standin.url}/pages/notes.html`);
 await copy(page,'#hotel','3-7-1-2 Nishishinjuku, Shinjuku City, Tokyo');
 const shop=await context.newPage();await shop.goto(`${standin.url}/pages/shipping.html`);await shop.bringToFront();
 await shop.waitForTimeout(500);await shop.locator('#street').click();
 const {state,shownMs}=await guess(signedIn,shop);
 note(`  Click 0.5 s after the page opened: ${describe(state)}${shownMs!==undefined?` (shown ${shownMs} ms after the click)`:''}`);
 expect(state?.showing).toBe(true);
});

test('A page drawn as pixels: Tab reads the picture and points at the drawn search box with what was copied',async({page,context,signedIn,standin})=>{
 await page.goto(`${standin.url}/pages/notes.html`);await copy(page,'#food','best ramen in Shinjuku');
 const board=await context.newPage();await board.goto(`${standin.url}/pages/sketch.html`);await board.bringToFront();await board.waitForTimeout(2500);
 await board.mouse.click(1000,600);
 const {state,shownMs}=await guess(signedIn,board,12_000);
 note(`  Drawn board, after copying “best ramen in Shinjuku”: ${describe(state)}${state?.plan?.steps?.[0]?.at?` at ${state.plan.steps[0].at}`:''}${shownMs!==undefined?` (${shownMs} ms)`:''}`);
 if(state?.showing){await board.keyboard.press('Alt+q');await board.waitForTimeout(1200);note(`    after Tab: search box “${await board.locator('#find').inputValue()}”, status “${await board.locator('#status').textContent()}”`);}
 // Then: the user picks a note by hand; what comes next?
 await board.mouse.click(160,130);
 const after=await guess(signedIn,board,12_000);
 note(`    after selecting “Write tests” by hand: ${describe(after.state)}${after.state?.plan?.steps?.[0]?.at?` at ${after.state.plan.steps[0].at}${after.state.plan.steps[0].toAt?` → ${after.state.plan.steps[0].toAt}`:''}`:''}`);
 if(after.state?.showing){await board.keyboard.press('Alt+q');await board.waitForTimeout(1200);note(`    after Tab: status “${await board.locator('#status').textContent()}”`);}
});

test('A real drawing app (Excalidraw): what Tab and Ctrl+K make of it',async({page,signedIn})=>{
 try{await page.goto('https://excalidraw.com/',{waitUntil:'domcontentloaded',timeout:30_000});}catch{note('  Excalidraw: unreachable');return;}
 await page.waitForTimeout(5000);await page.mouse.click(700,450);
 const {state}=await guess(signedIn,page,10_000);
 note(`  Excalidraw (blank canvas): ${describe(state)}`);
 await page.keyboard.press('Escape');await page.keyboard.press('Control+k');
 const frame=await card(page).catch(()=>null);
 if(frame){await page.keyboard.type('what can I do here?');await page.keyboard.press('Enter');await page.waitForTimeout(6000);note(`  Ctrl+K on Excalidraw: ${((await frame.locator('.body').textContent())??'').replace(/\s+/g,' ').slice(0,180)}`);}
});

/** What the model was shown for the last Ctrl+K (its picture, its words), kept beside the screenshots. */
const seen=(standin:{bodies:any[]},name:string,purpose='inline')=>{
 const dir=process.env.GUMBO_SHOTS,b=standin.bodies.filter(x=>x.purpose===purpose).at(-1);if(!dir||!b)return;
 for(const c of b.messages[0].content)if(c.type==='image')writeFileSync(`${dir}/${name}.jpg`,Buffer.from(c.source.data,'base64'));
 writeFileSync(`${dir}/${name}.txt`,b.messages[0].content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n----\n'));
};
/** Screenshots of the real-app checks, when GUMBO_SHOTS names a folder for them. */
const shot=async(page:Page,name:string)=>{if(process.env.GUMBO_SHOTS)await page.screenshot({path:`${process.env.GUMBO_SHOTS}/${name}.png`}).catch(()=>{});};
/** How much of the view canvases cover (what makes a page "drawn" for Tab and Ctrl+K). */
const canvasCover=(page:Page)=>page.evaluate(()=>{let c=0;for(const el of document.querySelectorAll('canvas')){const r=el.getBoundingClientRect();c+=Math.max(0,Math.min(r.right,innerWidth)-Math.max(r.left,0))*Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0));}return Math.round(100*c/(innerWidth*innerHeight));}).catch(()=>-1);
/** Ctrl+K with a question; what the card answered (or that it never opened). */
async function cardAnswer(page:Page,question:string,ms=9000){
 await page.keyboard.press('Control+k');
 const frame=await card(page).catch(()=>null);if(!frame)return '(the card did not open)';
 await page.keyboard.type(question);await page.keyboard.press('Enter');
 await expect.poll(async()=>((await frame.locator('.body').textContent().catch(()=>''))??'').length,{timeout:ms}).toBeGreaterThan(80).catch(()=>{});
 await page.waitForTimeout(2500);
 const text=((await frame.locator('.body').textContent().catch(()=>''))??'').replace(/\s+/g,' ').slice(0,260);
 await page.keyboard.press('Escape');return text||'(no answer)';
}

test('Google Docs, a public design doc (view only): what Tab and Ctrl+K make of it',async({page,signedIn,standin})=>{
 try{await page.goto('https://docs.google.com/document/d/1Iqe_CzFVA6hyxe7h2bUKusxsjB6frXfdAYLerM3JjPo/edit',{waitUntil:'domcontentloaded',timeout:30_000});}catch{note('  Docs: unreachable');return;}
 await page.waitForTimeout(7000);await shot(page,'docs');
 note(`  Docs: canvases cover ${await canvasCover(page)}% of the view; title “${await page.title()}”`);
 await page.mouse.click(640,420);
 const {state}=await guess(signedIn,page,10_000);
 note(`  Docs, after a click in the text: ${describe(state)}${state?.plan?.steps?.[0]?.at?` at ${state.plan.steps[0].at}`:''}`);
 await page.keyboard.press('Escape');
 note(`  Ctrl+K, nothing selected, “what is this doc about?”: ${await cardAnswer(page,'what is this doc about, in two sentences?')}`);
 // A word selected the way a person does it (double-click), then Ctrl+K.
 await page.mouse.dblclick(400,420);await page.waitForTimeout(500);
 note(`  Ctrl+K on a double-clicked word, “explain this”: ${await cardAnswer(page,'explain this')}`);
 seen(standin,'docs-asked');
});

test('Tab for text in a document drawn as pixels (as Google Docs draws its text): the words are read from a picture',async({page,signedIn,standin})=>{
 await page.goto(`${standin.url}/pages/drawn-doc.html`);await page.waitForTimeout(1000);
 // The caret after “First, we” on the third line, then a few words typed as a person types them.
 await page.mouse.click(195,235);await page.waitForTimeout(200);
 await page.keyboard.type(' will open the beta to',{delay:45});
 const typed=Date.now();let shownMs:number|undefined;
 await expect.poll(async()=>{const s=await tell(signedIn,page,{type:'debug.drawn'}).catch(()=>null);if(s?.shown&&shownMs===undefined)shownMs=Date.now()-typed;return !!s?.shown;},{timeout:10_000,intervals:[100]}).toBe(true).catch(()=>{});
 const s=await tell(signedIn,page,{type:'debug.drawn'}).catch(()=>null);
 note(`  Drawn document, “First, we will open the beta to”: ${s?.shown?`offered “${s.shown}” (${shownMs} ms after the last key, 650 of them the pause)`:'nothing offered'}`);
 seen(standin,'drawn-tab','tab');
 if(s?.shown){await page.keyboard.press('Alt+q');await page.waitForTimeout(400);note(`    after Tab: ${await page.locator('#status').textContent()}`);}
});

test('Figma, a public prototype: what Tab and Ctrl+K make of it',async({page,signedIn})=>{
 try{await page.goto('https://www.figma.com/proto/NI8q8DJRvFhfevXhtYfOBL/%E7%84%A1%E9%A1%8C?type=design&node-id=3-2&scaling=contain&page-id=0%3A1&starting-point-node-id=3%3A2',{waitUntil:'domcontentloaded',timeout:30_000});}catch{note('  Figma: unreachable');return;}
 await page.waitForTimeout(9000);await shot(page,'figma');
 note(`  Figma: canvases cover ${await canvasCover(page)}% of the view; title “${await page.title()}”`);
 await page.mouse.click(640,400);
 const {state}=await guess(signedIn,page,12_000);
 note(`  Figma, after a click on the design: ${describe(state)}${state?.plan?.steps?.[0]?.at?` at ${state.plan.steps[0].at}`:''}`);
 await page.keyboard.press('Escape');
 note(`  Ctrl+K, “what does this screen show?”: ${await cardAnswer(page,'what does this screen show?')}`);
});

test('Tab on a board, after the user dragged a card by hand',async({page,signedIn,standin})=>{
 await page.goto(`${standin.url}/pages/board.html`);await page.waitForTimeout(1500);
 await page.locator('#c1').dragTo(page.locator('#done'));
 await expect(page.locator('#status')).toHaveText('Moved Write tests to Done');
 const {state,shownMs}=await guess(signedIn,page,12_000);
 note(`  Board, after dragging “Write tests” to Done by hand: ${describe(state)}${shownMs!==undefined?` (${shownMs} ms)`:''}`);
 if(state?.showing){await page.keyboard.press('Alt+q');await page.waitForTimeout(1200);note(`    after Tab: ${await page.locator('#status').textContent()}`);}
});

test('Tab: a reply that is written gets sent, the send waiting for Enter',async({page,signedIn,standin})=>{
 await page.goto(`${standin.url}/pages/forms.html`);await page.locator('#msg').click();
 // At a person's speed (about 12 keys a second).
 await page.keyboard.type('Yes, I will be there on Friday!',{delay:85});
 const {state,shownMs}=await guess(signedIn,page);
 note(`  Reply written → ${describe(state)}${shownMs!==undefined?` (shown ${shownMs} ms after the pause)`:''}`);
 expect(state?.showing).toBe(true);
 await page.keyboard.press('Alt+q');
 await expect.poll(async()=>(await predict(signedIn,page))?.waiting,{timeout:8000}).toBe(true);
 expect(await page.locator('#status').textContent()).toBe('');
 await page.keyboard.press('Enter');
 await expect(page.locator('#status')).toHaveText('Sent: Yes, I will be there on Friday!');
});

test('Tab: the search they were about to run, on Google, from what they copied',async({page,context,signedIn,standin})=>{
 await page.goto(`${standin.url}/pages/notes.html`);await copy(page,'#food','best ramen in Shinjuku');
 const google=await context.newPage();
 try{await google.goto('https://www.google.com/',{waitUntil:'domcontentloaded',timeout:30_000});}catch{note('  Google: unreachable');return;}
 await google.bringToFront();await google.waitForTimeout(1500);await google.locator('textarea[name=q]').first().click().catch(()=>{});
 const {state,shownMs}=await guess(signedIn,google);
 note(`  Google, after copying “best ramen in Shinjuku”: ${describe(state)}${shownMs!==undefined?` (${shownMs} ms)`:''}`);
 expect(state?.showing).toBe(true);expect(JSON.stringify(state.plan.steps).toLowerCase()).toContain('ramen');
});

test('Tab: a post written in a composer gets Post',async({page,signedIn,standin})=>{
 await page.goto(`${standin.url}/pages/post.html`);await page.waitForTimeout(1500);
 await page.locator('[role=textbox]').click();
 await page.keyboard.type('Just finished my first marathon. Legs are gone but so worth it.',{delay:35});
 const {state,shownMs}=await guess(signedIn,page,10_000);
 note(`  Post written in a composer: ${describe(state)}${shownMs!==undefined&&state?.showing?` (shown ${shownMs} ms after the last key)`:''}`);
 if(state?.showing){await page.keyboard.press('Alt+q');await page.waitForTimeout(800);await page.keyboard.press('Enter');await page.waitForTimeout(800);note(`    after Alt+Q (and Enter for a final step): ${await page.locator('#status').textContent()}`);}
});

test('Redesigned Tab on YouTube and GitHub: nothing as pages open, then the next part of what the user starts',async({page,signedIn})=>{
 test.setTimeout(180_000);
 const step=async(what:string,ms=9000)=>{const {state,shownMs}=await guess(signedIn,page,ms);note(`  ${what}: ${describe(state)}${shownMs!==undefined&&state?.showing?` (${shownMs} ms)`:''}`);return state;};
 try{await page.goto('https://www.youtube.com/',{waitUntil:'domcontentloaded',timeout:30_000});}catch{note('  YouTube: unreachable');return;}
 await page.waitForTimeout(4000);
 await step('YouTube, the page open, nothing done',3000);
 await page.locator('input[name=search_query]').first().click({timeout:8000}).catch(()=>{});
 await step('YouTube, clicked into the search box',4000);
 await page.keyboard.type('lofi hip hop radio',{delay:70});
 const yt=await step('YouTube, typed “lofi hip hop radio” and paused');
 if(yt?.showing){await page.keyboard.press('Alt+q');await page.waitForTimeout(2500);note(`    after Alt+Q: ${page.url().slice(0,90)}`);}
 try{await page.goto('https://github.com/microsoft/vscode/issues',{waitUntil:'domcontentloaded',timeout:30_000});}catch{note('  GitHub: unreachable');return;}
 await page.waitForTimeout(4000);
 await step('GitHub issues, the page open, nothing done',3000);
 const box=page.locator('input[aria-label*="Search" i], input#repository-input, input[placeholder*="Search" i]').first();
 await box.click({timeout:8000}).catch(()=>note('    (no search box found)'));
 await page.keyboard.press('Control+a');await page.keyboard.type('is:open label:bug terminal',{delay:60});
 const gh=await step('GitHub issues, typed a filter and paused');
 if(gh?.showing){await page.keyboard.press('Alt+q');await page.waitForTimeout(2500);note(`    after Alt+Q: ${page.url().slice(0,110)}`);}
});

test('Tab on real pages with nothing copied: what it offers (or rightly nothing)',async({page,signedIn})=>{
 for(const [name,url] of [['Wikipedia: Tea','https://en.wikipedia.org/wiki/Tea'],['GitHub: vscode','https://github.com/microsoft/vscode'],['Hacker News','https://news.ycombinator.com/'],['MDN: JavaScript','https://developer.mozilla.org/en-US/docs/Web/JavaScript']]){
  try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:30_000});}catch{note(`  ${name}: unreachable`);continue;}
  const {state,shownMs}=await guess(signedIn,page,9000);
  note(`  ${name} (just opened): ${describe(state)}${shownMs!==undefined?` (${shownMs} ms)`:''}`);
 }
});

test('Ctrl+K: explains a selection on a real page, from the page',async({page,signedIn})=>{
 void signedIn;
 try{await page.goto('https://en.wikipedia.org/wiki/Tea',{waitUntil:'domcontentloaded',timeout:30_000});}catch{note('  Ctrl+K on Wikipedia: unreachable');return;}
 await page.evaluate(()=>{const p=[...document.querySelectorAll('#mw-content-text p')].find(p=>(p.textContent??'').trim().length>120)!;const r=document.createRange();r.selectNodeContents(p);getSelection()!.removeAllRanges();getSelection()!.addRange(r);});
 const started=Date.now();await page.keyboard.press('Control+k');const frame=await card(page);
 await page.keyboard.type('explain this simply');const asked=Date.now();await page.keyboard.press('Enter');
 let firstMs:number|undefined;
 await expect.poll(async()=>{const t=((await frame.locator('.body').textContent().catch(()=>''))??'').trim();if(t.length>12&&!/Thinking/.test(t)&&firstMs===undefined)firstMs=Date.now()-asked;return firstMs!==undefined;},{timeout:15_000,intervals:[50]}).toBe(true).catch(()=>{});
 note(`  Ctrl+K “explain this simply”: first words ${firstMs??'?'} ms after Enter`);
 await expect.poll(async()=>((await frame.locator('.body').textContent().catch(()=>''))??'').length,{timeout:20_000}).toBeGreaterThan(60).catch(async e=>{note(`  Ctrl+K on Wikipedia showed: “${await frame.locator('#card').innerText().catch(()=>'')}”`);throw e;});
 await page.waitForTimeout(2500);
 const answer=((await frame.locator('.body').textContent())??'').replace(/\s+/g,' ').trim();
 note(`  Ctrl+K “explain this simply” on Wikipedia (${Date.now()-started} ms to a full answer): ${answer.slice(0,220)}${answer.length>220?'…':''}`);
 expect(answer.toLowerCase()).toContain('tea');
});

test('Ctrl+K: rewrites a rough message, Enter keeps it',async({page,signedIn,standin})=>{
 void signedIn;await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ta').click();
 await page.keyboard.type('hey can u send me the file tmrw');await page.keyboard.press('Control+a');await page.keyboard.press('Control+k');
 const frame=await card(page);await page.keyboard.type('more formal');await page.keyboard.press('Enter');
 await expect(frame.locator('ins').first()).toBeVisible({timeout:20_000});
 await page.waitForTimeout(1500);await page.keyboard.press('Enter');
 const value=await page.locator('#ta').inputValue();
 note(`  Ctrl+K “more formal”: “${value}”`);
 expect(value.toLowerCase()).toContain('tomorrow');
});

test('Ctrl+K: opens with what they most likely want',async({page,signedIn,standin})=>{
 void signedIn;await page.goto(`${standin.url}/pages/forms.html`);
 await page.locator('#meeting').selectText();await page.keyboard.press('Control+k');
 const frame=await card(page);await page.waitForTimeout(6000);
 const ideas=(await frame.locator('.idea').allTextContents()).map(t=>t.replace(/^\W+/,'').trim());
 note(`  Ctrl+K ideas for “${'The offsite is on Friday, November 6 at 10 AM at 410 Lakeview Drive.'}”: ${ideas.join(' · ')||'none'}`);
 expect(ideas.length).toBeGreaterThan(0);
});

test('Tab for text: the next words',async({page,signedIn,standin})=>{
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ta').click();
 await page.keyboard.type('Thanks for sending the deck over. I',{delay:30});await page.keyboard.type("'ll",{delay:30});
 await expect.poll(async()=>(await tell(signedIn,page,{type:'debug.tab'}))?.showing,{timeout:8000}).toBe(true).catch(()=>{});
 const s=await tell(signedIn,page,{type:'debug.tab'});
 note(`  Tab for text after “Thanks for sending the deck over. I'll”: ${s?.showing?`“${s.rest}”`:'nothing'}`);
});

async function panelFor(context:BrowserContext){const panel=await context.newPage();await panel.goto(extensionPage('sidepanel.html'));return panel;}
const ask=async(panel:Page,text:string)=>{const box=panel.getByPlaceholder(/Ask, or tell Gumbo|Add to the queue/);await box.fill(text);await box.press('Enter');};

test('Agent: knows the open tabs and what was closed; switches to one, brings one back',async({page,context,signedIn})=>{
 await setModels(signedIn,{agent:'claude-haiku-5-5'});
 const tabs:Page[]=[];
 for(const url of ['https://en.wikipedia.org/wiki/Tea','https://github.com/microsoft/vscode']){const t=await context.newPage();await t.goto(url,{waitUntil:'domcontentloaded',timeout:30_000}).catch(()=>{});tabs.push(t);}
 const hn=await context.newPage();await hn.goto('https://news.ycombinator.com/',{waitUntil:'domcontentloaded',timeout:30_000}).catch(()=>{});await hn.waitForTimeout(800);await hn.close();
 await page.goto('about:blank');
 const panel=await panelFor(context);await tabs[1].bringToFront();
 await ask(panel,'Which of my open tabs is about a drink? Switch to it.');
 await expect(panel.locator('.foot').last()).toContainText(/Worked for|Done|steps/,{timeout:90_000}).catch(()=>{});
 const active=await signedIn.evaluate(()=>chrome.tabs.query({active:true,lastFocusedWindow:true}).then(([t])=>t?.url??''));
 const said1=((await panel.locator('.turns').innerText().catch(()=>''))??'').replace(/\s+/g,' ').trim().slice(-220);
 note(`  Agent “which tab is about a drink? switch to it” → now on ${active} · said: ${said1.slice(0,160)}`);
 expect(active).toContain('wiki/Tea');
 await ask(panel,'Bring back the Hacker News tab I closed.');
 await expect.poll(()=>context.pages().some(p=>p.url().includes('news.ycombinator.com')),{timeout:90_000}).toBe(true);
 note('  Agent “bring back the Hacker News tab I closed” → reopened');
 // What is in a tab, read without going there.
 const before=await signedIn.evaluate(()=>chrome.tabs.query({active:true,lastFocusedWindow:true}).then(([t])=>t?.url??''));
 await ask(panel,'Without switching tabs: what is the project in my GitHub tab, in one sentence?');
 await expect.poll(async()=>((await panel.locator('.turns').innerText())??'').match(/Worked for/g)?.length??0,{timeout:90_000}).toBeGreaterThanOrEqual(3).catch(()=>{});
 const said3=((await panel.locator('.turns').innerText())??'').replace(/\s+/g,' ').trim().slice(-260);
 const after=await signedIn.evaluate(()=>chrome.tabs.query({active:true,lastFocusedWindow:true}).then(([t])=>t?.url??''));
 note(`  Agent “what is the project in my GitHub tab?” (stayed on the same tab: ${before===after}) · said: ${said3}`);
 expect(said3.toLowerCase()).toMatch(/visual studio code|vs ?code|code editor/);
});

test('Agent: does a task in the page from start to the final step, which waits for a yes',async({page,context,signedIn,standin})=>{
 await setModels(signedIn,{agent:'claude-haiku-5-5'});
 await page.goto(`${standin.url}/pages/agent.html`);
 const panel=await panelFor(context);await page.bringToFront();
 await ask(panel,"Reply to Dana that I'll be there, and send it.");
 await expect(panel.locator('.confirm')).toBeVisible({timeout:90_000});
 const typed=await page.locator('#message').inputValue();
 await panel.getByRole('button',{name:/Allow/}).click();
 await expect(page.locator('#status')).toContainText('Sent:',{timeout:30_000});
 note(`  Agent reply-and-send: typed “${typed}”, sent after the user allowed it`);
});
