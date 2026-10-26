/// <reference types="chrome" />
import {on} from './surfaces';
import {offscreen,hasOffscreen} from './offscreen';
import {getMedia,add,type Voice} from './db';
import {writeNotes} from './notes';
import {invalidate} from './recall';
import {loadSettings,listensOn,activeOn,blockedSite,siteOf} from '../shared/settings';
/** Listening, in the engine: which tab and frame each recording belongs to (kept in session storage, since the worker
 * naps while a long video plays), starting and stopping them in the offscreen document, the toolbar badge, captions
 * passed on to the tab's top frame (its pill), notes when one ends, and Alt+Shift+L for the whole tab. */
type Live={session:string;tabId:number;frameId:number;source:'page'|'tab'|'cues';title:string;kind:string;startedAt:number};
const KEY='listening';
async function all():Promise<Record<string,Live>>{return((await chrome.storage.session.get(KEY))[KEY]??{}) as Record<string,Live>;}
async function put(live:Live){const a=await all();a[live.session]=live;await chrome.storage.session.set({[KEY]:a});}
async function drop(session:string){const a=await all(),live=a[session];delete a[session];await chrome.storage.session.set({[KEY]:a});return live;}
const toTop=(tabId:number,message:Record<string,unknown>)=>void chrome.tabs.sendMessage(tabId,{type:'captions',...message},{frameId:0}).catch(()=>{});
async function badge(tabId:number,on:boolean){
 await chrome.action.setBadgeText({tabId,text:on?'●':''}).catch(()=>{});
 if(on)await chrome.action.setBadgeBackgroundColor({tabId,color:'#1d1d1d'}).catch(()=>{});
}

on('listen.begin',async(m:{id:string;kind:'meeting'|'video'|'audio';title:string;source:'page'|'cues'},{send,tabId,frameId,url})=>{
 const no=(reason:string)=>send({type:'listen.started',id:m.id,ok:false,reason});
 if(tabId===undefined)return no('no tab');
 const tab=await chrome.tabs.get(tabId).catch(()=>undefined),settings=await loadSettings(),site=siteOf(tab?.url??url);
 if(!tab||tab.incognito||!listensOn(settings,site)||!listensOn(settings,siteOf(url)))return no('off');
 const live=Object.values(await all());
 if(live.some(l=>l.tabId===tabId)||live.length>=3)return no('busy');
 const fake=(globalThis as any).gumbo?.fakeListening as string[]|undefined;
 const title=tab.title||m.title||site;
 const r=await offscreen({type:'listen.start',session:m.id,kind:m.kind,title,url:tab.url??url,site,source:m.source,mic:m.kind==='meeting'&&settings.mic,fake}).catch(error=>({ok:false,reason:String(error)}));
 if(!r?.ok)return no(r?.reason??'failed');
 await put({session:m.id,tabId,frameId:frameId??0,source:m.source,title,kind:m.kind,startedAt:Date.now()});
 await badge(tabId,true);toTop(tabId,{session:m.id,title,started:true});
 send({type:'listen.started',id:m.id,ok:true});
});
on('listen.end',async(m:{session:string})=>{await stop(m.session,false);});
on('listen.stop',async(m:{session:string})=>{await stop(m.session,true);});
on('listen.hint',async(m:{text:string},{tabId})=>{if(tabId!==undefined)toTop(tabId,{hint:m.text});});

