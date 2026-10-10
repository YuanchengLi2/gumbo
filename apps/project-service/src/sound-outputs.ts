import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {AssetSchema,type Asset} from '@dream/footage';
import {scoreFromNotation,SoundDesignSchema,renderArrangement,renderSound,renderSfx,sfxCatalog,SCORE_RENDERER_VERSION,type ScoreDocument,type SoundDesign} from '@dream/procedural-media';
import {renderProcedural} from './procedural-client';
import {workspacePath} from '../../../packages/project-db/src/workspace-store';

/** Renders music or a sound effect; the worker when available (keeps the service responsive), else in process. */
export type AudioRenderer=(input:{directory:string;score?:ScoreDocument;sound?:SoundDesign;sfxId?:string},signal:AbortSignal)=>Promise<{durationSec:number;beats:number[];waveform:number[]}>;
export const workerRenderer=(workerPath:string):AudioRenderer=>async(input,signal)=>renderProcedural(workerPath,input,signal,()=>{});
export const inProcessRenderer:AudioRenderer=async input=>{
 mkdirSync(input.directory,{recursive:true});
 const result=input.score?renderArrangement(input.score):input.sound?renderSound(input.sound):renderSfx(input.sfxId!);
 const durationSec=input.score?.durationSec??('durationSec' in result?Number(result.durationSec):0),beats='beats' in result?result.beats as number[]:[];
 writeFileSync(join(input.directory,'mix.wav'),result.wav);writeFileSync(join(input.directory,'manifest.json'),JSON.stringify({rendererVersion:SCORE_RENDERER_VERSION,durationSec,beats,waveform:result.waveform}));
 return{durationSec,beats,waveform:result.waveform};
};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const field=(error:unknown)=>{const issue=(error as {issues?:{path:(string|number)[];message:string}[]}).issues?.[0];return issue?`${issue.path.join('.')||'sound'}: ${issue.message}`:String((error as Error).message);};

/** Music (a score file in notation or as a full document) and sound effects (a sound design file or preset:<id>)
 * become audio assets. Rendering is cached by the definition's hash, so republishing unchanged sound is instant. */
export async function soundOutput(projectFolder:string,workspaceRoot:string,output:{id:string;path:string;kind:'music'|'sfx'},render:AudioRenderer,signal:AbortSignal):Promise<Asset>{
 let definition:{score?:ScoreDocument;sound?:SoundDesign;sfxId?:string};
 if(output.kind==='sfx'&&output.path.startsWith('preset:')){const wanted=output.path.slice('preset:'.length).toLowerCase(),slug=(name:string)=>name.toLowerCase().replace(/[^a-z0-9]+/g,'-');const preset=sfxCatalog.find(p=>p.id===wanted||slug(p.name)===slug(wanted));if(!preset)throw new Error(`Sound effect ${output.id}: "${wanted}" is not a preset. Presets: ${sfxCatalog.map(p=>`${p.id} (${p.name})`).join(', ')}.`);definition={sfxId:preset.id};}
 else{
  const file=workspacePath(workspaceRoot,output.path);if(!existsSync(file))throw new Error(`${output.path} does not exist.`);
  let json:unknown;try{json=JSON.parse(readFileSync(file,'utf8'));}catch(error){throw new Error(`${output.path} is not valid JSON: ${(error as Error).message}`);}
  try{definition=output.kind==='music'?{score:scoreFromNotation(json,output.id)}:{sound:SoundDesignSchema.parse({schemaVersion:1,id:output.id,title:output.id,seed:1,...(json as object)})};}
  catch(error){throw new Error(`${output.path} (${output.kind} ${output.id}) ${field(error)}`);}
 }
 // The cache key is the sound itself; names and titles do not change the audio.
 const content=definition.score?{score:{...definition.score,id:'',title:''}}:definition.sound?{sound:{...definition.sound,id:'',title:''}}:definition;
 const hash=digest(JSON.stringify({renderer:SCORE_RENDERER_VERSION,...content})),directory=join(projectFolder,'Media/Generated',hash),manifestPath=join(directory,'manifest.json');
 let manifest:{durationSec:number;beats:number[];waveform:number[]};
 if(existsSync(manifestPath)&&existsSync(join(directory,'mix.wav')))manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 else{const temp=directory+'.rendering-'+process.pid;manifest=await render({directory:temp,...definition},signal);if(!existsSync(directory))renameSync(temp,directory);}
 const durationSec=definition.score?.durationSec??manifest.durationSec;
 return AssetSchema.parse({id:'code_'+hash,filename:output.id+'.wav',kind:'audio',durationSec,hasAudio:true,originalPath:join(directory,'mix.wav'),fingerprint:hash,status:'ready',waveform:manifest.waveform?.slice(0,400)??[],playback:{ready:true,audio:'original'},generated:{kind:output.kind==='music'?'score':'sfx',definitionId:output.id,revisionId:hash,rendererVersion:SCORE_RENDERER_VERSION,role:'mix',beats:output.kind==='music'?manifest.beats:undefined}});
}
