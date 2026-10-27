/// <reference types="chrome" />
import {session,signIn,finishSignIn,signOut,refresh,token} from './auth';
import {endpoints} from '../shared/config';
import {gatewayGet} from '../shared/gateway';
import {counts,forget,recent,recentTimings,getMedia} from './db';
import {stats} from './stats';
import type {Request} from '../shared/protocol';
import {connectSurfaces} from './surfaces';
import {model} from './model';
import {lock} from './vault';
import './tab';
import {capturePage} from './capture';
import './budget';
import './inline';
import './card';
import './memory-view';
import './predict';
import './drawn-tab';
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
  case 'memory.forget':await beforeForget().catch(()=>{});await forget({site:message.site,since:message.since});memoryReset();void syncNow({push:'force'});return{};
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
 }
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='refresh-session')void refresh();});
chrome.runtime.onInstalled.addListener(details=>{
 // A first install brings back settings from Chrome sync and opens the welcome page, which signs in and lets you try Tab.
 if(details.reason==='install'){void restoreSettings();void chrome.tabs.create({url:chrome.runtime.getURL('welcome.html')});}
});
connectSurfaces();
// For debugging and the end-to-end tests: the engine's parts, from the worker's console.
(globalThis as any).gumbo={sync:{now:syncNow,state:syncState},agent:agentDebug,importAssistantMemory,listenState,toggleTab,stopListening,writeNotes,nameSpeaker,search:searchMemory,offscreen,stats,capture:capturePage,measureActions,importHistory,db:{recent,recentTimings,counts},call:model,send:(tabId:number,message:unknown,frameId?:number)=>chrome.tabs.sendMessage(tabId,message,frameId===undefined?{}:{frameId})};
