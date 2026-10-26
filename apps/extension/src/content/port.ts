/// <reference types="chrome" />
/** This frame's line to the engine: one port, opened when first needed and again after the worker restarts. */
let port:chrome.runtime.Port|undefined;const listeners=new Set<(message:any)=>void>();
function connect():chrome.runtime.Port|undefined{
 if(port)return port;
 try{
  port=chrome.runtime.connect({name:'gumbo'});
  port.onMessage.addListener(message=>{for(const listener of listeners)listener(message);});
  port.onDisconnect.addListener(()=>{port=undefined;void chrome.runtime.lastError;});
  return port;
 }catch{return undefined;} // The extension was reloaded: this old content script is no longer connected to anything.
}
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
