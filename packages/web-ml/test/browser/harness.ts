import {LocalWhisper,SAMPLE_RATE,type LocalWord,type Override,type Progress} from '../../src';

/** The page the headless test drives: the real client and worker, bundled as the app would bundle them, with ONNX
 * Runtime's WASM served from this origin (no CDN) under COOP/COEP. */
const whisper=new LocalWhisper(new Worker('./ml.worker.js',{type:'module'}),{wasmPaths:'/ort/'});
const log=(p:Progress)=>{if(p.stage==='download')console.log(`download ${Math.round(p.loaded/2**20)}/${Math.round(p.total/2**20)} MB`);};

/** A fixture decoded and resampled to 16 kHz mono by the browser, as the app's media side will hand PCM over. */
async function pcm(name:string){
 const bytes=await(await fetch(`/fixtures/${name}`)).arrayBuffer();
 return(await new OfflineAudioContext(1,1,SAMPLE_RATE).decodeAudioData(bytes)).getChannelData(0).slice();
}

Object.assign(window,{webml:{
 capabilities:(override?:Override)=>whisper.capabilities(override),
 load:(override?:Override)=>whisper.load({override,onProgress:log}),
 probe:async(override?:Override,sampleName?:string)=>whisper.probe({override,sample:sampleName?(await pcm(sampleName)).slice(0,30*SAMPLE_RATE):undefined,onProgress:log}),
 /** Fed 2 s at a time, awaiting back-pressure, as a decoder would feed a long file. */
 async transcribe(name:string,{override,language}:{override?:Override;language?:string}={}){
  const audio=await pcm(name),settled:{at:number;words:LocalWord[]}[]=[],began=performance.now();let pushedBy=0;
  const stream=whisper.stream({override,language,durationSec:audio.length/SAMPLE_RATE,onWords:words=>settled.push({at:performance.now()-began,words}),onProgress:log});
  for(let at=0;at<audio.length;at+=2*SAMPLE_RATE)await stream.push(audio.subarray(at,at+2*SAMPLE_RATE));
  pushedBy=performance.now()-began;
  const result=await stream.end();
  return{result,settled:settled.map(s=>({at:Math.round(s.at),count:s.words.length})),settledWords:settled.flatMap(s=>s.words),pushedBy:Math.round(pushedBy),wallMs:Math.round(performance.now()-began)};
 },
 /** Starts a transcription and cancels it once the first words arrive (or after 20 s). */
 async cancel(name:string,override?:Override){
  const audio=await pcm(name),controller=new AbortController();
  const stream=whisper.stream({override,signal:controller.signal,onWords:()=>controller.abort()});setTimeout(()=>controller.abort(),20_000);
  try{for(let at=0;at<audio.length;at+=2*SAMPLE_RATE)await stream.push(audio.subarray(at,at+2*SAMPLE_RATE));await stream.end();return{name:'completed'};}
  catch(error){
   // The worker is free again straight away: a short transcription after the cancel works.
   const next=await whisper.transcribe((await pcm(name)).slice(0,8*SAMPLE_RATE),{override});
   return{name:(error as Error).name,after:next.words.map(w=>w.word).join(' ')};
  }
 },
}});
