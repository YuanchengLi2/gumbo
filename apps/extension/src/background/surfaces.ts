/** The streams between pages and the engine: each frame opens one port named 'gumbo', sends requests with an id, and
 * gets text back as it streams. A request is cancelled by id (the next keystroke cancels the last Tab request), and
 * every request of a frame stops when the frame goes away. Port traffic also keeps the worker awake while it streams. */
export type Port=chrome.runtime.Port;
export type Send=(message:Record<string,unknown>)=>void;
export type Handler=(message:any,context:{send:Send;signal:AbortSignal;port:Port;tabId?:number;frameId?:number;url:string})=>Promise<void>|void;
const handlers=new Map<string,Handler>();
/** Registers what a message type does. Handlers for requests that stream get a signal that aborts on cancel. */
export function on(type:string,handler:Handler){handlers.set(type,handler);}

export function connectSurfaces(){
 chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=='gumbo')return;
  const running=new Map<string,AbortController>();let open=true;
  const send:Send=message=>{if(open)try{port.postMessage(message);}catch{open=false;}};
  port.onDisconnect.addListener(()=>{open=false;for(const c of running.values())c.abort();running.clear();});
  port.onMessage.addListener(async(message:any)=>{
   if(message?.type==='cancel'){running.get(message.id)?.abort();running.delete(message.id);return;}
   const handler=handlers.get(message?.type);if(!handler){send({type:'error',id:message?.id,message:`Unknown request ${message?.type}`});return;}
   const control=new AbortController();if(message.id)running.set(message.id,control);
   try{await handler(message,{send,signal:control.signal,port,tabId:port.sender?.tab?.id,frameId:port.sender?.frameId,url:port.sender?.url??''});}
   catch(error){if(!control.signal.aborted)send({type:'error',id:message.id,message:(error as Error).message,code:(error as any).type});}
   finally{if(message.id&&running.get(message.id)===control)running.delete(message.id);}
  });
 });
}
