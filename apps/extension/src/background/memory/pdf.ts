import {offscreen} from '../offscreen';
import {capturePage} from '../capture';
import {readPicture} from './record';
import {allowed,current} from './live';
import {factsOfLines} from '../../shared/facts';
/** PDFs in memory. Chrome shows a PDF in its own viewer, where no extension's script runs, so nothing on the page can
 * record it: a tab whose page answers no Gumbo script and whose address serves a PDF is read from the file itself
 * (offscreen/pdf.ts), once the user has had it in front of them for two seconds, and kept as a page is (its text as
 * passages, its facts as facts, background/capture.ts). A scan (no words in the file) is read from a picture of the
 * screen instead (memory/record.ts). Each PDF once a day; nothing from incognito, blocked or paused sites. */
const LOOK_MS=2000,AGAIN_MS=86_400_000;
const read=new Map<string,number>();
let timer:ReturnType<typeof setTimeout>|undefined;
const isPdfAddress=(url:string)=>{try{return /\.pdf$/i.test(new URL(url).pathname);}catch{return false;}};
/** Whether the tab shows a PDF: its address says so, or (no Gumbo script answering in it) the file it serves does. */
async function showsPdf(tab:chrome.tabs.Tab):Promise<boolean>{
 const url=tab.url!;if(isPdfAddress(url))return true;
 const scripted=await chrome.tabs.sendMessage(tab.id!,{type:'ping'},{frameId:0}).then(()=>true,()=>false);if(scripted)return false;
 const head=await fetch(url,{method:'HEAD',credentials:'include'}).catch(()=>undefined);
 return /application\/pdf/i.test(head?.headers.get('content-type')??'');
}
async function look(tabId:number){
 const tab=await chrome.tabs.get(tabId).catch(()=>undefined);
 if(!tab?.active||!tab.url||!/^(https?|file):/.test(tab.url)||!await allowed(tab.url,tab.incognito))return;
 const url=tab.url;if(Date.now()-(read.get(url)??0)<AGAIN_MS||!await showsPdf(tab).catch(()=>false))return;
 // Still in front of them after a moment, in the focused window: they are reading it.
 const win=await chrome.windows.get(tab.windowId).catch(()=>undefined),now=await chrome.tabs.get(tabId).catch(()=>undefined);
 if(!win?.focused||!now?.active||now.url!==url)return;
 read.set(url,Date.now());if(read.size>500)read.delete(read.keys().next().value!);
 const visit=(await current(tabId))?.id;
 const pdf=await offscreen<{title?:string;pages:string[];error?:string}>({type:'pdf.read',url}).catch(()=>undefined);
 const title=(tab.title&&!/\.pdf$/i.test(tab.title)?tab.title:pdf?.title||tab.title||url).slice(0,200);
 const words=(pdf?.pages??[]).join('\n\n').trim();
 if(words.length<200){await readPicture(tab,url,title,[tab.width??1280,tab.height??800],visit);return;}
 const lines=(pdf?.pages??[]).flatMap((page,i)=>[{text:`Page ${i+1}`,heading:true},...page.split('\n').map(text=>({text}))]);
 await capturePage({url,title,text:(pdf?.pages??[]).map((page,i)=>`Page ${i+1}\n${page}`).join('\n\n'),facts:factsOfLines(lines).slice(0,200),visit});
}
/** A tab coming to the front, or finishing loading in front: a PDF there is read once they have looked a moment. */
function soon(tabId:number){clearTimeout(timer);timer=setTimeout(()=>void look(tabId).catch(()=>{}),LOOK_MS);}
chrome.tabs.onActivated.addListener(({tabId})=>soon(tabId));
chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{if(change.status==='complete'&&tab.active)soon(tabId);});
