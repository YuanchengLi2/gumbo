import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {WordSchema,ShotSchema,FaceSchema,type Asset} from '@dream/footage';

const provenance={pipelineRevision:z.string(),artifactHash:z.string().regex(/^[a-f0-9]{64}$/)};
const results={
 shots:z.object({...provenance,shots:z.array(ShotSchema)}),
 align:z.object({...provenance,words:z.array(WordSchema)}),
 faces:z.object({...provenance,faces:z.array(FaceSchema)}),
 diarize:z.object({...provenance,speakers:z.array(z.object({start:z.number().nonnegative(),end:z.number().positive(),speaker:z.string()}))}),
 audio_features:z.object({...provenance,rmsDb:z.array(z.number()),hopSec:z.number().positive(),onsets:z.array(z.number()),silence:z.array(z.object({start:z.number(),end:z.number()})),peakDb:z.number(),loudnessEstimateDb:z.number()}),
 embeddings:z.object({...provenance,embeddings:z.array(z.object({id:z.string(),vector:z.array(z.number()).min(1)}))})
};
export type AnalysisStage=keyof typeof results;

export async function analyzeStage<S extends AnalysisStage>(binary:string,stage:S,asset:Asset,source:string,output:string,signal:AbortSignal,config:Record<string,unknown>={},extra:Record<string,unknown>={}):Promise<z.infer<typeof results[S]>>{
 const id=randomUUID();
 const request={...extra,id,stage,assetId:asset.id,fingerprint:asset.fingerprint,source,output,config};
 // Child analysis processes receive local runtime settings, never cloud credentials.
 const env:NodeJS.ProcessEnv={NODE_ENV:'production'};
 for(const key of ['SystemRoot','WINDIR','PATH','TEMP','TMP','HOME','USERPROFILE','LOCALAPPDATA','DREAM_FFMPEG_DLL_DIR'])if(process.env[key])env[key]=process.env[key];
 Object.assign(env,{HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',OMP_NUM_THREADS:'2',TOKENIZERS_PARALLELISM:'false',PYTHONUTF8:'1'});
 return new Promise((resolve,reject)=>{
  const child=spawn(binary,[],{windowsHide:true,signal,env});let stdout='',stderr='',settled=false;
  const finish=(error?:Error,result?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(result as z.infer<typeof results[S]>);};
  const timer=setTimeout(()=>{child.kill();finish(new Error(`Local ${stage} analysis exceeded its processing deadline. Retry this stage.`));},2*60*60*1000);
  child.stdout.on('data',chunk=>{stdout+=chunk.toString();if(stdout.length>64*1024*1024){child.kill();finish(new Error('Analysis response exceeded the supported artifact size.'));}});
  child.stderr.on('data',chunk=>stderr=(stderr+chunk.toString()).slice(-4000));
  child.on('error',error=>finish(error));
  child.on('close',code=>{if(settled)return;try{
   const lines=stdout.trim().split(/\r?\n/);let response:any;
   for(const line of lines){try{const parsed=JSON.parse(line);if(parsed.id===id)response=parsed;}catch{}}
   if(!response)throw new Error(`Local ${stage} worker exited ${code} without a result. ${stderr}`);
   if(response.error)throw new Error(`Local ${stage}: ${response.error}`);
   finish(undefined,results[stage].parse(response.result));
  }catch(error){finish(error as Error);}});
  child.stdin.on('error',error=>finish(error));child.stdin.end(JSON.stringify(request)+'\n');
 });
}

