import {on} from './surfaces';
import {add,getPage,removePassages,type Page} from './db';
import {invalidate,passagesOf} from './recall';
import {loadSettings,activeOn,siteOf} from '../shared/settings';
/** What pages hand to memory: the user's own writing, the pages they read (in full, as passages for search), what they
 * copied or highlighted. Nothing is kept from sites where Gumbo is off, blocked or paused, or from incognito windows;
 * everything goes into the sealed database (db.ts). */
const MAX_PAGE=200_000;
const lastWriting=new Map<string,string>();

async function allowed(url:string,incognito?:boolean){if(incognito)return false;const settings=await loadSettings();return activeOn(settings,siteOf(url));}

on('capture.writing',async(message:{key:string;intent:string;label:string;editor:string;text:string;replyTo?:string},{url,port})=>{
 if(!await allowed(url,port.sender?.tab?.incognito))return;
 const text=message.text.trim();if(text.length<12)return;
 // The same field sending the same words again (blur after send, a second blur) is one piece of writing.
 if(lastWriting.get(message.key)===text)return;lastWriting.set(message.key,text);if(lastWriting.size>500)lastWriting.delete(lastWriting.keys().next().value!);
 try{await add('writing',{site:siteOf(url),url,intent:message.intent,label:message.label.slice(0,160),editor:message.editor,text:text.slice(0,20_000),replyTo:message.replyTo?.slice(0,400),at:Date.now(),source:'browser'});invalidate();}catch{}
});

on('capture.page',async(message:{title:string;text:string;visibleMs:number},{url,port})=>{
 if(!await allowed(url,port.sender?.tab?.incognito))return;
 await capturePage({url,title:message.title,text:message.text,visibleMs:message.visibleMs});
});
/** Keeps a page (and its passages for search). */
export async function capturePage(message:{url:string;title:string;text:string;visibleMs?:number}){
 const url=message.url;
 try{
  const now=Date.now(),old=await getPage(url),text=message.text.slice(0,MAX_PAGE);
  const page:Page={url,site:siteOf(url),title:message.title.slice(0,300)||old?.title||url,text:text.length>=(old?.text.length??0)*0.6?text:old!.text,firstSeen:old?.firstSeen??now,lastSeen:now,visibleMs:(old?.visibleMs??0)+Math.max(0,message.visibleMs??0),visits:(old?.visits??0)+(message.visibleMs?0:1),highlights:old?.highlights??[],source:'browser'};
  await add('pages',page);
  // Passages are what search reads: re-cut when the text changed.
  if(page.text!==old?.text){
   await removePassages(url);
   for(const passage of passagesOf(page.text).slice(0,400))await add('passages',{ref:url,kind:'page',text:passage,at:now,site:page.site,title:page.title,url});
  }
  invalidate();
 }catch{}
}

on('capture.copy',async(message:{text:string},{url,port})=>{
 if(!await allowed(url,port.sender?.tab?.incognito))return;
 try{
  const page=await getPage(url);if(!page)return;
  const text=message.text.trim().slice(0,2000);if(!text||page.highlights.includes(text))return;
  page.highlights=[...page.highlights,text].slice(-50);page.lastSeen=Date.now();await add('pages',page);
 }catch{}
});
