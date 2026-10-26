/// <reference types="chrome" />
import {session,signIn,finishSignIn,signOut,refresh,token} from './auth';
import {endpoints} from '../shared/config';
import {gatewayGet} from '../shared/gateway';
import {counts,forget} from './db';
import {stats} from './stats';
import type {Request} from '../shared/protocol';
import {connectSurfaces} from './surfaces';
import {model} from './model';

/** The engine: sign-in, the gateway, memory and every surface. The worker sleeps when idle; what matters is kept in
 * storage and IndexedDB, so it picks up where it was when a page wakes it. */
chrome.runtime.onMessage.addListener((message:Request,sender,reply)=>{
 handle(message,sender).then(reply,error=>reply({error:(error as Error).message}));
 return true;
});
async function handle(message:Request,sender:chrome.runtime.MessageSender){
 switch(message.type){
  case 'auth.state':{const now=await session();return{signedIn:!!now,email:now?.user.email};}
  case 'auth.signin':await signIn();return{};
  case 'auth.signout':await signOut();return{};
  case 'auth.code':{
   const result=await finishSignIn(message.code,message.error);
   // The tab the sign-in came back to becomes Gumbo's welcome page, which says what happened.
   const page=chrome.runtime.getURL('welcome.html')+(result.ok?'?signed=1':'?error='+encodeURIComponent(result.message));
   if(sender.tab?.id!==undefined)await chrome.tabs.update(sender.tab.id,{url:page});
   return result;
  }
  case 'stats':return stats();
  case 'spend':{const bearer=await token();if(!bearer)return{signedIn:false};const {gateway}=await endpoints();const usage=await gatewayGet(gateway,bearer,'usage');return{todayUsd:(usage.todayCredits??0)/100,monthUsd:(usage.monthCredits??0)/100};}
  case 'memory.counts':return counts();
  case 'memory.forget':await forget({site:message.site,since:message.since});return{};
 }
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='refresh-session')void refresh();});
chrome.runtime.onInstalled.addListener(details=>{
 // A first install opens the welcome page, which signs in and lets you try Tab at once.
 if(details.reason==='install')void chrome.tabs.create({url:chrome.runtime.getURL('welcome.html')});
});
connectSurfaces();
// For debugging and the end-to-end tests: the engine's parts, from the worker's console.
(globalThis as any).gumbo={call:model,send:(tabId:number,message:unknown,frameId?:number)=>chrome.tabs.sendMessage(tabId,message,frameId===undefined?{}:{frameId})};
