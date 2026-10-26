import {on} from './surfaces';
/** Pairs Ctrl+K's card (an extension frame inside the page) with the content script that opened it, by a session id the
 * content script made and put only in the frame's address (inside Gumbo's closed shadow root, out of the page's reach).
 * The card must be the extension's own page in the same tab; every message between them passes through here, so the page
 * never sees what is typed in the card or what it shows. */
const openers=new Map<string,chrome.runtime.Port>(),cards=new Map<string,chrome.runtime.Port>();
on('card.open',(message:{session:string},{port})=>{
 openers.set(message.session,port);
 port.onDisconnect.addListener(()=>{if(openers.get(message.session)===port){openers.delete(message.session);cards.get(message.session)?.disconnect();cards.delete(message.session);}});
});
on('card.to',(message:{session:string;payload:unknown},{port})=>{if(openers.get(message.session)===port)cards.get(message.session)?.postMessage(message.payload);});
on('card.close',(message:{session:string},{port})=>{if(openers.get(message.session)!==port)return;cards.get(message.session)?.disconnect();cards.delete(message.session);openers.delete(message.session);});
chrome.runtime.onConnect.addListener(port=>{
 if(!port.name.startsWith('card:'))return;
 const session=port.name.slice(5),opener=openers.get(session);
 // The card's address is the extension's own card page (its host is a per-session id: the frame is opened with a dynamic URL).
 const own=port.sender?.id===chrome.runtime.id&&/^chrome-extension:\/\/[^/]+\/card\.html/.test(port.sender?.url??'');
 if(!opener||!own||opener.sender?.tab?.id!==port.sender?.tab?.id){port.disconnect();return;}
 cards.set(session,port);
 port.onMessage.addListener(payload=>{try{opener.postMessage({type:'card.from',session,payload});}catch{}});
 port.onDisconnect.addListener(()=>{if(cards.get(session)===port){cards.delete(session);try{opener.postMessage({type:'card.from',session,payload:{type:'closed'}});}catch{}}});
});
