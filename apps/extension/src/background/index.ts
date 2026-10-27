/// <reference types="chrome" />
import {session,signIn,finishSignIn,signOut,refresh,token} from './auth';
import {endpoints} from '../shared/config';
import {gatewayGet} from '../shared/gateway';
import {counts,forget,recent,recentTimings,getMedia,addTiming} from './db';
import {stats} from './stats';
import type {Request} from '../shared/protocol';
import {connectSurfaces} from './surfaces';
import {model} from './model';
import {lock} from './vault';
import './tab';
import './quick';
import {capturePage} from './capture';
import './budget';
import './inline';
import './card';
import './memory-view';
import './predict';
import './drawn-tab';
import './memory/live';
import {flushVisits} from './memory/visits';
import {snapshot as liveSnapshot} from './memory/live';
import {all as allProjects,calibrate,writeNote,forgetProjects} from './memory/projects';
import {profile,updateProfile,forgetProfile} from './memory/profile';
import {getContext,lastContexts} from './memory/context';
import {config} from './memory/config';
import {getSealed} from './db';
import {thrifty} from './thrift';
import {measureActions} from './actions';
import {importHistory,importState} from './history';
import {measureTab} from './meter';
import {memoryReset,searchMemory} from './search';
import {offscreen} from './offscreen';
import {importProfile,importAssistantMemory} from './imports';
import {restoreSettings} from '../shared/settings';
import {toggleTab,listenState,nameSpeaker,stop as stopListening} from './listen';
import {writeNotes} from './notes';
import {agentDebug} from './agent';
import {syncNow,syncState,account as syncAccount,setUp,join,startOver,turnOff,deleteSynced,beforeForget} from './sync';

/** The engine: sign-in, the gateway, memory and every surface. The worker sleeps when idle; what matters is kept in
 * storage and IndexedDB, so it picks up where it was when a page wakes it. */
chrome.runtime.onMessage.addListener((message:Request,sender,reply)=>{
 // Pages' audio for the offscreen document, and what it reports, are not the worker's to answer.
 if((message as any)?.target==='offscreen'||sender.url?.endsWith('/offscreen.html'))return;
 handle(message,sender).then(reply,error=>reply({error:(error as Error).message}));
 return true;
});
async function handle(message:Request,sender:chrome.runtime.MessageSender){
 switch(message.type){
  case 'auth.state':{const now=await session();return{signedIn:!!now,email:now?.user.email};}
  case 'auth.signin':await signIn();return{};
  case 'auth.signout':await signOut();await lock();return{};
  case 'auth.code':{
   const result=await finishSignIn(message.code,message.error);
   // The first sign-in brings in what the user already has (history, bookmarks), in the background.
   if(result.ok){void importProfile().catch(()=>{});void importState().then(s=>{if(s.state==='idle')void importHistory().catch(()=>{});}).catch(()=>{});}
   // The tab the sign-in came back to becomes Gumbo's welcome page, which says what happened.
   const page=chrome.runtime.getURL('welcome.html')+(result.ok?'?signed=1':'?error='+encodeURIComponent(result.message));
   if(sender.tab?.id!==undefined)await chrome.tabs.update(sender.tab.id,{url:page});
   return result;
  }
  case 'stats':return stats();
  case 'failures':return recent('failures',30);
  case 'spend':{const bearer=await token();if(!bearer)return{signedIn:false};const {gateway}=await endpoints();const [usage,saving]=await Promise.all([gatewayGet(gateway,bearer,'usage'),thrifty()]);return{todayUsd:(usage.todayCredits??0)/100,monthUsd:(usage.monthCredits??0)/100,thrifty:saving};}
  case 'memory.counts':return counts();
  // While sync is on, what is forgotten here is forgotten on the user's other computers too, at once.
  case 'memory.forget':await beforeForget().catch(()=>{});await forget({site:message.site,since:message.since});memoryReset();forgetProjects();forgetProfile();void syncNow({push:'force'});return{};
  case 'sync.state':return syncState();
  case 'sync.account':return syncAccount();
  case 'sync.setup':return setUp(message.passphrase);
  case 'sync.join':return join(message.passphrase);
  case 'sync.startover':return startOver(message.passphrase);
  case 'sync.now':void syncNow();return{};
  case 'sync.off':await turnOff();return{};
  case 'sync.delete':await deleteSynced();return{};
  case 'meter.run':return measureTab(message.count);
  case 'meter.actions':return measureActions();
  case 'import.run':return importHistory();
  case 'import.state':return importState();
  case 'import.memory':return importAssistantMemory(message.text);
  case 'listen.toggle':{const tab=await chrome.tabs.get(message.tabId);return toggleTab(tab);}
  case 'listen.state':return listenState(message.tabId);
  case 'listen.name':return nameSpeaker(message);
  case 'listen.recent':return{items:(await recent('media',60)).map(m=>({id:m.id,title:m.title,url:m.url,kind:m.kind,startedAt:m.startedAt,endedAt:m.endedAt,seconds:Math.round((m.segments.at(-1)?.end??0)-(m.segments[0]?.start??0)),lines:m.segments.length,notes:!!m.notes}))};
  case 'listen.media':return(await getMedia(message.id))??null;
  case 'debug.memory':return debugMemory();
  case 'debug.calibrate':return calibrate();
 }
}
/** Everything memory holds and did, for the debug page: the session, projects, profile, what each surface was last given
 * and why, the numbers in effect, and how fast and how often each surface ran (from the timings on this computer). */
