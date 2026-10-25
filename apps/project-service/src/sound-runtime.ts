import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {analyseSound,loadSoundModels,type SoundAnalysis,type LoadedSoundModels,type SoundModelFile,type OnnxRuntime} from '@dream/sound';

/** Measures a source's sound from its samples (16 kHz mono). The web app swaps this module for web-sound-runtime.ts,
 * which does the same in a worker of its own. */
export type Analyse=(read:AsyncIterable<Float32Array>,durationSec:number,signal:AbortSignal)=>Promise<SoundAnalysis>;

/** A model's bytes: from the models folder, or downloaded once into it and checked against its hash. */
async function modelBytes(folder:string,file:SoundModelFile){
 const path=join(folder,file.filename);
 if(existsSync(path)){const bytes=readFileSync(path);if(bytes.length===file.bytes)return new Uint8Array(bytes);}
 const response=await fetch(file.url);if(!response.ok)throw new Error(`The sound model could not be downloaded (${response.status}).`);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('The downloaded sound model did not match its checksum.');
 mkdirSync(folder,{recursive:true});writeFileSync(path+'.part',bytes);renameSync(path+'.part',path);
 return new Uint8Array(bytes);
}

/** On the desktop the models run on native ONNX Runtime, about ten times faster than WebAssembly: an hour of footage in
 * about two minutes. Its two threads are its own, so the project service (and the agent in it) keeps going while it works.
 * The models load when a source is first analysed and are let go two minutes after the last. */
export function soundAnalyser(folder=process.env.DREAM_MODELS_DIRECTORY||join(homedir(),'.gumbo','models')):Analyse{
 let models:Promise<LoadedSoundModels>|undefined,users=0,idle:ReturnType<typeof setTimeout>|undefined;
 const load=()=>models??=(async()=>{
  const module:any=await import('onnxruntime-node'),ort:OnnxRuntime=module.InferenceSession?module:module.default;
  return loadSoundModels(ort,file=>modelBytes(folder,file),{intraOpNumThreads:2,interOpNumThreads:1});
 })().catch(error=>{models=undefined;throw error;});
 return async(read,durationSec,signal)=>{
  clearTimeout(idle);users++;
  try{return await analyseSound(read,durationSec,await load(),signal);}
  finally{if(--users===0){idle=setTimeout(()=>{const loaded=models;models=undefined;void loaded?.then(m=>m.release()).catch(()=>{});},120_000);idle.unref?.();}}
 };
}
