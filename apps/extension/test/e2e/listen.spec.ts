import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {test,expect,tell,extensionPage} from '../fixtures';
import type {Page,Worker} from '@playwright/test';

/** Listening, end to end in the extension: a page's sound is tapped, turned into lines (a stand-in for Whisper says a
 * script, a few words for each second of sound), shown in the pill, kept in memory with its moment, and found by
 * meaning; a call is a meeting and gets notes, which the side panel shows. GUMBO_REAL_AUDIO=1 also runs the real
 * models (Whisper, YAMNet, CAM++) on a recording of the Gettysburg Address and scores the words. */
const words=(text:string)=>text.split(/\s+/).filter(Boolean);
const pill=async(worker:Worker,page:Page)=>(await tell(worker,page,{type:'debug.listen'}))?.pill??'';
const heard=(worker:Worker)=>worker.evaluate(()=>(globalThis as any).gumbo.db.recent('media',5)) as Promise<any[]>;
// With GUMBO_DEBUG, a failed test prints what the offscreen document did and what the page logged.
const pageLog:string[]=[];
test.beforeEach(({page})=>{pageLog.length=0;page.on('console',m=>pageLog.push(m.text()));});
test.afterEach(async({worker},info)=>{
 if(!process.env.GUMBO_DEBUG||info.status===info.expectedStatus)return;
 const r=await worker.evaluate(()=>(globalThis as any).gumbo.offscreen({type:'debug.logs'})).catch((e:Error)=>({log:[String(e)]}));
 console.log('offscreen:\n'+(r?.log??[]).join('\n')+'\npage:\n'+pageLog.join('\n'));
});

