import {add,save,type Visit} from '../db';
import {siteOf} from '../../shared/settings';
import {pageKindOf} from '../../shared/learn';
import {categoryOf} from '../../shared/page-kind';
import {applySeen} from '../capture';
import {load,changed,current,startVisit,closeTab,allowed,recordEvent,type LiveVisit} from './live';
import {assign,visitEnded} from './projects';
/** Every page in every tab is a visit, kept for good: Chrome says when a navigation is committed (a link, an address
 * typed, back and forward, a form sent, a redirect), when an app that never reloads changes its route, and when a tab is
 * opened from another; each visit links to where it came from (the visit before it in the tab, or the one in the tab that
 * opened it), so a tab's trail and the chain across tabs can be walked back. A visit is timed while it lasts: active (in
 * front of the focused window, the user not idle), visible (in front in its window), and read (text in view, from the
 * page); when it ends, what was read is added to its passages. Tabs open before Gumbo started get a visit when they are
 * looked at. Nothing from incognito windows, the browser's own pages, or sites where Gumbo is off. */
const MINUTE=60_000;
/** Where a page is: its address without a lone #anchor or tracking parameters (a route in the hash is kept). */
export function placeOf(url:string){
 try{const u=new URL(url);for(const k of [...u.searchParams.keys()])if(/^(utm_|fbclid$|gclid$|mc_|si$|ref_src$)/i.test(k))u.searchParams.delete(k);const h=u.hash.slice(1),route=/^[/!]/.test(h)||h.includes('/')?'#'+h:'';return u.origin+u.pathname+u.search+route;}
 catch{return url;}
}
/** One thing at a time per tab: a redirect, the commit and the title come close together. */
const queues=new Map<number,Promise<void>>();
function inTab(tab:number,work:()=>Promise<void>){const next=(queues.get(tab)??Promise.resolve()).then(work).catch(()=>{});queues.set(tab,next);void next.finally(()=>{if(queues.get(tab)===next)queues.delete(tab);});return next;}
const openers=new Map<number,{tab:number;visit?:number}>();