async function debugMemory(){
 const [live,projects,me,cfg,calibration,timings,count]=await Promise.all([liveSnapshot(),allProjects().then(m=>[...m.values()]).catch(()=>[]),profile().catch(()=>undefined),config(),getSealed('calibration').catch(()=>undefined),recentTimings(5000,Date.now()-7*86_400_000).catch(()=>[]),counts()]);
 const by=new Map<string,number[]>();for(const t of timings)by.set(t.surface,[...(by.get(t.surface)??[]),t.ms]);
 const pct=(xs:number[],p:number)=>{const y=[...xs].sort((a,b)=>a-b);return y.length?Math.round(y[Math.floor(p*(y.length-1))]):undefined;};
 const speed=Object.fromEntries([...by].map(([s,xs])=>[s,{n:xs.length,p50:pct(xs,0.5),p90:pct(xs,0.9)}]));
 // What each surface cost today, and how many calls it made.
 const today=new Date().setHours(0,0,0,0),cost:Record<string,{calls:number;usd:number}>={};
 for(const t of timings)if(t.at>=today&&t.usd!==undefined){const c=cost[t.surface]??={calls:0,usd:0};c.calls++;c.usd+=t.usd;}
 return{live,projects:projects.map(({centroid,noteInput,...p})=>p),profile:me,contexts:lastContexts(),config:cfg,calibration,speed,cost,counts:count};
}
/** Alt+Q, when Chrome hands it to Gumbo as a command: passed to the frame with the focus in the tab in front, which takes
 * what Tab shows there exactly as the key would. How long that hop takes is kept (the debug page's "take"): taking a
 * suggestion must feel as quick as a key the page handles itself. Where no page of Gumbo's can be (the browser's own
 * pages, a new tab), nothing happens: a move is only ever taken where it was shown. */
chrome.commands.onCommand.addListener((command,tab)=>{if(command==='take')void take(tab);});
async function take(tab?:chrome.tabs.Tab){
 const started=performance.now();
 const t=tab?.id!==undefined?tab:(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0];if(t?.id===undefined)return;
 // Only a page with the keyboard focus takes it: Alt+Q pressed in Chrome's own UI, or with the page not focused, does
 // nothing (a move is taken only where the user is looking at it).
 const done=await chrome.tabs.sendMessage(t.id,{type:'take'}).catch(()=>undefined);
 if(done)void addTiming({surface:'take',ms:performance.now()-started,at:Date.now()});
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='refresh-session')void refresh();});
chrome.runtime.onInstalled.addListener(details=>{
 // A first install brings back settings from Chrome sync and opens the welcome page, which signs in and lets you try Tab.
 if(details.reason==='install'){void restoreSettings();void chrome.tabs.create({url:chrome.runtime.getURL('welcome.html')});}
 // Chrome adds Gumbo only to pages loaded from now on: the tabs already open get it at once, so it works there without a
 // reload (after an update, their old copy is cut off from the engine).
 if(details.reason==='install'||details.reason==='update')void intoOpenTabs();
});
async function intoOpenTabs(){
 for(const tab of await chrome.tabs.query({url:['http://*/*','https://*/*']}))
  if(tab.id!==undefined&&!tab.discarded)await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['content.js']}).catch(()=>{});
}
connectSurfaces();
// For debugging and the end-to-end tests: the engine's parts, from the worker's console.
(globalThis as any).gumbo={sync:{now:syncNow,state:syncState},agent:agentDebug,importAssistantMemory,listenState,toggleTab,stopListening,writeNotes,nameSpeaker,search:searchMemory,offscreen,stats,capture:capturePage,measureActions,importHistory,db:{recent,recentTimings,counts},call:model,send:(tabId:number,message:unknown,frameId?:number)=>chrome.tabs.sendMessage(tabId,message,frameId===undefined?{}:{frameId}),
 memory:{live:liveSnapshot,flush:flushVisits,projects:async()=>[...(await allProjects()).values()],calibrate,writeNote,profile,updateProfile,context:getContext,debug:debugMemory}};
