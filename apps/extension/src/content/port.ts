/// <reference types="chrome" />
/** This frame's line to the engine: one port, opened when first needed and again after the worker restarts. */
let port:chrome.runtime.Port|undefined;const listeners=new Set<(message:any)=>void>();
function connect():chrome.runtime.Port|undefined{
 if(port)return port;
 try{
  port=chrome.runtime.connect({name:'gumbo'});
  port.onMessage.addListener(message=>{for(const listener of listeners)listener(message);});
  // The worker went to sleep or restarted: whatever was asked on this line will never be answered, so every surface hears
  // it (and stops waiting) as a message of its own.
  port.onDisconnect.addListener(()=>{port=undefined;void chrome.runtime.lastError;for(const listener of listeners)try{listener({type:'port.lost'});}catch{}});
  return port;
 }catch{return undefined;} // The extension was reloaded: this old content script is no longer connected to anything.
}
/** Whether this copy of Gumbo is still the extension's: after an update or a reload, a copy left in an open page is cut
 * off (its runtime has no id) and must let every key and click pass, so the new copy gets them. */
export const alive=()=>{try{return !!chrome.runtime?.id&&(globalThis as any).__gumboCopy===copy;}catch{return false;}};
/** This copy of Gumbo in the frame. Copies share the frame's extension world: the newest one started (an update puts a
 * fresh copy into pages already open) is the only one that acts, so two copies never draw over each other. */
const copy=Math.random().toString(36).slice(2);
export function claimFrame(){(globalThis as any).__gumboCopy=copy;}
export function post(message:Record<string,unknown>){try{connect()?.postMessage(message);}catch{port=undefined;try{connect()?.postMessage(message);}catch{}}}
export function listen(listener:(message:any)=>void){listeners.add(listener);return()=>listeners.delete(listener);}
/** A request that waits for one answer of a type (with the same id). */
export function ask<T=any>(message:Record<string,unknown>&{type:string},answer:string,timeoutMs=4000):Promise<T|null>{
 return new Promise(resolve=>{
  const done=(value:T|null)=>{clearTimeout(timer);stop();resolve(value);};
  const stop=listen(m=>{if(m?.type===answer&&(!('id' in message)||m.id===message.id))done(m);});
  const timer=setTimeout(()=>done(null),timeoutMs);post(message);
 });
}
