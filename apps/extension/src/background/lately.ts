import {loadSettings,activeOn,siteOf} from '../shared/settings';
/** What the user did just before this moment, across tabs: the pages they went through and what they copied. The next
 * thing someone does often comes from the last tab (the address copied from an email goes into the shipping form, the
 * flight just looked up goes into the calendar), so Tab, Ctrl+K and the agent are always given it. It lives in the
 * worker and in the browser's session storage, which is gone when the browser closes; nothing from sites where Gumbo is
 * off, from incognito windows or from the browser's own pages. */
export type Seen={url:string;title:string;at:number};
export type Copied={text:string;title:string;url:string;at:number};
type State={pages:Seen[];copies:Copied[]};
let state:State|undefined,loading:Promise<State>|undefined;
const MINUTE=60_000;

async function load():Promise<State>{
 if(state)return state;
 return loading??=chrome.storage.session.get('lately').then(r=>state=(r.lately as State|undefined)??{pages:[],copies:[]}).catch(()=>state={pages:[],copies:[]}).finally(()=>{loading=undefined;});
}
let saveTimer:ReturnType<typeof setTimeout>|undefined;
const save=()=>{clearTimeout(saveTimer);saveTimer=setTimeout(()=>{if(state)void chrome.storage.session.set({lately:state}).catch(()=>{});},500);};
async function allowed(url:string,incognito?:boolean){return !incognito&&/^https?:/.test(url)&&activeOn(await loadSettings(),siteOf(url));}

export async function noteCopy(url:string,title:string,text:string){
 const s=await load(),clean=text.trim().slice(0,1500);if(!clean)return;
 s.copies=[...s.copies.filter(c=>c.text!==clean),{text:clean,title:title.slice(0,140),url,at:Date.now()}].slice(-5);save();
}
async function notePage(url:string,title:string){
 const s=await load(),last=s.pages.at(-1);
 if(last?.url===url){if(title)last.title=title.slice(0,140);return;}
 s.pages=[...s.pages.filter(p=>p.url!==url),{url,title:title.slice(0,140)||url,at:Date.now()}].slice(-12);save();
}
const seen=(tab:chrome.tabs.Tab)=>{if(tab.url&&tab.active)void allowed(tab.url,tab.incognito).then(ok=>{if(ok)void notePage(tab.url!,tab.title??'');});};
chrome.tabs.onActivated.addListener(({tabId})=>void chrome.tabs.get(tabId).then(seen).catch(()=>{}));
chrome.tabs.onUpdated.addListener((_id,change,tab)=>{if(change.status==='complete'||change.title)seen(tab);});

/** The pages before this one (the last half hour) and what they copied in the last quarter of an hour. */
export async function lately(here?:string):Promise<{pages:Seen[];copied:Copied[]}>{
 const s=await load(),now=Date.now();
 return{pages:s.pages.filter(p=>p.url!==here&&now-p.at<30*MINUTE).slice(-6),copied:s.copies.filter(c=>now-c.at<15*MINUTE).slice(-2)};
}
const ago=(at:number)=>{const m=Math.round((Date.now()-at)/MINUTE);return m<1?'just now':`${m} min ago`;};
/** As a block of a prompt (empty when there is nothing). */
export function latelyText(l:{pages:Seen[];copied:Copied[]}){
 const pages=l.pages.slice().reverse().map(p=>`- ${ago(p.at)}: ${p.title} (${siteOf(p.url)})`).join('\n');
 const copied=l.copied.slice().reverse().map(c=>`They copied ${ago(c.at)}, on “${c.title}”:\n${c.text}`).join('\n\n');
 return [pages&&`<pages_just_before_this>\n${pages}\n</pages_just_before_this>`,copied&&`<just_copied>\n${copied}\n</just_copied>`].filter(Boolean).join('\n');
}
/** What a prediction may take facts from: what they copied, and the titles of the pages they came from. */
export const latelyKnown=(l:{pages:Seen[];copied:Copied[]})=>[...l.copied.map(c=>`${c.title} ${c.text}`),...l.pages.map(p=>p.title)].join('\n');
