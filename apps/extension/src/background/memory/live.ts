import {on} from '../surfaces';
import {add,type ActionEvent,type PageCategory} from '../db';
import {loadSettings,activeOn,siteOf} from '../../shared/settings';
/** Memory's "now" and "this session", held in the worker for every surface to read at once: each open tab with its trail
 * of visits (the pages it went through, how long each held them, what was read there), what is on its screen right now
 * (the text in view, the field in focus and what is being typed, the selection), the steps taken in it (clicked, chose,
 * typed, pasted…), the tabs closed lately, the order tabs were switched in, and what was copied. Visits themselves are
 * kept for good in IndexedDB (visits.ts); this is the fast copy of the session. It is saved to the browser session's
 * storage as it changes, so a worker that slept rebuilds it in a moment, and it is gone when the browser closes. Nothing
 * from incognito windows, from sites where Gumbo is off, or from the browser's own pages. */
export type Now={at:number;url:string;title:string;
 /** The words in view (whole blocks at least half on screen), top to bottom. */visible:string;
 focus?:{label:string;intent:string;typed?:string};selection?:string;
 /** How far down the page (px) and how tall it is. */scroll:[number,number];kind?:PageCategory};
export type Step={at:number;kind:string;label:string;text?:string;title:string;site:string};
export type LiveVisit={id?:number;url:string;title:string;site:string;pageKind:string;kind:PageCategory;in:number;out?:number;
 activeMs:number;visibleMs:number;readMs:number;from?:number;opener?:number;transition:string;events:number;project?:string;
 /** The blocks of text read here (their first words) and how long each was in view while they were there. */seen:Record<string,number>;
 /** The fields typed in here (so a field's first word is an event, not every word). */typedIn?:string[]};
export type Copied={text:string;title:string;url:string;at:number};
export type TabLive={tab:number;window:number;visits:LiveVisit[];steps:Step[];now?:Now;lastEvent?:number};
export type Closed={tab:number;title:string;url:string;at:number;visits:LiveVisit[]};
/** The clocks visits are timed by (visits.ts): the tab in front of the focused window while the user is not idle
 * (active time), and each window's shown tab (visible time). Kept with the rest, so a worker that slept loses no time. */
export type Clock={tab:number;since:number};
export type State={session:number;tabs:Record<string,TabLive>;closed:Closed[];copies:Copied[];order:{tab:number;at:number}[];front?:Clock;shown?:Record<string,Clock>;idle?:boolean};
const MINUTE=60_000,KEEP_STEPS=40,KEEP_VISITS=20,KEEP_SEEN=120;
let state:State|undefined,loading:Promise<State>|undefined,saveTimer:ReturnType<typeof setTimeout>|undefined;

export async function load():Promise<State>{
 if(state)return state;
 return loading??=chrome.storage.session.get('live').then(r=>state=(r.live as State|undefined)??fresh()).catch(()=>state=fresh()).finally(()=>{loading=undefined;});
}
const fresh=():State=>({session:Date.now(),tabs:{},closed:[],copies:[],order:[]});
export function changed(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{if(state)void chrome.storage.session.set({live:state}).catch(()=>{});},1000);}
export async function allowed(url:string,incognito?:boolean){return !incognito&&/^(https?|file):/.test(url)&&activeOn(await loadSettings(),siteOf(url));}

export async function tabOf(tab:number,window=-1):Promise<TabLive>{
 const s=await load();return s.tabs[tab]??=({tab,window,visits:[],steps:[]});
}
/** The page a tab is on now, as memory knows it (undefined before its first visit, or on a page Gumbo does not keep). */
export async function current(tab:number):Promise<LiveVisit|undefined>{const t=(await load()).tabs[tab];const v=t?.visits.at(-1);return v&&v.out===undefined?v:undefined;}
export async function startVisit(tab:number,window:number,visit:LiveVisit){
 const t=await tabOf(tab,window);t.window=window;t.visits.push(visit);if(t.visits.length>KEEP_VISITS)t.visits.splice(0,t.visits.length-KEEP_VISITS);
 t.now=undefined;changed();return visit;
}
export async function closeTab(tab:number){
 const s=await load(),t=s.tabs[tab];if(!t)return;delete s.tabs[tab];
 const last=t.visits.at(-1);
 if(last)s.closed=[...s.closed,{tab,title:last.title,url:last.url,at:Date.now(),visits:t.visits.slice(-8).map(v=>({...v,seen:{}}))}].slice(-30);
 s.order=s.order.filter(o=>o.tab!==tab);changed();
}
export async function noteSwitch(tab:number){const s=await load();s.order=[...s.order.filter(o=>o.tab!==tab),{tab,at:Date.now()}].slice(-50);changed();}
export async function noteNow(tab:number,now:Now){const t=(await load()).tabs[tab];if(!t)return;t.now=now;const v=t.visits.at(-1);if(v&&v.out===undefined){if(now.kind)v.kind=now.kind;if(now.title)v.title=now.title.slice(0,200);}changed();}
/** Text read on a tab's page: each block's time in view is added to its visit (and to the visit's read time). */
export async function noteSeen(tab:number,blocks:{text:string;ms:number}[]){
 const v=await current(tab);if(!v)return;
 for(const b of blocks){const key=b.text.slice(0,300);if(!key)continue;if(v.seen[key]===undefined&&Object.keys(v.seen).length>=KEEP_SEEN)continue;v.seen[key]=(v.seen[key]??0)+b.ms;v.readMs+=b.ms;}
 changed();
}
export async function noteCopy(url:string,title:string,text:string){
 const s=await load(),clean=text.trim().slice(0,1500);if(!clean)return;
 s.copies=[...s.copies.filter(c=>c.text!==clean),{text:clean,title:title.slice(0,140),url,at:Date.now()}].slice(-5);changed();
}
/** A step in a tab (the top page's own, as the user took it): the same step again (typing on in one field) replaces
 * itself. */