test('hears what a page plays, shows it, and remembers it with its moment',async({signedIn,standin,page})=>{
 test.setTimeout(150_000);
 await signedIn.evaluate(s=>{(globalThis as any).gumbo.fakeListening=s;},words('Welcome to the launch review. We ship on Friday the ninth. Sarah owns the pricing page.'));
 await page.goto(`${standin.url}/pages/listen.html`);
 await page.click('#play');
 // The pill shows what is being said as it is said, up to the last words.
 await expect.poll(()=>pill(signedIn,page),{timeout:30_000}).toMatch(/launch review|Friday the ninth|pricing page/);
 await expect.poll(()=>pill(signedIn,page),{timeout:30_000}).toContain('pricing page');
 const state=await tell(signedIn,page,{type:'debug.listen',capturing:true});
 expect(state).toMatchObject({listening:true,kind:'audio'});
 await signedIn.evaluate(id=>(globalThis as any).gumbo.stopListening(id,true),state.session);
 await expect.poll(async()=>(await heard(signedIn))[0]?.endedAt??0,{timeout:15_000}).toBeGreaterThan(0);
 const [media]=await heard(signedIn);
 expect(media.segments.map((s:any)=>s.text)).toEqual(['Welcome to the launch review.','We ship on Friday the ninth.','Sarah owns the pricing page.']);
 // Times are the recording's own: the lines start within its first seconds, in order.
 expect(media.segments[0].start).toBeLessThan(10);expect(media.segments[2].start).toBeGreaterThan(media.segments[0].start);
 expect(media.title).toBe('Launch review');
 // Stopped by the user: that recording is not heard again on this page.
 await page.waitForTimeout(4000);
 expect((await tell(signedIn,page,{type:'debug.listen',capturing:true}))?.listening??false).toBe(false);
 // Found by meaning, with a link to the moment.
 await expect.poll(async()=>{const found:any[]=await signedIn.evaluate(q=>(globalThis as any).gumbo.search(q,{k:5}),'when is the release date');return found.find(f=>f.kind==='media'&&f.text.includes('Friday'))?.url??'';},{timeout:60_000}).toMatch(/listen\.html#gumbo-t=\d+$/);
});

test('a call is heard as a meeting, gets notes when it ends, and the side panel shows them',async({signedIn,standin,page,context})=>{
 const script=words(`Thanks for joining. Today we decide the launch date. I think Friday works if pricing is done. Sarah can you finish the pricing page by Wednesday? Yes I will have it done by Wednesday. Great so we launch Friday. Tom will write the announcement post. Let's also check the onboarding emails before then. Thanks everyone, see you on Friday. Okay that's everything for today.`);
 expect(script.length).toBeGreaterThanOrEqual(60);
 await signedIn.evaluate(s=>{(globalThis as any).gumbo.fakeListening=s;},script);
 standin.script=body=>/You write notes/.test(JSON.stringify(body.system??''))?{text:'The team set the launch date.\nDecisions:\n- Launch on Friday [0:04]\nTo do:\n- Speaker 1: finish the pricing page by Wednesday'}:{text:''};
 await page.goto(`${standin.url}/pages/listen.html`);
 await page.click('#call');
 await expect.poll(async()=>(await tell(signedIn,page,{type:'debug.listen',capturing:true}))?.kind,{timeout:30_000}).toBe('meeting');
 await expect.poll(()=>pill(signedIn,page),{timeout:30_000}).toContain('everything for today');
 const {session}=await tell(signedIn,page,{type:'debug.listen',capturing:true});
 await signedIn.evaluate(id=>(globalThis as any).gumbo.stopListening(id,true),session);
 await expect.poll(async()=>(await heard(signedIn))[0]?.notes??'',{timeout:20_000}).toContain('Launch on Friday');
 const notesCall=standin.bodies.find(b=>/You write notes/.test(JSON.stringify(b.system??'')));
 expect(JSON.stringify(notesCall.messages)).toContain('Meeting: Launch review');
 // The side panel lists it; opening it shows the notes and who said what, and a voice can be named.
 const panel=await context.newPage();await panel.goto(extensionPage('sidepanel.html'));
 await panel.getByRole('button',{name:'Heard'}).click();
 await panel.locator('.list').getByText('Launch review').first().click();
 await expect(panel.getByText('Launch on Friday')).toBeVisible();
 await expect(panel.getByText(/Thanks for joining/)).toBeVisible();
 await panel.getByRole('button',{name:'Speaker 1'}).first().click();
 await panel.getByPlaceholder('Who is Speaker 1?').fill('Sarah');await panel.keyboard.press('Enter');
 await expect.poll(async()=>(await heard(signedIn))[0]?.segments?.[0]?.speaker,{timeout:10_000}).toBe('Sarah');
});

test('nothing is heard on a site where listening is off',async({signedIn,standin,page})=>{
 await signedIn.evaluate(()=>chrome.storage.local.get('settings').then(({settings})=>chrome.storage.local.set({settings:{...(settings as object),listenOff:['127.0.0.1']}})));
 await signedIn.evaluate(s=>{(globalThis as any).gumbo.fakeListening=s;},words('This should never be kept.'));
 await page.goto(`${standin.url}/pages/listen.html`);
 await page.click('#play');
 await page.waitForTimeout(7000);
 expect((await tell(signedIn,page,{type:'debug.listen',capturing:true}))?.listening??false).toBe(false);
 expect(await heard(signedIn)).toEqual([]);
});

test('a link to a moment jumps the media there',async({signedIn,standin,page})=>{
 await page.goto(`${standin.url}/pages/listen.html#gumbo-t=12`);
 await expect.poll(()=>page.evaluate(()=>(document.getElementById('media') as HTMLMediaElement).currentTime),{timeout:10_000}).toBeGreaterThanOrEqual(12);
 expect(page.url()).not.toContain('gumbo-t');
});

/** Word error rate: edits (substitutions, insertions, deletions) over the reference's words, ignoring case, punctuation
 * and spelling that says the same words ("battle-field" and "battlefield", "can not" and "cannot"). */
function wer(reference:string,hypothesis:string){
 const norm=(t:string)=>t.toLowerCase().replace(/(\w)-(\w)/g,'$1$2').replace(/\bcan not\b/g,'cannot').replace(/[^a-z0-9' ]+/g,' ').split(/\s+/).filter(Boolean);
 const r=norm(reference),h=norm(hypothesis),d=Array.from({length:r.length+1},(_,i)=>[i,...Array(h.length).fill(0)]);
 for(let j=1;j<=h.length;j++)d[0][j]=j;
 for(let i=1;i<=r.length;i++)for(let j=1;j<=h.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(r[i-1]===h[j-1]?0:1));
 return d[r.length][h.length]/Math.max(1,r.length);
}
test('real models: the Gettysburg Address, word for word',async({signedIn,standin,page})=>{
 test.skip(!process.env.GUMBO_REAL_AUDIO,'Set GUMBO_REAL_AUDIO=1 to run Whisper, YAMNet and CAM++ for real (downloads ~200 MB once).');
 test.setTimeout(25*60_000);
 await page.goto(`${standin.url}/pages/listen.html?src=/audio/gettysburg.ogg`);
 await page.click('#play');
 // How long a line takes to show after it was said: sampled from the pill against the recording's clock.
 const shown:{text:string;at:number}[]=[];let last='';
 const logs=async()=>{const r=await signedIn.evaluate(()=>(globalThis as any).gumbo.offscreen({type:'debug.logs'}).catch((e:Error)=>({log:[String(e)]})));return(r?.log??[]).join('\n');};
 let tick=0;
 for(const until=Date.now()+12*60_000;Date.now()<until;){
  if(process.env.GUMBO_DEBUG&&tick++%25===0)console.log('pill:',await pill(signedIn,page),'\n'+await logs());
  const [text,at,ended]=await Promise.all([pill(signedIn,page),page.evaluate(()=>(document.getElementById('media') as HTMLMediaElement).currentTime),page.evaluate(()=>(document.getElementById('media') as HTMLMediaElement).ended)]);
  if(text&&text!==last&&!/^(Listening|Getting ready)/.test(text)){shown.push({text,at});last=text;}
  if(ended)break;await page.waitForTimeout(400);
 }
 await expect.poll(async()=>(await heard(signedIn))[0]?.endedAt??0,{timeout:10*60_000}).toBeGreaterThan(0).catch(async error=>{console.log('offscreen log:\n'+await logs());throw error;});
 const [media]=await heard(signedIn),said=media.segments.map((s:any)=>s.text).join(' ');
 const reference=readFileSync(resolve(import.meta.dirname,'../../../../packages/web-ml/test/fixtures/gettysburg.txt'),'utf8');
 const lags=shown.flatMap(s=>{const seg=media.segments.find((g:any)=>s.text.includes(g.text.slice(0,40)));return seg?[s.at-seg.end]:[];}).sort((a,b)=>a-b);
 const score=wer(reference,said);
 if(process.env.GUMBO_DEBUG)console.log('heard:\n'+media.segments.map((s:any)=>`[${s.start.toFixed(1)}–${s.end.toFixed(1)}] ${s.speaker}: ${s.text}`).join('\n'));
 console.log(`real audio: WER ${(score*100).toFixed(1)}% over ${words(reference).length} words · ${media.segments.length} lines · speakers ${[...new Set(media.segments.map((s:any)=>s.speaker))].join(', ')} · sounds ${media.sounds.map((s:any)=>s.label).join(', ')||'none'} · caption lag p50 ${lags[Math.floor(lags.length/2)]?.toFixed(1)} s`);
 expect(score).toBeLessThan(0.15);
 // One voice reads it: one speaker, however the clustering names it.
 expect(new Set(media.segments.map((s:any)=>s.speaker).filter(Boolean)).size).toBeLessThanOrEqual(2);
});

test('words show as they are said, before their sentence is over, and become the line when it is',async({signedIn,standin,page})=>{
 await signedIn.evaluate(s=>{(globalThis as any).gumbo.fakeListening=s;},words('So the plan for the quarter is to grow the team and ship the browser extension to everyone who asked for it'));
 await page.goto(`${standin.url}/pages/listen.html`);
 await page.click('#play');
 // No sentence has ended, yet what was said is already in the pill.
 await expect.poll(()=>pill(signedIn,page),{timeout:30_000}).toContain('the quarter');
 expect((await heard(signedIn))[0]?.segments?.length??0).toBe(0);
 // It keeps up to the newest words, all still one unfinished sentence.
 await expect.poll(()=>pill(signedIn,page),{timeout:30_000}).toContain('asked for it');
 const state=await tell(signedIn,page,{type:'debug.listen',capturing:true});
 await signedIn.evaluate(id=>(globalThis as any).gumbo.stopListening(id,true),state.session);
 await expect.poll(async()=>(await heard(signedIn))[0]?.segments?.[0]?.text??'',{timeout:15_000}).toContain('ship the browser extension');
});
