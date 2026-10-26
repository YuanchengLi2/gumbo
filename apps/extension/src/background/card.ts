import {on} from './surfaces';
/** Pairs Ctrl+K's card (an extension frame inside the page) with the content script that opened it, by a session id the
 * content script made and put only in the frame's address (inside Gumbo's closed shadow root, out of the page's reach).
 * The card must be the extension's own page in the same tab; every message between them passes through here, so the page
 * never sees what is typed in the card or what it shows. A card can connect a moment before its opener's word arrives
 * (they are separate channels): it waits for it, its first messages held, for a few seconds at most. */
const openers=new Map<string,chrome.runtime.Port>(),cards=new Map<string,chrome.runtime.Port>();
const early=new Map<string,{port:chrome.runtime.Port;held:unknown[];timer:ReturnType<typeof setTimeout>}>();
on('card.open',(message:{session:string},{port})=>{
 openers.set(message.session,port);
 port.onDisconnect.addListener(()=>{if(openers.get(message.session)===port){openers.delete(message.session);cards.get(message.session)?.disconnect();cards.delete(message.session);}});
 const waiting=early.get(message.session);
 if(waiting){early.delete(message.session);clearTimeout(waiting.timer);pair(message.session,waiting.port,waiting.held);}
});
on('card.to',(message:{session:string;payload:unknown},{port})=>{if(openers.get(message.session)===port)cards.get(message.session)?.postMessage(message.payload);});
on('card.close',(message:{session:string},{port})=>{if(openers.get(message.session)!==port)return;cards.get(message.session)?.disconnect();cards.delete(message.session);openers.delete(message.session);});
chrome.runtime.onConnect.addListener(port=>{
 if(!port.name.startsWith('card:'))return;
 const session=port.name.slice(5);
 // The card's address is the extension's own card page (its host is a per-session id: the frame is opened with a dynamic URL).
 const own=port.sender?.id===chrome.runtime.id&&/^chrome-extension:\/\/[^/]+\/card\.html/.test(port.sender?.url??'');
 if(!own){port.disconnect();return;}
 if(openers.has(session)){pair(session,port,[]);return;}
 const waiting={port,held:[] as unknown[],timer:setTimeout(()=>{if(early.get(session)===waiting){early.delete(session);port.disconnect();}},4000)};
 early.set(session,waiting);
 port.onMessage.addListener(payload=>{if(early.get(session)===waiting)waiting.held.push(payload);});
 port.onDisconnect.addListener(()=>{if(early.get(session)===waiting){clearTimeout(waiting.timer);early.delete(session);}});
});
function pair(session:string,port:chrome.runtime.Port,held:unknown[]){
 const opener=openers.get(session);
 if(!opener||opener.sender?.tab?.id!==port.sender?.tab?.id){port.disconnect();return;}
 cards.set(session,port);
 const relay=(payload:unknown)=>{try{opener.postMessage({type:'card.from',session,payload});}catch{}};
 for(const payload of held)relay(payload);
 port.onMessage.addListener(payload=>{if(cards.get(session)===port)relay(payload);});
 port.onDisconnect.addListener(()=>{if(cards.get(session)===port){cards.delete(session);relay({type:'closed'});}});
}