export async function noteStep(tab:number,url:string,m:{kind:string;label:string;text?:string;title:string}){
 const t=await tabOf(tab),last=t.steps.at(-1),step:Step={at:Date.now(),kind:m.kind,label:m.label.slice(0,80),text:m.text?.slice(0,200),title:m.title.slice(0,100),site:siteOf(url)};
 if(last&&last.kind===step.kind&&last.label===step.label&&last.title===step.title)t.steps[t.steps.length-1]=step;else t.steps.push(step);
 if(t.steps.length>KEEP_STEPS)t.steps.splice(0,t.steps.length-KEEP_STEPS);
 changed();
}
/** Keeps an event for good, chained to the tab's last one and its visit (the raw material habits and sequences learn
 * from). Returns its id. */
export async function recordEvent(tab:number,event:Omit<ActionEvent,'tab'|'visit'|'prev'|'source'>):Promise<number|undefined>{
 const t=await tabOf(tab),v=await current(tab);
 if(v)v.events++;
 try{const id=await add('events',{...event,tab,visit:v?.id,prev:t.lastEvent,source:'browser'}) as number;t.lastEvent=id;changed();return id;}catch{return;}
}

const ago=(at:number)=>{const s=Math.round((Date.now()-at)/1000);return s<60?`${s}s ago`:`${Math.round(s/60)} min ago`;};
/** The last steps in a tab, oldest first, page by page, as a prompt block (empty when there are none). */
export async function doingText(tab:number|undefined,limit=15):Promise<string>{
 if(tab===undefined)return '';
 const list=((await load()).tabs[tab]?.steps??[]).filter(d=>Date.now()-d.at<30*MINUTE).slice(-limit);
 if(!list.length)return '';
 let page='';const lines:string[]=[];
 for(const d of list){
  if(d.title!==page){page=d.title;lines.push(`On “${d.title}” (${d.site}):`);}
  lines.push(`- ${ago(d.at)}: ${d.kind} ${d.label}${d.text?` “${d.text.slice(0,120)}”`:''}`);
 }
 return `<what_they_have_been_doing_in_this_tab>\n${lines.join('\n')}\n</what_they_have_been_doing_in_this_tab>`;
}
export type Seen={url:string;title:string;at:number};
/** The pages before this one across tabs (the last half hour, newest last) and what was copied in the last quarter of an
 * hour. The next thing someone does often comes from the last tab: the address copied from an email goes into the
 * shipping form, the flight just looked up goes into the calendar. */
export async function lately(here?:string):Promise<{pages:Seen[];copied:Copied[]}>{
 const s=await load(),now=Date.now();
 const visits=[...Object.values(s.tabs).flatMap(t=>t.visits),...s.closed.flatMap(c=>c.visits)].filter(v=>v.url!==here&&now-v.in<30*MINUTE).sort((a,b)=>a.in-b.in);
 const pages:Seen[]=[];for(const v of visits){const at=pages.findIndex(p=>p.url===v.url);if(at>=0)pages.splice(at,1);pages.push({url:v.url,title:v.title||v.url,at:v.in});}
 return{pages:pages.slice(-6),copied:s.copies.filter(c=>now-c.at<15*MINUTE).slice(-2)};
}
/** What a prediction may take facts from: what they copied, and the titles of the pages they came from. */
export const latelyKnown=(l:{pages:Seen[];copied:Copied[]})=>[...l.copied.map(c=>`${c.title} ${c.text}`),...l.pages.map(p=>p.title)].join('\n');
/** All of it, for the debug view. */
export async function snapshot(){return structuredClone(await load());}

/** What a page reports of itself: what is on its screen, and what was read there (seen.ts). */
on('now',async(m:Now,{port,url})=>{
 const tab=port.sender?.tab?.id;if(tab===undefined||port.sender?.frameId||!await allowed(url,port.sender?.tab?.incognito))return;
 await noteNow(tab,{...m,url,at:Date.now(),visible:String(m.visible??'').slice(0,3000),selection:m.selection?.slice(0,1000)});
});
on('seen',async(m:{blocks:{text:string;ms:number}[]},{port,url})=>{
 const tab=port.sender?.tab?.id;if(tab===undefined||port.sender?.frameId||!await allowed(url,port.sender?.tab?.incognito))return;
 await noteSeen(tab,(m.blocks??[]).slice(0,200));
});
chrome.tabs.onActivated.addListener(({tabId})=>void noteSwitch(tabId));
