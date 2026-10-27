import {on} from './surfaces';
import {add,save,getPage,removePassages,passagesOfRef,type Page} from './db';
import {invalidate,passagesOf} from './recall';
import {noteCopy,current,recordEvent} from './memory/live';
import {pageKindOf} from '../shared/learn';
import {noteWriting} from './memory/profile';
import {seenNow} from './memory/context';
import {loadSettings,activeOn,siteOf} from '../shared/settings';
/** What pages hand to memory: the user's own writing, the pages they read (in full, as passages for search, each tied
 * to the visit it was read on and how long it was in view), what they copied or highlighted. Nothing is kept from sites
 * where Gumbo is off, blocked or paused, or from incognito windows; everything goes into the sealed database (db.ts). */
const MAX_PAGE=200_000;
const lastWriting=new Map<string,string>();

/** Only the web is remembered: not Gumbo's own pages, not the browser's. */
async function allowed(url:string,incognito?:boolean){if(incognito||!/^(https?|file):/.test(url))return false;const settings=await loadSettings();return activeOn(settings,siteOf(url));}

on('capture.writing',async(message:{key:string;intent:string;label:string;editor:string;text:string;replyTo?:string},{url,port})=>{
 if(!await allowed(url,port.sender?.tab?.incognito))return;
 const text=message.text.trim();if(text.length<12)return;
 // The same field sending the same words again (blur after send, a second blur) is one piece of writing.
 if(lastWriting.get(message.key)===text)return;lastWriting.set(message.key,text);if(lastWriting.size>500)lastWriting.delete(lastWriting.keys().next().value!);
 const visit=port.sender?.tab?.id!==undefined?await current(port.sender.tab.id):undefined;
 try{await add('writing',{site:siteOf(url),url,intent:message.intent,label:message.label.slice(0,160),editor:message.editor,text:text.slice(0,20_000),replyTo:message.replyTo?.slice(0,400),at:Date.now(),source:'browser',visit:visit?.id,project:visit?.project});invalidate();void noteWriting();}catch{}
});

on('capture.page',async(message:{title:string;text:string;visibleMs:number},{url,port})=>{
 if(!await allowed(url,port.sender?.tab?.incognito))return;
 const visit=port.sender?.tab?.id!==undefined?await current(port.sender.tab.id):undefined;
 await capturePage({url,title:message.title,text:message.text,visibleMs:message.visibleMs,visit:visit?.id});
});
/** Keeps a page (and its passages for search). */
export async function capturePage(message:{url:string;title:string;text:string;visibleMs?:number;visit?:number}){
 const url=message.url;
 try{
  const now=Date.now(),old=await getPage(url),text=message.text.slice(0,MAX_PAGE);
  const page:Page={url,site:siteOf(url),title:message.title.slice(0,300)||old?.title||url,text:text.length>=(old?.text.length??0)*0.6?text:old!.text,firstSeen:old?.firstSeen??now,lastSeen:now,visibleMs:(old?.visibleMs??0)+Math.max(0,message.visibleMs??0),visits:(old?.visits??0)+(message.visibleMs?0:1),highlights:old?.highlights??[],source:'browser'};
  await add('pages',page);
  // Passages are what search reads: re-cut when the text changed (what was seen of the old ones is carried over).
  if(page.text!==old?.text){
   const before=old?await passagesOfRef(url).catch(()=>[]):[];
   const seenBefore=new Map(before.filter(p=>p.seenMs).map(p=>[p.text.slice(0,80),p.seenMs!]));
   await removePassages(url);
   for(const passage of passagesOf(page.text).slice(0,400))await add('passages',{ref:url,kind:'page',text:passage,at:now,site:page.site,title:page.title,url,visit:message.visit,seenMs:seenBefore.get(passage.slice(0,80))});
  }
  invalidate();
 }catch{}
}
/** What was read on a visit, when it ends: each block's time in view is added to the passage that holds it, so memory
 * knows which parts of a page were actually read, and for how long. */
export async function applySeen(url:string,visit:number,seen:Record<string,number>){
 const blocks=Object.entries(seen).filter(([,ms])=>ms>=500);if(!blocks.length)return;
 const passages=await passagesOfRef(url);if(!passages.length)return;
 const squash=(s:string)=>s.replace(/\s+/g,' ').trim();
 const texts=passages.map(p=>squash(p.text)),gained=new Map<number,number>();
 for(const [text,ms] of blocks){
  const probe=squash(text).slice(0,80);if(probe.length<8)continue;
  const i=texts.findIndex(t=>t.includes(probe));if(i>=0)gained.set(i,(gained.get(i)??0)+ms);
 }
 for(const [i,ms] of gained){const p=passages[i];if(p.id===undefined)continue;await save('passages',{...p,id:p.id,seenMs:(p.seenMs??0)+ms,visit:p.visit??visit});seenNow.set('p'+p.id,(p.seenMs??0)+ms);}
 if(gained.size)invalidate();
}

on('capture.copy',async(message:{text:string},{url,port})=>{
 if(!await allowed(url,port.sender?.tab?.incognito))return;
 const tab=port.sender?.tab?.id;
 void noteCopy(url,port.sender?.tab?.title??'',message.text);
 if(tab!==undefined)void recordEvent(tab,{site:siteOf(url),pageKind:pageKindOf(url),url,kind:'copy',role:'text',name:message.text.slice(0,60),title:port.sender?.tab?.title,at:Date.now()});
 try{
  const page=await getPage(url);if(!page)return;
  const text=message.text.trim().slice(0,2000);if(!text||page.highlights.includes(text))return;
  page.highlights=[...page.highlights,text].slice(-50);page.lastSeen=Date.now();await add('pages',page);
 }catch{}
});