const record=(v:LiveVisit,tab:number,window:number,session:number):Visit=>({tab,window,session,url:v.url,site:v.site,title:v.title,pageKind:v.pageKind,kind:v.kind,in:v.in,out:v.out,activeMs:Math.round(v.activeMs),visibleMs:Math.round(v.visibleMs),readMs:Math.round(v.readMs),from:v.from,opener:v.opener,transition:v.transition,events:v.events,project:v.project,source:'browser'});
async function persist(tab:number,v:LiveVisit){
 if(v.id===undefined)return;const s=await load();
 try{await save('visits',{...record(v,tab,s.tabs[tab]?.window??-1,s.session),id:v.id});}catch{}
}
/** Adds the time since the clocks last ran to the visits they time, and restarts them. */
async function settle(now=Date.now()){
 const s=await load(),cap=30*MINUTE;
 if(s.front){const v=await current(s.front.tab);if(v)v.activeMs+=Math.max(0,Math.min(now-s.front.since,cap));s.front.since=now;}
 for(const c of Object.values(s.shown??{})){const v=await current(c.tab);if(v)v.visibleMs+=Math.max(0,Math.min(now-c.since,cap));c.since=now;}
 changed();
}
/** Which tabs the clocks follow now: each window's shown tab, and the focused window's while the user is not idle. */
async function retime(){
 await settle();
 const s=await load(),[focused,shown]=await Promise.all([chrome.windows.getLastFocused().catch(()=>undefined),chrome.tabs.query({active:true}).catch(()=>[] as chrome.tabs.Tab[])]),now=Date.now();
 s.shown={};for(const t of shown)if(t.id!==undefined&&!t.incognito)s.shown[t.windowId]={tab:t.id,since:now};
 const front=focused?.focused&&!s.idle?shown.find(t=>t.windowId===focused.id&&!t.incognito):undefined;
 s.front=front?.id!==undefined?{tab:front.id,since:now}:undefined;changed();
}
async function end(tab:number,at=Date.now()){
 const v=await current(tab);if(!v)return;
 v.out=at;changed();await persist(tab,v);
 if(v.id!==undefined&&Object.keys(v.seen).length)void applySeen(v.url,v.id,v.seen).catch(()=>{});
 void (placing.get(v)??Promise.resolve()).then(()=>visitEnded(v)).catch(()=>{});
}
async function begin(tab:number,url:string,transition:string,from?:number){
 const t=await chrome.tabs.get(tab).catch(()=>undefined);
 await settle();await end(tab);
 if(!t||!await allowed(url,t.incognito))return;
 const s=await load(),opener=openers.get(tab);openers.delete(tab);
 // Before a page loads, Chrome's title for it is its address: not a title.
 const title=t.url===url&&t.title&&!url.replace(/^\w+:\/\//,'').startsWith(t.title.replace(/^\w+:\/\//,'').slice(0,20))?t.title:'';
 const v:LiveVisit={url,title,site:siteOf(url),pageKind:pageKindOf(url),kind:categoryOf(url,title),in:Date.now(),activeMs:0,visibleMs:0,readMs:0,from:from??opener?.visit,opener:opener?.tab,transition,events:0,seen:{}};
 await startVisit(tab,t.windowId,v);
 try{v.id=await add('visits',record(v,tab,t.windowId,s.session)) as number;changed();}catch{return;}
 // Its project, from what its title means and the chain it came along (projects.ts): at once when the title is known,
 // else when it arrives (a page's title usually comes a moment after it is reached), three seconds at most.
 if(v.title)placeIt(tab,v);else setTimeout(()=>placeIt(tab,v),3000);
}
/** Visits being placed in a project: one left before its placement is done (quick browsing) is counted once it is. */
const placing=new WeakMap<LiveVisit,Promise<void>>();
function placeIt(tab:number,v:LiveVisit){
 if(placing.has(v)||v.out!==undefined&&!v.title)return;
 placing.set(v,assign(tab,v).then(()=>{if(v.project)return persist(tab,v);}).catch(()=>{}));
}
/** The visits of the tabs being timed, saved as they stand (a browser that quits keeps them). */
async function flush(){
 await settle();const s=await load(),tabs=new Set([s.front?.tab,...Object.values(s.shown??{}).map(c=>c.tab)].filter((t):t is number=>t!==undefined));
 for(const tab of tabs){const v=await current(tab);if(v)await persist(tab,v);}
}

chrome.webNavigation.onCommitted.addListener(d=>{
 if(d.frameId!==0)return;
 void inTab(d.tabId,async()=>{
  const v=await current(d.tabId),q=d.transitionQualifiers??[];
  // A redirect a moment after the page was reached is the same visit, at its final address.
  if(v&&(q.includes('client_redirect')||q.includes('server_redirect'))&&Date.now()-v.in<5000){
   const t=await chrome.tabs.get(d.tabId).catch(()=>undefined);
   if(!t||!await allowed(d.url,t.incognito)){await end(d.tabId);return;}
   Object.assign(v,{url:d.url,site:siteOf(d.url),pageKind:pageKindOf(d.url),kind:categoryOf(d.url,v.title)});changed();await persist(d.tabId,v);return;
  }
  if(v&&d.transitionType==='reload'&&placeOf(v.url)===placeOf(d.url))return;
  await begin(d.tabId,d.url,[d.transitionType,...q.filter(x=>x==='forward_back'||x==='from_address_bar')].join(' '),v?.id);
 });
});
/** A route in an app that never reloads (its history or its #route changed): a new visit when the place changed. */
function routed(d:{tabId:number;frameId:number;url:string}){
 if(d.frameId!==0)return;
 void inTab(d.tabId,async()=>{const v=await current(d.tabId);if(v&&placeOf(v.url)===placeOf(d.url)){if(v.url!==d.url){v.url=d.url;changed();}return;}await begin(d.tabId,d.url,'route',v?.id);});
}
chrome.webNavigation.onHistoryStateUpdated.addListener(routed);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(routed);
chrome.webNavigation.onCreatedNavigationTarget.addListener(d=>{void inTab(d.tabId,async()=>{openers.set(d.tabId,{tab:d.sourceTabId,visit:(await current(d.sourceTabId))?.id});if(openers.size>100)openers.delete(openers.keys().next().value!);});});
chrome.tabs.onUpdated.addListener((tab,change)=>{if(change.title)void inTab(tab,async()=>{const v=await current(tab);if(v&&change.title){v.title=change.title.slice(0,200);changed();if(v.id!==undefined)placeIt(tab,v);}});});
chrome.tabs.onRemoved.addListener(tab=>{void inTab(tab,async()=>{await settle();await end(tab);await closeTab(tab);});openers.delete(tab);});
chrome.tabs.onActivated.addListener(({tabId})=>{
 void inTab(tabId,async()=>{
  await retime();
  const t=await chrome.tabs.get(tabId).catch(()=>undefined);if(!t?.url||!await allowed(t.url,t.incognito))return;
  // A tab open from before (Gumbo started after it) gets its visit when it is looked at.
  const v=await current(tabId)??(await begin(tabId,t.url,'existing'),await current(tabId));
  // Switching to it is a step: which tab follows which is a habit like any other.
  if(v)void recordEvent(tabId,{site:v.site,pageKind:v.pageKind,url:v.url,kind:'switch',role:'tab',name:v.title.slice(0,120),title:v.title,at:Date.now()});
 });
});
chrome.windows.onFocusChanged.addListener(()=>void retime());
chrome.idle.setDetectionInterval(120);
chrome.idle.onStateChanged.addListener(state=>{void load().then(s=>{s.idle=state!=='active';return retime();});});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='visits-flush')void flush();});
void chrome.alarms.get('visits-flush').then(alarm=>{if(!alarm)void chrome.alarms.create('visits-flush',{periodInMinutes:1});});
void retime();
export {flush as flushVisits};
