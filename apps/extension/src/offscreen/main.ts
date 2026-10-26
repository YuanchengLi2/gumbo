/// <reference types="chrome" />
import {search,refresh,reset,stats,lastActive} from './memory';
import {listening,startListening,listenAudio,stopListening} from './listen';
import {useKeys} from '../background/vault';
/** The offscreen document: Gumbo's long-lived part, for what needs a page (WebAssembly and WebGPU models, workers, audio)
 * and outlives the service worker's naps: memory search, embedding, and listening. The worker talks to it with
 * {target:'offscreen'} messages; it closes itself after ten minutes with nothing to do. */
chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
 if(message?.target!=='offscreen')return;
 handle(message).then(reply,error=>reply({error:(error as Error).message}));
 return true;
});
async function handle(message:any){
 if(message.keys)useKeys(message.keys.user,message.keys.dek);
 switch(message.type){
  case 'search':return search(message.query,message.options);
  case 'index.changed':await refresh();return{};
  case 'index.reset':reset();return{};
  case 'index.stats':return stats();
  case 'listen.start':return startListening(message);
  case 'listen.audio':return listenAudio(message);
  case 'listen.stop':return stopListening(message.session);
  case 'ping':return{ok:true};
 }
 return{error:`Unknown ${message.type}`};
}
setInterval(()=>{if(Date.now()-lastActive>10*60_000&&!listening())window.close();},60_000);
