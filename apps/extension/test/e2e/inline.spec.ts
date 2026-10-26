import {test,expect} from '../fixtures';
import type {Page,Frame} from '@playwright/test';

/** Ctrl+K end to end against the stand-in gateway: edit (kept with Enter, undone with Ctrl+Z), Esc leaves the page as it
 * was, answers from memory with their sources, actions, rich text keeping its formatting, writing into an empty field,
 * and the card's keystrokes never reaching the page. */
async function card(page:Page):Promise<Frame>{
 await expect.poll(()=>page.frames().some(f=>f.url().includes('card.html')),{timeout:5000}).toBe(true);
 const frame=page.frames().find(f=>f.url().includes('card.html'))!;await frame.locator('#instruction').waitFor();return frame;
}
const inlineBodies=(standin:any)=>standin.bodies.filter((b:any)=>b.purpose==='inline');
// A failed test prints what the worker and the page logged, and what the stand-in was asked.
const logs:string[]=[];
test.beforeEach(({worker,page})=>{logs.length=0;worker.on('console',m=>logs.push(`worker ${m.type()}: ${m.text()}`));page.on('console',m=>logs.push(`page ${m.type()}: ${m.text()}`));page.on('pageerror',e=>logs.push(`page error: ${e.message}`));});
test.afterEach(async({standin},info)=>{if(info.status!==info.expectedStatus)console.log(`asked: ${standin.bodies.map((b:any)=>b.purpose).join(', ')}\n${logs.slice(-40).join('\n')}`);});

test('edits a selection: the diff streams in the card, Enter replaces it, Ctrl+Z takes it back',async({page,signedIn,standin})=>{
 standin.script=b=>b.purpose==='inline'?{text:'EDIT\nCould you please send me the file tomorrow?',chunkMs:15}:{text:''};
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ta').click();
 await page.keyboard.type('hey can u send me the file tmrw');await page.keyboard.press('Control+a');
 await page.keyboard.press('Control+k');
 const frame=await card(page);
 // The cache is warmed as the card opens.
 await expect.poll(()=>standin.bodies.some((b:any)=>b.purpose==='prewarm'&&JSON.stringify(b.messages).includes('hey can u send me the file tmrw'))).toBe(true);
 await page.keyboard.type('more formal');await page.keyboard.press('Enter');
 await expect(frame.locator('ins').first()).toContainText('Could you please');await expect(frame.locator('del').first()).toBeVisible();
 const body=inlineBodies(standin)[0];expect(JSON.stringify(body.messages)).toContain('more formal');expect(JSON.stringify(body.messages)).toContain('<selection>');
 await page.keyboard.press('Enter');
 await expect(page.locator('#ta')).toHaveValue('Could you please send me the file tomorrow?');
 await expect.poll(()=>page.frames().some(f=>f.url().includes('card.html'))).toBe(false);
 await page.keyboard.press('Control+z');await expect(page.locator('#ta')).toHaveValue('hey can u send me the file tmrw');
});

test('Esc leaves the page exactly as it was, with the selection back',async({page,signedIn,standin})=>{
 standin.script=b=>b.purpose==='inline'?{text:'EDIT\nSomething else entirely.'}:{text:''};
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ta').click();
 await page.keyboard.type('Keep this text.');await page.keyboard.press('Control+a');await page.keyboard.press('Control+k');
 const frame=await card(page);await page.keyboard.type('rewrite');await page.keyboard.press('Enter');
 await expect(frame.locator('ins')).toBeVisible();await page.keyboard.press('Escape');
 await expect(page.locator('#ta')).toHaveValue('Keep this text.');
 expect(await page.evaluate(()=>{const t=document.activeElement as HTMLTextAreaElement;return [t.id,t.selectionStart,t.selectionEnd];})).toEqual(['ta',0,15]);
});

test('answers from memory, with the page it came from as a link',async({page,signedIn,standin,context})=>{
 standin.script=b=>b.purpose==='inline'?{text:'ANSWER\nYou read that Groq serves Llama with a first token in about 150 ms [1].'}:{text:''};
 // A page read earlier, kept in memory.
 await signedIn.evaluate(async()=>{
  const g=(globalThis as any).gumbo;await g.capture({url:'https://example.com/groq-latency',title:'Why Groq is fast',text:'Groq serves Llama models from its own chips; the first token usually arrives in about 150 ms, far below GPU clouds.'});
 });
 await page.goto(`${standin.url}/pages/shortcuts.html`);
 await page.locator('#lunch').selectText();await page.keyboard.press('Control+k');
 const frame=await card(page);await page.keyboard.type('where did I read about groq latency?');await page.keyboard.press('Enter');
 await expect(frame.locator('.body')).toContainText('first token in about 150 ms');
 await expect(frame.locator('.sources a')).toHaveAttribute('href','https://example.com/groq-latency');
 expect(JSON.stringify(inlineBodies(standin).at(-1).messages)).toContain('far below GPU clouds');
});

