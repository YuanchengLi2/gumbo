import {recent} from './db';
import {lately} from './lately';
import {loadSettings,activeOn,siteOf,type Settings} from '../shared/settings';
import {shortUrl,searchOf} from '../shared/address';
/** The user's browser as the agent knows it, the way a code editor knows the open files and the recent edits: every open
 * tab in every window (its id, title, address, group, when it was last looked at, whether it is playing, and a line of
 * what it holds, from memory), the tabs closed lately, today's trail of pages (how long each held them) and searches,
 * and what they just copied and wrote. Built fresh for each request from Chrome and from memory, all on this computer;
 * tabs on sites where Gumbo is off show as that and nothing more. */
const MINUTE=60_000,HOUR=60*MINUTE;
const ago=(at:number)=>{const m=Math.round((Date.now()-at)/MINUTE);return m<1?'just now':m<60?`${m} min ago`:m<48*60?`${Math.round(m/60)} h ago`:`${Math.round(m/1440)} days ago`;};
const clockOf=(at:number)=>new Date(at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
const squash=(s:string)=>s.replace(/\s+/g,' ').trim();
const cut=(s:string,n:number)=>s.length>n?s.slice(0,n-1)+'…':s;
const allowed=(settings:Settings,url?:string)=>!!url&&/^(https?|file):/.test(url)&&activeOn(settings,siteOf(url));

let gistCache:{at:number;pages:Map<string,{title:string;text:string;visibleMs:number;lastSeen:number}>}|undefined;
/** The pages memory holds from the last day (their opening words and the time spent on them), briefly cached. */
async function gists(){
 if(gistCache&&Date.now()-gistCache.at<20_000)return gistCache.pages;
 const pages=new Map<string,{title:string;text:string;visibleMs:number;lastSeen:number}>();
 for(const p of await recent('pages',60,Date.now()-24*HOUR).catch(()=>[]))pages.set(p.url,{title:p.title,text:cut(squash(p.text),180),visibleMs:p.visibleMs,lastSeen:p.lastSeen});
 gistCache={at:Date.now(),pages};return pages;
}
async function groupNames(tabs:chrome.tabs.Tab[]){
 const names=new Map<number,string>();
 for(const id of new Set(tabs.map(t=>t.groupId).filter(g=>g!==undefined&&g>=0)))try{const g=await chrome.tabGroups.get(id!);names.set(id!,g.title||g.color);}catch{}
 return names;
}

/** Every open tab, window by window (the one in front first), most of them one line each; the ones looked at most
 * recently also say what they hold. */
export async function openTabs(options:{here?:number;opened?:Set<number>;gistsFor?:number}={}):Promise<string>{
 const settings=await loadSettings(),[windows,front,pages]=await Promise.all([chrome.windows.getAll({populate:true,windowTypes:['normal']}),chrome.windows.getLastFocused().catch(()=>undefined),gists()]);
 const live=windows.filter(w=>!w.incognito&&w.tabs?.length).sort((a,b)=>Number(b.id===front?.id)-Number(a.id===front?.id));
 const all=live.flatMap(w=>w.tabs!),groups=await groupNames(all);
 // A line of what is in it, for the tabs looked at most recently.
 const withGist=new Set(all.filter(t=>allowed(settings,t.url)).sort((a,b)=>(b.lastAccessed??0)-(a.lastAccessed??0)).slice(0,options.gistsFor??10).map(t=>t.id));
 // A very full browser keeps the 90 tabs looked at most recently, in their window order.
 const keep=new Set(all.slice().sort((a,b)=>(b.lastAccessed??0)-(a.lastAccessed??0)).slice(0,90).map(t=>t.id));
 const lines=[`Open tabs (${all.length} in ${live.length} window${live.length===1?'':'s'}; their ids work with read_page, switch_tab and close_tab):`];
 live.forEach((w,i)=>{
  lines.push(`Window ${i+1}${w.id===front?.id?' (in front)':''}:`);
  for(const t of w.tabs!){
   if(!keep.has(t.id))continue;
   if(!allowed(settings,t.url)){lines.push(`- ${t.id} ${/^(https?|file):/.test(t.url??'')?'(a site where Gumbo is off)':`(a browser page: ${cut(t.title||'',40)})`}`);continue;}
   const notes=[t.id===options.here?'they are here':t.active?'shown in its window':'',t.pinned?'pinned':'',t.groupId!==undefined&&t.groupId>=0&&groups.get(t.groupId)?`group “${groups.get(t.groupId)}”`:'',t.audible?'playing sound':'',t.discarded?'asleep':'',options.opened?.has(t.id!)?'you opened it':'',t.lastAccessed?`looked at ${ago(t.lastAccessed)}`:''].filter(Boolean);
   lines.push(`- ${t.id} "${cut(t.title||'',90)}" ${shortUrl(t.url!)}${notes.length?` · ${notes.join(' · ')}`:''}`);
   const g=withGist.has(t.id)?pages.get(t.url!):undefined;
   if(g?.text)lines.push(`   ↳ ${g.text}`);
  }
 });
 if(all.length>keep.size)lines.push(`(${all.length-keep.size} more tabs not looked at in a long while)`);
 return lines.join('\n');
}
/** Tabs closed lately (restorable by their session id). */
export async function closedTabs(limit=10):Promise<{lines:string[];items:{id:string;title:string;url:string;at:number}[]}>{
 const settings=await loadSettings(),items:{id:string;title:string;url:string;at:number}[]=[];
 for(const s of await chrome.sessions.getRecentlyClosed({maxResults:25}).catch(()=>[] as chrome.sessions.Session[])){
  const tabs=s.tab?[s.tab]:s.window?.tabs??[];
  for(const t of tabs)if(t.sessionId&&allowed(settings,t.url))items.push({id:t.sessionId,title:t.title??'',url:t.url!,at:s.lastModified*1000});
 }
 const top=items.slice(0,limit);
 return{items:top,lines:top.map(c=>`- "${cut(c.title,90)}" ${shortUrl(c.url)} · closed ${ago(c.at)} (reopen_tab "${c.id}")`)};
}
/** Today's trail, newest first: the pages they went to (with the time spent where memory knows it) and their searches. */
export async function trail(limit=25,hours=12):Promise<string[]>{
 const settings=await loadSettings(),pages=await gists();
 const items=(await chrome.history.search({text:'',startTime:Date.now()-hours*HOUR,maxResults:300}).catch(()=>[] as chrome.history.HistoryItem[]))
  .filter(i=>allowed(settings,i.url)).sort((a,b)=>(b.lastVisitTime??0)-(a.lastVisitTime??0));
 const out:string[]=[],seen=new Set<string>();
 for(const i of items){
  if(out.length>=limit)break;
  const query=searchOf(i.url!),key=query?`q:${query}`:i.title||i.url!;if(seen.has(key))continue;seen.add(key);
  const read=pages.get(i.url!)?.visibleMs??0;
  out.push(query?`- ${clockOf(i.lastVisitTime!)} searched “${query}” on ${siteOf(i.url!)}`:`- ${clockOf(i.lastVisitTime!)} "${cut(i.title||'',80)}" ${shortUrl(i.url!)}${read>=60_000?` (read ${Math.round(read/MINUTE)} min)`:''}${(i.visitCount??0)>=5?` · visited ${i.visitCount} times`:''}`);
 }
 return out;
}
/** What they wrote in the last hour (the start of it), anywhere. */
async function writing():Promise<string[]>{
 const settings=await loadSettings();
 return(await recent('writing',4,Date.now()-HOUR).catch(()=>[])).filter(w=>activeOn(settings,w.site)).map(w=>`- ${ago(w.at)} in ${w.label||w.intent} on ${w.site}: “${cut(squash(w.text),160)}”`);
}

/** All of it, as one block of a message to the agent. */
export async function workspace(options:{here?:number;opened?:Set<number>}={}):Promise<string>{
 const [tabs,closed,today,before,wrote]=await Promise.all([openTabs(options),closedTabs(),trail(),lately(),writing()]);
 const copied=before.copied.slice().reverse().map(c=>`- ${ago(c.at)}, on “${cut(c.title,60)}”: “${cut(squash(c.text),300)}”`);
 return['<your_browser>',tabs,closed.lines.length?`\nClosed lately:\n${closed.lines.join('\n')}`:'',today.length?`\nToday, newest first:\n${today.join('\n')}`:'',copied.length?`\nThey copied:\n${copied.join('\n')}`:'',wrote.length?`\nThey wrote:\n${wrote.join('\n')}`:'','</your_browser>'].filter(Boolean).join('\n');
}
/** The open tabs in a few lines (titles and sites), for the quick surfaces: Tab and Ctrl+K. */
export async function tabsBrief(here?:string,limit=15):Promise<string>{
 const settings=await loadSettings(),tabs=(await chrome.tabs.query({}).catch(()=>[] as chrome.tabs.Tab[])).filter(t=>!t.incognito&&allowed(settings,t.url)&&t.url!==here);
 tabs.sort((a,b)=>(b.lastAccessed??0)-(a.lastAccessed??0));
 return tabs.slice(0,limit).map(t=>`- "${cut(t.title||'',70)}" ${shortUrl(t.url!)}`).join('\n');
}
/** Their browsing history searched by words in titles and addresses, over the last days, with the tabs closed lately. */
export async function searchHistory(query:string,days=30):Promise<string>{
 const settings=await loadSettings(),words=query.toLowerCase().split(/\s+/).filter(Boolean);
 const items=(await chrome.history.search({text:query,startTime:Date.now()-days*24*HOUR,maxResults:60}).catch(()=>[] as chrome.history.HistoryItem[])).filter(i=>allowed(settings,i.url)).sort((a,b)=>(b.lastVisitTime??0)-(a.lastVisitTime??0)).slice(0,30);
 const closed=(await closedTabs(25)).items.filter(c=>words.every(w=>`${c.title} ${c.url}`.toLowerCase().includes(w)));
 const lines=[...closed.map(c=>`- closed ${ago(c.at)}: "${cut(c.title,90)}" ${c.url} (reopen_tab "${c.id}")`),...items.map(i=>`- "${cut(i.title||'',90)}" ${i.url} · last visited ${ago(i.lastVisitTime??0)}${(i.visitCount??0)>1?` · ${i.visitCount} visits`:''}`)];
 return lines.length?lines.join('\n'):'Nothing in their history matches.';
}
