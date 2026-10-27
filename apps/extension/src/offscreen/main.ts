/// <reference types="chrome" />
import {search,refresh,reset,stats,warm,lastActive,embed} from './memory';
import {listening,startListening,listenAudio,stopListening,listenCues,nameVoice,listenState,log} from './listen';
import {useKeys} from '../background/vault';
import {powerNow} from './power';
/** The offscreen document: Gumbo's long-lived part, for what needs a page (WebAssembly and WebGPU models, workers, audio)
 * and outlives the service worker's naps: memory search, embedding, and listening. The worker talks to it with
 * {target:'offscreen'} messages; it closes itself after ten minutes with nothing to do. */
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message?.target!=='offscreen'||sender.id!==chrome.runtime.id)return;
 // Pages send only their audio and captions here; everything else comes from the worker.
 if(sender.tab&&message.type!=='listen.audio'&&message.type!=='listen.cues')return;
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
  case 'index.warm':return warm();
  // Texts as vectors (8-bit, as memory keeps them), for grouping visits into projects.
  case 'embed':return{vectors:(await embed((message.texts as string[]).slice(0,64))).map(v=>[...v])};
  case 'listen.start':return startListening(message);
  case 'listen.audio':return listenAudio(message);
  case 'listen.stop':return stopListening(message.session);
  case 'listen.cues':return listenCues(message);
  case 'listen.name':return nameVoice(message);
  case 'listen.state':return listenState();
  case 'ping':return{ok:true};
  case 'power':return{power:await powerNow()};
  case 'debug.logs':return{log};
 }
 return{error:`Unknown ${message.type}`};
}
setInterval(()=>{if(Date.now()-lastActive>10*60_000&&!listening())window.close();},60_000);
