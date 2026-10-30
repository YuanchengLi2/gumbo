import {test,expect,tell} from '../fixtures';
import {liveLog,liveSpent,startLive,closeLive} from '../standin';
import type {Page,Worker,BrowserContext} from '@playwright/test';
import {appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';

/** Is Tab useful? Live (GUMBO_LIVE=1, real model, costs money): moments a person has every day, in every kind of field,
 * each after browsing that memory takes in the way it does in use (pages read, scrolled, copied, closed). For each moment
 * it records what Tab offered (words at the caret or a move), how long after the last key or click it showed, and where
 * a miss happened: memory never brought the fact into the request, the model had it and did not use it, or the model
 * wrote it and the checks cut it. Results go to GUMBO_USEFUL_RESULTS (one JSON line per moment). */
/** GUMBO_USEFUL_FREE=1: the same flows with no model (scripted empty replies, nothing spent), judging memory alone: did
 * each moment's fact reach the request? */
const free=!!process.env.GUMBO_USEFUL_FREE&&!process.env.GUMBO_LIVE;
test.skip(!process.env.GUMBO_LIVE&&!free,'Set GUMBO_LIVE=1 or deployed to run against the real model (costs money), or GUMBO_USEFUL_FREE=1 for memory alone.');
test.describe.configure({timeout:120_000});
// The deployed gateway's test account (GUMBO_LIVE=deployed) is made before the moments and deleted when they are done.
test.beforeAll(async()=>{test.setTimeout(240_000);await startLive();});
test.afterAll(async()=>{await closeLive();});
const out=process.env.GUMBO_USEFUL_RESULTS??resolve(tmpdir(),'gumbo-useful.jsonl');
const only=process.env.GUMBO_USEFUL_ONLY?new RegExp(process.env.GUMBO_USEFUL_ONLY):undefined;

type Read={page:string;title:string;then?:'close'|'keep';copy?:{selector:string;words:string};
 /** Something clicked once it is read (an app that swaps what it shows without a new address). */click?:string};
type Moment={name:string;setting:string;read:Read[];at:string;
 /** Where the user goes and what they type there (\n is Enter); caretAfter: the caret goes right after these words of
  * what the field already holds (writing in the middle). */field:string;type?:string;caretAfter?:string;
 /** Fields they fill by hand first (a form they are finishing). */fill?:Record<string,string>;
 /** What a useful offer holds (the words shown, or the move's steps); the fact memory must bring, to tell misses apart. */
 want:RegExp;fact?:RegExp;
 /** Nothing is the right answer ('text': no words, a move may show). */quiet?:boolean|'text'};
const u=(p:string,q?:Record<string,string|string[]>)=>{const s=new URLSearchParams();for(const [k,v] of Object.entries(q??{}))for(const x of [v].flat())s.append(k,x);return`/pages/useful/${p}${q?`?${s}`:''}`;};
const FLIGHT={page:'flight.html',title:'Your trip confirmation - United Airlines'},INVOICE={page:'invoice.html',title:'Invoice INV-1043 from Acme Supply Co.'};
const moments:Moment[]=[
 {name:'Email reply, the fact on a tab still open',setting:'email',read:[{...FLIGHT,then:'keep'}],at:u('mail.html',{from:'Ana',msg:'Hi Dana! What time does your flight land on Tuesday? I can pick you up.',subject:'Re: Pickup Tuesday',to:'ana@example.com'}),field:'#body',type:'Hi Ana,\n\nMy flight lands at',want:/6:45/,fact:/6:45/},
 {name:'Email reply, only the greeting typed',setting:'email',read:[{...FLIGHT,then:'keep'}],at:u('mail.html',{from:'Ana',msg:'Hi Dana! What time does your flight land on Tuesday? I can pick you up.',subject:'Re: Pickup Tuesday',to:'ana@example.com'}),field:'#body',type:'Hi Ana,\n\n',want:/6:45|UA ?914/,fact:/6:45/},
 {name:'Chat answer, the invoice read and closed',setting:'chat',read:[{...INVOICE,then:'close'}],at:u('chat.html',{with:'Priya',m:['Priya|did the acme invoice come in? how much was it?']}),field:'#composer',type:'yes, it came in. it\'s ',want:/482/,fact:/482/},
 {name:'Spreadsheet cell, empty, under "Amount"',setting:'sheet',read:[{...INVOICE,then:'keep'}],at:u('expenses.html'),field:'#c-amount',want:/482/,fact:/482/},
 {name:'Spreadsheet cell under "Vendor", two letters typed',setting:'sheet',read:[{...INVOICE,then:'keep'}],at:u('expenses.html'),field:'#c-vendor',type:'Ac',want:/me Supply/i,fact:/Acme Supply/},
 {name:'Expense form, empty, invoice read a minute ago',setting:'form',read:[{...INVOICE,then:'close'}],at:u('reimburse.html'),field:'#vendor',want:/Acme/,fact:/Acme Supply/},
 {name:'Shop search, after reading a review',setting:'search',read:[{page:'product.html',title:'Review: Sony WH-1000XM6 noise-cancelling headphones | SoundGuide',then:'close'}],at:u('shop.html'),field:'#q',type:'sony',want:/1000\s?xm6|wh-1000/i,fact:/1000XM6/},
 {name:'AI prompt about the failing build in another tab',setting:'prompt',read:[{page:'buildlog.html',title:'Build failed · park-studio/web · Run #2231',then:'keep'}],at:u('assistant.html'),field:'#prompt',type:'why does my Gallery test fail with',want:/cannot read|reading 'map'|undefined|TypeError/i,fact:/reading 'map'/},
 {name:'Document, a date from meeting notes read earlier',setting:'document',read:[{page:'meeting-notes.html',title:'Launch sync - meeting notes',then:'close'}],at:u('doc.html'),field:'#doc',type:'Existing customers get the beta on',want:/April 7/,fact:/April 7/},
 {name:'Issue comment, naming the issue read earlier',setting:'comment',read:[{page:'issue790.html',title:'Upload client fails on large files · Issue #790 · park-studio/web',then:'close'}],at:u('issue.html'),field:'#c',type:'This looks like the same bug as',want:/790|#455/,fact:/#790/},
 {name:'Support chat, the order number from the confirmation',setting:'chat',read:[{page:'order.html',title:'Order confirmation - Northline Outfitters',then:'keep'}],at:u('chat.html',{with:'Northline Support',m:['Northline Support|Hi Dana! Sorry about the delay. Could you share your order number so I can look into it?']}),field:'#composer',type:'Sure, it\'s ',want:/NL-58213-77/,fact:/NL-58213-77/},
 {name:'Email, a fact at the very end of a long page',setting:'email',read:[{page:'lease.html',title:'Studio lease agreement - 2150 Bryant St, Unit 3',then:'close'}],at:u('mail.html',{from:'Mission Properties',msg:'Hi Dana, just checking when we can expect the deposit for Unit 3?',subject:'Re: Deposit for Unit 3',to:'leasing@missionprops.example'}),field:'#body',type:'Hi,\n\nWe will send the $7,700 deposit by',want:/March 3/,fact:/March 3/},
 {name:'Email, no memory needed: the next words',setting:'email',read:[],at:u('mail.html',{from:'Marcus',msg:'Here is the deck for Thursday, let me know what you think.',subject:'Re: Deck for Thursday',to:'marcus@example.com'}),field:'#body',type:'Thanks for sending the deck over. I\'ll',want:/\w{3,}/},
 {name:'Chat, finishing from the conversation',setting:'chat',read:[],at:u('chat.html',{with:'Sam',m:['Sam|want to grab coffee thursday at 3 at blue bottle?']}),field:'#composer',type:'sounds good, see you',want:/thursday|3/i},
 {name:'A written chat reply: the move is Send',setting:'move',read:[],at:u('chat.html',{with:'Sam',m:['Sam|want to grab coffee thursday at 3 at blue bottle?']}),field:'#composer',type:'sounds good, see you thursday at 3!',want:/send/i},
 {name:'A form filled in by hand: the move is Submit',setting:'move',read:[],at:u('reimburse.html'),field:'#memo',fill:{'#vendor':'Acme Supply Co.','#number':'INV-1043','#date':'October 21, 2026','#amount':'$482.00'},type:'Lighting for the studio',want:/submit/i},
 {name:'Reading a long page, nothing to do',setting:'quiet',read:[],at:u('lease.html'),field:'h1',want:/^$/,quiet:true},
 // The text around the field: the question above it, the column it is in, the article it answers, the text after it.
 {name:'Comment under the article it answers',setting:'around',read:[],at:u('article.html'),field:'#comment',type:'Really interesting that sick days',want:/fell|half|dropped|down/i},
 {name:'Spreadsheet cell, the values above it in its column',setting:'around',read:[],at:u('expenses.html'),field:'#c-category',type:'Equ',want:/^ipment/i},
 {name:'Document summary from the table above it',setting:'around',read:[],at:u('report.html'),field:'#doc',type:'Revenue grew to',want:/1\.2/},
 {name:'Writing in the middle of a reply, the offer above',setting:'around',read:[],at:u('draft.html'),field:'#body',caretAfter:'Friday works better for me.',type:' Does',want:/10/},
 {name:'Job application question about themselves: nothing to invent',setting:'quiet',read:[],at:u('job.html'),field:'#q1',type:'I mostly use',want:/^$/,quiet:'text'},
 // Memory across tabs, in more kinds of field and language.
 {name:'Spanish reply, the flight in another tab',setting:'chat',read:[{...FLIGHT,then:'keep'}],at:u('chat.html',{with:'Ana',m:['Ana|¡Hola Dana! ¿A qué hora llega tu vuelo el martes?']}),field:'#composer',type:'Mi vuelo llega a las',want:/6:45|18:45/,fact:/6:45/},
 {name:'Reply after the email they read changed',setting:'chat',read:[{page:'inbox.html',title:'Inbox - Mail',then:'keep',click:'#open-2'}],at:u('chat.html',{with:'Priya',m:['Priya|when is the design review now?']}),field:'#composer',type:'it moved to',want:/wednesday/i,fact:/Wednesday at 4/},
 {name:'Support chat, the tracking number they copied',setting:'chat',read:[{page:'order.html',title:'Order confirmation - Northline Outfitters',then:'keep',copy:{selector:'tr:nth-child(4) td',words:'1Z84V2930398712245'}}],at:u('chat.html',{with:'Northline Support',m:['Northline Support|Could you share the tracking number?']}),field:'#composer',type:'here it is: ',want:/1Z84V2930398712245/,fact:/1Z84V2930398712245/},
 {name:'Calendar title, empty, the appointment just read',setting:'form',read:[{page:'appointment.html',title:'Your appointment is confirmed - Patel Family Dentistry',then:'keep'}],at:u('event.html'),field:'#title',want:/dent|clean|patel/i,fact:/Patel/},
 {name:'Calendar location, a few digits typed',setting:'form',read:[{page:'appointment.html',title:'Your appointment is confirmed - Patel Family Dentistry',then:'keep'}],at:u('event.html'),field:'#where',type:'2210',want:/Alder/,fact:/Alder Street/},
 {name:'Web search for the error in the build log',setting:'search',read:[{page:'buildlog.html',title:'Build failed · park-studio/web · Run #2231',then:'keep'}],at:u('websearch.html'),field:'#q',type:'vitest typeerror cannot read',want:/propert|undefined|map/i,fact:/reading 'map'/},
 {name:'Chat, the venue address from a plan read earlier',setting:'chat',read:[{page:'offsite.html',title:'Team offsite - plan',then:'close'}],at:u('chat.html',{with:'Priya',m:['Priya|what\'s the address for the offsite?']}),field:'#composer',type:'it\'s at',want:/410 Lakeview/,fact:/410 Lakeview/},
 {name:'Chat, sharing a link from the open tab',setting:'chat',read:[{page:'offsite.html',title:'Team offsite - plan',then:'keep'}],at:u('chat.html',{with:'Jun',m:['Jun|can you send me the roadmap board link?']}),field:'#composer',type:'here you go: ',want:/QX81/,fact:/QX81-roadmap/},
 {name:'Shipping form, empty, the order confirmation read before',setting:'form',read:[{page:'order.html',title:'Order confirmation - Northline Outfitters',then:'close'}],at:u('../shipping.html'),field:'#street',want:/88 Valencia/,fact:/88 Valencia/},
 {name:'Check-in form, empty, the booking in another tab',setting:'form',read:[{...FLIGHT,then:'keep'}],at:u('../checkin.html'),field:'#flight',want:/UA ?914/,fact:/UA 914/},
 {name:'Chat, a name from memory finished mid-word',setting:'chat',read:[{...INVOICE,then:'close'}],at:u('chat.html',{with:'Priya',m:['Priya|who was that lighting order from?']}),field:'#composer',type:'it was from Acm',want:/^e Supply/,fact:/Acme Supply/},
 {name:'AI prompt about the article in another tab',setting:'prompt',read:[{page:'article.html',title:'We tried a four-day week for six months. Here\'s what happened. | Field Notes',then:'keep'}],at:u('assistant.html'),field:'#prompt',type:'summarize the article about the',want:/four-day/i,fact:/four-day/},
 // Nothing is right.
 {name:'A finished email with its sign-off: no more words',setting:'quiet',read:[],at:u('mail.html',{from:'Marcus',msg:'Here is the deck for Thursday, let me know what you think.',subject:'Re: Deck for Thursday',to:'marcus@example.com'}),field:'#body',type:'Looks great, thanks!\n\nDana',want:/^$/,quiet:'text'},
 {name:'Search box, nothing typed, nothing read',setting:'quiet',read:[],at:u('shop.html'),field:'#q',want:/^$/,quiet:true},
 {name:'Comment box under an article, nothing typed',setting:'quiet',read:[],at:u('article.html'),field:'#comment',want:/^$/,quiet:true},
];

const db=(w:Worker,store:string)=>w.evaluate(s=>(globalThis as any).gumbo.db.recent(s,50),store) as Promise<any[]>;
/** The product's own models, through the deployed gateway (GUMBO_LIVE=deployed). On this computer's gateway code the text
 * model (Qwen on Cerebras) has no key, so Haiku, Tab's fallback, writes. GUMBO_TAB_MODEL and GUMBO_ACTION_MODEL try
 * others. */
const models={...(process.env.GUMBO_LIVE!=='deployed'?{tab:'claude-haiku-5-5'}:{}),...(process.env.GUMBO_TAB_MODEL?{tab:process.env.GUMBO_TAB_MODEL}:{}),...(process.env.GUMBO_ACTION_MODEL?{action:process.env.GUMBO_ACTION_MODEL}:{})};
async function setUp(w:Worker){
 await w.evaluate(models=>chrome.storage.local.get('settings').then(({settings}:any)=>chrome.storage.local.set({settings:{...settings,models:{...settings?.models,...models},modelsVersion:5,facts:{...settings?.facts,name:'Dana Park',email:'dana.park@example.com'}}})),models);
}
/** Reads a page as a person does: in front, scrolled through for a few seconds; then memory has it. */
async function read(context:BrowserContext,w:Worker,base:string,r:Read){
 const p=await context.newPage();await p.goto(base+u(r.page));await p.bringToFront();
 for(let i=0;i<8;i++){await p.mouse.wheel(0,250);await p.waitForTimeout(500);}
 if(r.click){await p.locator(r.click).click();for(let i=0;i<6;i++){await p.mouse.wheel(0,120);await p.waitForTimeout(500);}}
 if(r.copy){await p.evaluate(([sel,t])=>{const n=document.querySelector(sel)!.firstChild!,s=n.textContent!,i=s.indexOf(t),g=document.createRange();g.setStart(n,i);g.setEnd(n,i+t.length);getSelection()!.removeAllRanges();getSelection()!.addRange(g);},[r.copy.selector,r.copy.words]);await p.keyboard.press('Control+c');}
 const kept=await expect.poll(async()=>(await db(w,'pages')).some(x=>x.title===r.title),{timeout:15_000}).toBe(true).then(()=>true,()=>false);
 if(r.then==='close')await p.close();
 return kept;
}
const text=(s:any)=>s?.showing?String(s.rest??''):'';
const move=(s:any)=>s?.showing?`${s.label??''} ${JSON.stringify(s.plan?.steps??[])}`:'';

for(const m of moments)test(m.name,async({context,signedIn,standin,page})=>{
 test.skip(!!only&&!only.test(m.name));
 standin.script=free?(body:any)=>({text:body.purpose==='action'?'{"confidence":0,"steps":[]}':''}):()=>({live:true});await setUp(signedIn);
 const kept:boolean[]=[];for(const r of m.read)kept.push(await read(context,signedIn,standin.url,r));
 // Brought to the front before it navigates: a tab behind the one just read can wait on its load for good in headless
 // Chromium.
 await page.bringToFront();await page.goto(standin.url+m.at,{waitUntil:'domcontentloaded'});await page.waitForTimeout(1500);
 for(const [sel,v] of Object.entries(m.fill??{})){await page.locator(sel).click();await page.keyboard.type(v,{delay:20});}
 const mark=liveLog.length,asked=standin.bodies.length,spentBefore=liveSpent();
 await page.locator(m.field).click();
 if(m.caretAfter)await page.locator(m.field).evaluate((el:HTMLTextAreaElement,words)=>{const at=el.value.indexOf(words)+words.length;el.setSelectionRange(at,at);},m.caretAfter);
 else if(['#body','#composer','#doc'].includes(m.field))await page.keyboard.press('Control+End');
 if(m.type)await page.keyboard.type(m.type,{delay:70});
 const end=Date.now();
 // Watch for 8 s: the first words (and the first move), and what stands at the end.
 let firstText:number|undefined,firstMove:number|undefined,lastText:any,lastMove:any;
 while(Date.now()-end<8000){
  const [t,mv]=await Promise.all([tell(signedIn,page,{type:'debug.tab'}).catch(()=>null),tell(signedIn,page,{type:'debug.predict'}).catch(()=>null)]);
  if(t?.showing){firstText??=Date.now()-end;lastText=t;}
  if(mv?.showing){firstMove??=Date.now()-end;lastMove=mv;}
  await page.waitForTimeout(60);
 }
 const shownText=text(lastText),shownMove=move(lastMove),shown=shownText||shownMove;
 const calls=free?standin.bodies.slice(asked).map(body=>({purpose:String(body.purpose),model:String(body.model),usd:0,ms:0,firstMs:undefined,out:'',body})):liveLog.slice(mark),asks=calls.filter(c=>c.purpose==='tab'||c.purpose==='action');
 const reached=m.fact?asks.some(c=>m.fact!.test(JSON.stringify(c.body?.messages??''))):undefined;
 const wrote=m.fact?asks.some(c=>m.fact!.test(c.out??'')):undefined;
 const good=m.quiet==='text'?!shownText:m.quiet?!shown:m.want.test(shownText)||m.want.test(shownMove);
 const verdict=free?(m.fact?reached?'memory brought the fact':'memory never brought the fact':'no fact needed'):good?'useful':shown?'wrong':m.fact&&!reached?'nothing: memory never brought the fact':m.fact&&!wrote?'nothing: the model had the fact, did not use it':m.fact?'nothing: the model wrote it, the checks cut it':'nothing';
 const lastAsk=asks.filter(c=>c.purpose==='tab').at(-1)??asks.at(-1);
 // Why memory gave what it gave: what was slow or failed, and what each surface was last handed (its items and scores).
 const debug=await signedIn.evaluate(()=>(globalThis as any).gumbo.memory.debug()).catch(()=>null) as any;
 const failures=(debug?.failures??[]).filter((f:any)=>f.at>=end-60_000).map((f:any)=>`${f.what}: ${f.detail}`);
 const given=(b:any)=>b?{ms:b.ms,searching:b.searching,query:b.query,items:(b.items??[]).map((i:any)=>`${i.layer}/${i.kind} ${i.score} “${String(i.title).slice(0,50)}”`)}:undefined;
 const row={name:m.name,setting:m.setting,verdict,text:shownText,move:shownMove,firstTextMs:firstText,firstMoveMs:firstMove,kept,reached,wrote,failures,textMemory:given(debug?.contexts?.textHistory?.[0]),moveMemory:given(debug?.contexts?.['tab-action']),
  calls:calls.map(c=>({purpose:c.purpose,model:c.model,firstMs:c.firstMs,ms:c.ms,usd:+c.usd.toFixed(5),out:(c.out??'').slice(0,300)})),
  usd:+(liveSpent()-spentBefore).toFixed(4),prompt:lastAsk?JSON.stringify(lastAsk.body?.messages??'').slice(0,12_000):''};
 appendFileSync(out,JSON.stringify(row)+'\n');
 console.log(`${verdict.padEnd(46)} ${m.name}\n   text “${shownText.slice(0,90)}” ${firstText??'-'} ms · move ${shownMove.slice(0,110)||'-'} ${firstMove??'-'} ms · fact in request ${reached??'-'} · $${row.usd}`);
});