test('acts on a selection: a prefilled calendar event opens on Enter',async({page,signedIn,standin})=>{
 standin.script=b=>b.purpose==='inline'?{text:'ACT\n{"do":"calendar","title":"Lunch with Sam","start":"2026-10-30T12:30","location":"Tartine"}'}:{text:''};
 await page.goto(`${standin.url}/pages/shortcuts.html`);
 await page.locator('#lunch').selectText();await page.keyboard.press('Control+k');
 const frame=await card(page);await page.keyboard.type('add to calendar');await page.keyboard.press('Enter');
 await expect(frame.locator('.action')).toContainText('Add to Google Calendar: Lunch with Sam');
 // The link the extension opens, as it asks Chrome to open it (the page itself would go to Google).
 await signedIn.evaluate(()=>{const g=globalThis as any;g.opened=[];const create=chrome.tabs.create.bind(chrome.tabs);(chrome.tabs as any).create=(p:any)=>{g.opened.push(p.url);return create({...p,url:'about:blank'});};});
 await page.keyboard.press('Enter');
 await expect.poll(()=>signedIn.evaluate(()=>(globalThis as any).opened.length)).toBe(1);
 const url=new URL(await signedIn.evaluate(()=>(globalThis as any).opened[0]));
 expect(url.searchParams.get('text')).toBe('Lunch with Sam');expect(url.searchParams.get('dates')).toBe('20261030T123000/20261030T133000');expect(url.searchParams.get('location')).toBe('Tartine');
 // The page's own shortcuts never saw what was typed in the card.
 expect((await page.evaluate(()=>(window as any).pressed as string[])).filter(k=>k.length===1)).toEqual([]);
});

test('keeps bold text bold through a rewrite in a rich editor',async({page,signedIn,standin})=>{
 standin.script=b=>b.purpose==='inline'?{text:'EDIT\nShip the **beta** on Friday.'}:{text:''};
 await page.goto(`${standin.url}/pages/build/tiptap.html`);
 await page.evaluate(()=>(window as any).editor.commands.setContent('<p>We should really ship the <strong>beta</strong> this Friday if we can.</p>'));
 await page.locator('.ProseMirror').click();await page.keyboard.press('Control+a');await page.keyboard.press('Control+k');
 await card(page);await page.keyboard.type('shorter');await page.keyboard.press('Enter');
 const frame=await card(page);await expect(frame.locator('ins').first()).toBeVisible();
 expect(JSON.stringify(inlineBodies(standin)[0].messages)).toContain('**beta**');
 await page.keyboard.press('Enter');
 await expect(page.locator('.ProseMirror')).toHaveText('Ship the beta on Friday.');
 await expect(page.locator('.ProseMirror strong')).toHaveText('beta');
});

test('writes into an empty field from an instruction',async({page,signedIn,standin})=>{
 standin.script=b=>b.purpose==='inline'?{text:"EDIT\nThanks for the invite! Unfortunately I can't make it on Friday."}:{text:''};
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ce').click();await page.keyboard.press('Control+k');
 await card(page);await page.keyboard.type("reply saying I can't make Friday");await page.keyboard.press('Enter');
 const frame=await card(page);await expect(frame.locator('.new')).toContainText('Unfortunately');
 await page.keyboard.press('Enter');
 await expect(page.locator('#ce')).toHaveText("Thanks for the invite! Unfortunately I can't make it on Friday.");
});

test('memory is in every Ctrl+K, edits too: a rewrite can use what was read before',async({page,signedIn,standin})=>{
 await signedIn.evaluate(()=>(globalThis as any).gumbo.capture({url:'https://notes.example.com/offsite',title:'Offsite plan',text:'The team offsite is at the Lakeview Lodge on Friday. Bring the Q3 roadmap.'}));
 standin.script=b=>b.purpose==='inline'?{text:'EDIT\nSee you at the offsite at the Lakeview Lodge on Friday, with the Q3 roadmap.'}:{text:''};
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ta').click();
 await page.keyboard.type('see u at the offsite');await page.keyboard.press('Control+a');await page.keyboard.press('Control+k');
 await card(page);await page.keyboard.type('add where and when, and what to bring');await page.keyboard.press('Enter');
 await expect.poll(()=>inlineBodies(standin).length).toBeGreaterThan(0);
 const prompt=JSON.stringify(inlineBodies(standin).at(-1).messages);
 expect(prompt).toContain('<their_memory>');expect(prompt).toContain('Lakeview Lodge');
});

test('Ctrl+K opens on any page with nothing selected, answers about the page, and leaves a site\'s own Ctrl+K alone',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>b.purpose==='inline'?{text:'ANSWER\nThe offsite is on Friday, November 6 at 10 AM.'}:{text:''};
 await page.goto(`${standin.url}/pages/forms.html`);await page.locator('h1').click();
 await page.keyboard.press('Control+k');
 const frame=await card(page);
 await page.keyboard.type('when is the offsite?');await page.keyboard.press('Enter');
 await expect(frame.locator('.body')).toContainText('Friday, November 6');
 // The page's own text went with the question.
 expect(JSON.stringify(inlineBodies(standin).at(-1).messages)).toContain('410 Lakeview Drive');
 await page.keyboard.press('Escape');
 // A page that uses Ctrl+K itself keeps it.
 await page.evaluate(()=>window.addEventListener('keydown',e=>{if(e.ctrlKey&&e.code==='KeyK'){e.preventDefault();document.title='site search';}}));
 await page.locator('h1').click();await page.keyboard.press('Control+k');await page.waitForTimeout(800);
 expect(page.frames().some(f=>f.url().includes('card.html'))).toBe(false);
 expect(await page.title()).toBe('site search');
});
