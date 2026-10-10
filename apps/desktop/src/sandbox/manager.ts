import {mediaAssetPath} from '../main/media-paths';
import {touchCache,pruneVisualCache} from './cache';
import Ajv from 'ajv';
import type {CompiledVisual} from './compile';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir,writeFile,mkdir,rename,rm,copyFile} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {compileInWorker} from './compiler-client';
import type {Asset} from '@dream/footage';
import {VisualDefinitionSchema,VisualCaptureSchema,VISUAL_RUNTIME_VERSION,type VisualDefinition,type VisualCapture} from '@dream/contracts';
import {captureVisual} from './capture';

export async function renderVisual(raw:VisualDefinition,assets:Asset[],options:{runtimeDirectory:string;cacheDirectory:string;compilerWorker:string;authorize?:(path:string)=>void},signal:AbortSignal,progress:(phase:'validating'|'rendering',done:number,total:number)=>void=()=>{}){
 await pruneVisualCache(options.cacheDirectory);
 const definition=VisualDefinitionSchema.parse(raw);
 const compileKey=createHash('sha256').update(JSON.stringify({version:VISUAL_RUNTIME_VERSION,code:definition.code,source:definition.source})).digest('hex'),compiledPath=join(options.cacheDirectory,'compiled-'+compileKey+'.json');let compiled:string|CompiledVisual;
 const validate=new Ajv({strict:false,allErrors:true,validateFormats:false}).compile(definition.parameterSchema);if(!validate(definition.parameters))throw new Error('Visual parameters do not match their schema: '+JSON.stringify(validate.errors));
 try{const cached=JSON.parse(await readFile(compiledPath,'utf8'));if(cached.hash!==createHash('sha256').update(JSON.stringify(cached.compiled)).digest('hex'))throw new Error('Invalid compiled cache');compiled=cached.compiled;}catch{compiled=await compileInWorker(options.compilerWorker,definition,signal);await mkdir(options.cacheDirectory,{recursive:true});const bytes=JSON.stringify(compiled);await writeFile(compiledPath,JSON.stringify({compiled,hash:createHash('sha256').update(bytes).digest('hex')}));}
 await touchCache(compiledPath);
 const runtimeHash=createHash('sha256');for(const file of (await readdir(options.runtimeDirectory)).filter(f=>f.endsWith('.js')).sort()){runtimeHash.update(file);runtimeHash.update(await readFile(join(options.runtimeDirectory,file)));}
 const selected=definition.assetIds.map(id=>{const asset=assets.find(a=>a.id===id);if(!asset)throw new Error(`Visual source ${id} is unavailable.`);options.authorize?.(mediaAssetPath(asset));return{id,fingerprint:asset.fingerprint};});
 const cacheKey=createHash('sha256').update(JSON.stringify({definition,compiled,selected,runtime:VISUAL_RUNTIME_VERSION,bundle:runtimeHash.digest('hex')})).digest('hex'),cacheIndex=join(options.cacheDirectory,`${cacheKey}.json`);
 signal.throwIfAborted();
 try{
  const cached=VisualCaptureSchema.parse(JSON.parse(await readFile(cacheIndex,'utf8'))),directory=join(options.cacheDirectory,cached.revisionId);if(cached.cacheKey!==cacheKey||cached.revisionId!==createHash('sha256').update(JSON.stringify({cacheKey,frames:cached.frames})).digest('hex')||cached.runtimeVersion!==VISUAL_RUNTIME_VERSION||cached.width!==definition.width||cached.height!==definition.height||cached.fps!==definition.fps||cached.durationInFrames!==definition.durationInFrames||cached.frames.length!==definition.durationInFrames)throw new Error('Incomplete visual cache.');
  for(let frame=0;frame<cached.frames.length;frame++){signal.throwIfAborted();const entry=cached.frames[frame];if(entry.frame!==frame||createHash('sha256').update(await readFile(join(directory,`${String(frame).padStart(6,'0')}.png`))).digest('hex')!==entry.sha256)throw new Error('Visual cache hash mismatch.');}
  await touchCache(directory);await touchCache(cacheIndex);return{manifest:cached,directory,cacheHit:true};
 }catch(error){signal.throwIfAborted();}
 await mkdir(options.cacheDirectory,{recursive:true});const staging=join(options.cacheDirectory,`.render-${randomUUID()}`);
 try{
  // Fail on actual four-frame execution before allocating a complete sequence.
  await captureVisual(definition,assets,{runtimeDirectory:options.runtimeDirectory,authorize:options.authorize,compiled,directory:join(staging,'checks'),testOnly:true},signal,(done,total)=>progress('validating',done,total));
  const result=await captureVisual(definition,assets,{runtimeDirectory:options.runtimeDirectory,authorize:options.authorize,compiled,directory:staging},signal,(done,total)=>progress('rendering',done,total));
  const manifest:VisualCapture=VisualCaptureSchema.parse({cacheKey,revisionId:createHash('sha256').update(JSON.stringify({cacheKey,frames:result.frames})).digest('hex'),runtimeVersion:VISUAL_RUNTIME_VERSION,width:definition.width,height:definition.height,fps:definition.fps,durationInFrames:definition.durationInFrames,...result});
  const directory=join(options.cacheDirectory,manifest.revisionId);await mkdir(directory,{recursive:true});
  for(const frame of manifest.frames){signal.throwIfAborted();const filename=`${String(frame.frame).padStart(6,'0')}.png`,target=join(directory,filename);let valid=false;try{valid=createHash('sha256').update(await readFile(target)).digest('hex')===frame.sha256;}catch{}if(!valid)await copyFile(join(staging,filename),target);}
  const json=JSON.stringify(manifest);await writeFile(join(directory,'manifest.json'),json);signal.throwIfAborted();
  // Publish a small index only after all immutable pixel files exist. Moving a populated
  // directory is unreliable when Windows/OneDrive holds a directory enumeration handle.
  const temporary=`${cacheIndex}.${randomUUID()}.partial`;try{await writeFile(temporary,json);await rename(temporary,cacheIndex);}finally{await rm(temporary,{force:true});}
  await touchCache(directory);await touchCache(cacheIndex);return{manifest,directory,cacheHit:false};
 }finally{const rel=relative(options.cacheDirectory,staging);if(rel&&!isAbsolute(rel)&&!rel.startsWith('..'))await rm(staging,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}
