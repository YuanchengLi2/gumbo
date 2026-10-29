/// <reference types="chrome" />
/** For reading Gumbo's own records while it is being built: a page served from this computer at 127.0.0.1:47321 (and no
 * other origin) may ask for what the debug page shows (Tab's last suggestions, what each surface was last given, speed,
 * what went wrong). Nothing answers anywhere else. */
const ORIGIN='http://127.0.0.1:47321';
export function startDebugBridge(){
 if(location.origin!==ORIGIN||window!==window.top)return;
 window.addEventListener('message',event=>{
  const what=event.data?.gumboDebug;
  if(event.source!==window||event.origin!==ORIGIN||what!=='memory'&&what!=='compare')return;
  chrome.runtime.sendMessage({type:`debug.${what}`}).then(data=>window.postMessage({gumboDebugReply:data},ORIGIN),error=>window.postMessage({gumboDebugReply:{error:String(error)}},ORIGIN));
 });
 document.documentElement.dataset.gumboBridge='ready';
}
