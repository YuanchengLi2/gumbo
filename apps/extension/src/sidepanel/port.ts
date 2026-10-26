/// <reference types="chrome" />
/** The panel's one line to the engine: a port that reconnects when the worker restarts; views listen for what they need. */
let port:chrome.runtime.Port|undefined;const listeners=new Set<(m:any)=>void>();
function connect(){
 if(port)return port;
 port=chrome.runtime.connect({name:'gumbo'});
 port.onMessage.addListener(m=>{for(const l of listeners)l(m);});
 port.onDisconnect.addListener(()=>{port=undefined;});
 return port;
}
export const post=(m:Record<string,unknown>)=>{try{connect().postMessage(m);}catch{port=undefined;connect().postMessage(m);}};
export function listen(listener:(m:any)=>void){listeners.add(listener);connect();return()=>{listeners.delete(listener);};}
/** One request, one answer (matched by type and id). */
export function request<T=any>(message:Record<string,unknown>&{type:string},answer:string,timeoutMs=8000):Promise<T|null>{
 const id=crypto.randomUUID();
 return new Promise(resolve=>{
  const stop=listen(m=>{if(m?.type===answer&&(m.id===undefined||m.id===id)){clearTimeout(timer);stop();resolve(m);}});
  const timer=setTimeout(()=>{stop();resolve(null);},timeoutMs);post({...message,id});
 });
}