/** Stops a recording; when the user stopped it, the frame that hears it is told to let go of that media for good. */
export async function stop(session:string,byUser:boolean){
 const live=(await all())[session];
 if(byUser&&live)void chrome.tabs.sendMessage(live.tabId,{type:'listen.halt',session},{frameId:live.frameId}).catch(()=>{});
 if(await hasOffscreen())await offscreen({type:'listen.stop',session}).catch(()=>{});
 // No offscreen document (it closed): nothing is listening, so the recording is over as it was last saved.
 else await ended(session);
}
let lastInvalidate=0;
async function ended(session:string,lines?:number){
 const live=await drop(session);
 if(live){await badge(live.tabId,false);toTop(live.tabId,{session,ended:true,lines});}
 if(lines===0)return;
 invalidate();
 const notes=await writeNotes(session).catch(()=>undefined);
 if(notes){invalidate();void chrome.runtime.sendMessage({type:'listen.notes',media:session,notes}).catch(()=>{});}
}
// What the offscreen document says while it listens.
chrome.runtime.onMessage.addListener((message,sender)=>{
 if(sender.id!==chrome.runtime.id||!sender.url?.endsWith('/offscreen.html'))return;
 void (async()=>{
  const live=(await all())[message.session];
  switch(message.type){
   case 'listen.caption':
    if(live)toTop(live.tabId,{session:message.session,title:message.title,segment:message.segment});
    // Tab's memory of what was heard lately catches up once a minute.
    if(Date.now()-lastInvalidate>60_000){lastInvalidate=Date.now();invalidate();}
    break;
   // What is being said right now, before it is a line (the side panel hears it from the offscreen document too).
   case 'listen.partial':if(live)toTop(live.tabId,{session:message.session,title:message.title,partial:{speaker:message.speaker,text:message.text}});break;
   case 'listen.progress':if(live)toTop(live.tabId,{session:message.session,progress:message.percent});break;
   case 'listen.ended':await ended(message.session,message.lines);break;
   case 'listen.failed':
    if(live)toTop(live.tabId,{hint:'Gumbo couldn’t start listening on this computer. It will try again next time.'});
    await add('failures',{site:'',editor:'listen',what:'audio',detail:String(message.reason),at:Date.now()}).catch(()=>{});
    void stop(message.session,false);break;
  }
 })();
});
chrome.tabs.onRemoved.addListener(tabId=>void all().then(a=>{for(const l of Object.values(a))if(l.tabId===tabId)void stop(l.session,false);}));

/** Alt+Shift+L (or the popup): the whole tab, for what the page's own media cannot give (a protected video, a site that
 * plays sound some other way). Pressed again, or on a tab already heard, it stops. */
export async function toggleTab(tab:chrome.tabs.Tab){
 if(tab.id===undefined)return{listening:false};
 const current=Object.values(await all()).find(l=>l.tabId===tab.id);
 if(current){await stop(current.session,true);return{listening:false};}
 const settings=await loadSettings(),site=siteOf(tab.url??'');
 if(tab.incognito||blockedSite(site)||!activeOn(settings,site))return{listening:false,reason:'off'};
 const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});
 const {kind}=await chrome.tabs.sendMessage(tab.id,{type:'listen.kind'},{frameId:0}).catch(()=>({kind:'video'})) as {kind:'meeting'|'video'};
 const session=crypto.randomUUID(),title=tab.title||site;
 const r=await offscreen({type:'listen.start',session,kind,title,url:tab.url??'',site,source:'tab',streamId,mic:kind==='meeting'&&settings.mic});
 if(!r?.ok)return{listening:false,reason:r?.reason};
 await put({session,tabId:tab.id,frameId:0,source:'tab',title,kind,startedAt:Date.now()});
 await badge(tab.id,true);toTop(tab.id,{session,title,started:true});
 return{listening:true,session};
}
chrome.commands.onCommand.addListener((command,tab)=>{if(command==='listen'&&tab)void toggleTab(tab).catch(error=>console.warn('Listening:',error));});

/** What is heard now, with its lines so far (for the side panel and the popup). */
export async function listenState(tabId?:number){
 const live=await all(),heard=await hasOffscreen()?await offscreen<{sessions:any[]}>({type:'listen.state'}).catch(()=>({sessions:[]})):{sessions:[]};
 return{sessions:heard.sessions.map(s=>({...s,tabId:live[s.session]?.tabId})),here:tabId===undefined?undefined:Object.values(live).find(l=>l.tabId===tabId)?.session};
}
/** Names a speaker ("Speaker 2 is Sarah"): their voice is remembered for next time, and the lines say the name. */
export async function nameSpeaker(m:{media:string;speaker:string;name:string}){
 const name=m.name.trim().slice(0,60);if(!name)return{ok:false};
 if(await hasOffscreen()){const r=await offscreen({type:'listen.name',session:m.media,speaker:m.speaker,name}).catch(()=>({ok:false}));if(r?.ok){invalidate();return r;}}
 const media=await getMedia(m.media);if(!media)return{ok:false};
 const print=media.speakers?.find(s=>s.name===m.speaker);
 if(print){const voice:Voice={id:crypto.randomUUID(),name,print:print.print,count:print.count};await add('voices',voice);print.name=name;}
 for(const s of media.segments)if(s.speaker===m.speaker)s.speaker=name;
 if(media.notes)media.notes=media.notes.split(m.speaker).join(name);
 await add('media',media);invalidate();return{ok:true};
}
