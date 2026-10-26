import {vaultForOffscreen} from './db';
/** The offscreen document (src/offscreen): made when first needed, and asked things with {target:'offscreen'}. It has no
 * chrome.storage, so each request carries the account and its unwrapped memory key (memory only, as here). */
let creating:Promise<void>|undefined;
export async function hasOffscreen(){const contexts=await chrome.runtime.getContexts({contextTypes:[chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]});return contexts.length>0;}
export async function ensureOffscreen(){
 if(await hasOffscreen())return;
 creating??=chrome.offscreen.createDocument({url:'offscreen.html',reasons:[chrome.offscreen.Reason.WORKERS,chrome.offscreen.Reason.USER_MEDIA],justification:'Memory search and listening run on this computer.'}).catch(error=>{if(!/single offscreen/i.test(String(error)))throw error;}).finally(()=>{creating=undefined;});
 await creating;
}
export async function offscreen<T=any>(message:Record<string,unknown>&{type:string}):Promise<T>{
 await ensureOffscreen();
 const keys=await vaultForOffscreen().catch(()=>undefined);
 const answer=await chrome.runtime.sendMessage({target:'offscreen',...message,keys});
 if(answer?.error)throw new Error(answer.error);return answer as T;
}
/** Tells a running offscreen document that memory changed (never starts one just for that). */
export async function notifyOffscreen(type:'index.changed'|'index.reset'){if(await hasOffscreen()){const keys=await vaultForOffscreen().catch(()=>undefined);void chrome.runtime.sendMessage({target:'offscreen',type,keys}).catch(()=>{});}}
