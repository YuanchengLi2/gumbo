import {on} from './surfaces';
/** What the user has been doing, tab by tab, across the pages of a tab: each page they arrived at and each step they took
 * there (clicked, typed, chose, pasted, copied, dragged, took a move). Tab reads it to know where a task is heading (a
 * course, then its assignments, then one assignment), and the words they write follow it. Kept in the browser session's
 * storage, so the worker sleeping loses nothing, and gone when the tab closes. Nothing leaves the computer but what a
 * guess sends. */
export type Done={at:number;kind:string;label:string;text?:string;title:string;site:string};
const KEEP=40;
let logs:Map<number,Done[]>|undefined,saving:ReturnType<typeof setTimeout>|undefined;
async function load(){
 if(logs)return logs;
 const stored=(await chrome.storage.session.get('doing').catch(()=>({})) as {doing?:Record<string,Done[]>}).doing??{};
 logs=new Map(Object.entries(stored).map(([tab,list])=>[Number(tab),list]));
 return logs;
}
function save(){clearTimeout(saving);saving=setTimeout(()=>void chrome.storage.session.set({doing:Object.fromEntries(logs??[])}).catch(()=>{}),1000);}

on('session.did',async(m:{kind:string;label:string;text?:string;title:string},{port,url})=>{
 const tab=port.sender?.tab?.id;if(tab===undefined||port.sender?.tab?.incognito||port.sender?.frameId)return;
 const all=await load(),list=all.get(tab)??[];
 let site='';try{site=new URL(url).hostname.replace(/^www\./,'');}catch{}
 const last=list.at(-1),entry:Done={at:Date.now(),kind:m.kind,label:m.label.slice(0,80),text:m.text?.slice(0,200),title:m.title.slice(0,100),site};
 // The same step again (typing on in the same field) replaces itself.
 if(last&&last.kind===entry.kind&&last.label===entry.label&&last.title===entry.title)list[list.length-1]=entry;else list.push(entry);
 if(list.length>KEEP)list.splice(0,list.length-KEEP);
 all.set(tab,list);save();
});
/** How the page now open in a tab was reached: by their own click a moment before (a step on the way somewhere). */
on('session.cameBy',async(_m:unknown,{port,send})=>{
 const tab=port.sender?.tab?.id,list=tab===undefined?[]:(await load()).get(tab)??[];
 const clicked=[...list].reverse().find(d=>d.kind!=='opened'&&d.kind!=='went to');
 send({type:'session.cameBy',click:!!clicked&&clicked.kind==='clicked'&&Date.now()-clicked.at<15_000,label:clicked?.label});
});
chrome.tabs.onRemoved.addListener(tab=>{void load().then(all=>{if(all.delete(tab))save();});});

const ago=(at:number)=>{const s=Math.round((Date.now()-at)/1000);return s<60?`${s}s ago`:`${Math.round(s/60)} min ago`;};
/** The last steps in a tab, oldest first, page by page, as a prompt block (empty when there are none). */
export async function doingText(tab:number|undefined,limit=15):Promise<string>{
 if(tab===undefined)return '';
 const list=((await load()).get(tab)??[]).filter(d=>Date.now()-d.at<30*60_000).slice(-limit);
 if(!list.length)return '';
 let page='';const lines:string[]=[];
 for(const d of list){
  if(d.title!==page){page=d.title;lines.push(`On “${d.title}” (${d.site}):`);}
  lines.push(`- ${ago(d.at)}: ${d.kind} ${d.label}${d.text?` “${d.text.slice(0,120)}”`:''}`);
 }
 return `<what_they_have_been_doing_in_this_tab>\n${lines.join('\n')}\n</what_they_have_been_doing_in_this_tab>`;
}
