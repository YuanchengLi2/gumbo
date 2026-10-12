import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {openBrowser,selectComposition,renderStill,makeCancelSignal} from '@remotion/renderer';
import {resolve} from '@dream/timeline';
import {ReviewRenderRequestSchema,ReviewImagesSchema,type ReviewRenderRequest,type ReviewImages} from '@dream/contracts';
import {renderServer} from './render-server';

export type ReviewRuntime={renderBundle:string;browser:string;binariesDirectory:string;cacheDirectory:string;authorize?:(path:string)=>void;/** The staged scene engine; without it engine scenes cannot load and the render times out. */ engineRuntime:string;gl?:'angle'|'swangle'};
export async function renderReview(raw:ReviewRenderRequest,runtime:ReviewRuntime,signal:AbortSignal):Promise<ReviewImages>{
 const request=ReviewRenderRequestSchema.parse(raw),resolved=resolve(request.timeline,request.footage);
 if(request.frames.some(f=>f.frame>=resolved.durationInFrames))throw new Error('Review frames are outside this version.');
 if(!existsSync(runtime.browser)||!existsSync(join(runtime.renderBundle,'index.html')))throw new Error('The local review renderer is missing. Install a complete Figjam build.');
 signal.throwIfAborted();
 // Bundle content, index revision and frame plan all participate in immutable artifact identity.
 const hash=createHash('sha256').update(JSON.stringify(request));
 for(const name of readdirSync(runtime.renderBundle).filter(name=>name.endsWith('.js')||name.endsWith('.html')).sort())hash.update(name).update(readFileSync(join(runtime.renderBundle,name)));
 const key=hash.digest('hex');
 mkdirSync(runtime.cacheDirectory,{recursive:true});const cache=join(runtime.cacheDirectory,`${key}.json`);
 if(existsSync(cache)){try{const found=ReviewImagesSchema.parse(JSON.parse(readFileSync(cache,'utf8')));if(found.versionId===request.versionId&&found.frames.every(f=>createHash('sha256').update(Buffer.from(f.data,'base64')).digest('hex')===f.sha256))return found;}catch{/* Derived artifacts can be regenerated. */}}
 const assets=new Map(request.footage.assets.map(a=>[a.id,{...a,originalPath:existsSync(a.originalPath)?a.originalPath:a.proxyPath??a.originalPath}]));
 const used=new Set([...request.timeline.spine.map(c=>c.assetId),...request.timeline.attached.flatMap(i=>i.source?[i.source.assetId]:[]),...request.timeline.music.map(m=>m.assetId)]);for(const [id,asset]of assets)if(used.has(id))runtime.authorize?.(asset.originalPath);
 const server=await renderServer(assets,runtime.authorize,{engineRuntime:runtime.engineRuntime});const {cancel,cancelSignal}=makeCancelSignal();signal.addEventListener('abort',cancel,{once:true});
 let browser:Awaited<ReturnType<typeof openBrowser>>|undefined;
 try{
  signal.throwIfAborted();browser=await openBrowser('chrome',{browserExecutable:runtime.browser,chromiumOptions:runtime.gl?{gl:runtime.gl}:{}});signal.throwIfAborted();
  const inputProps={timeline:request.timeline,footage:request.footage,media:server.media,exporting:true,engineBase:server.engineBase};
  const options={serveUrl:runtime.renderBundle,inputProps,browserExecutable:runtime.browser,binariesDirectory:runtime.binariesDirectory,puppeteerInstance:browser};
  const composition=await selectComposition({...options,id:'Dream'});const frames:ReviewImages['frames']=[];
  for(const frame of request.frames){
   signal.throwIfAborted();const image=await renderStill({...options,composition,frame:frame.frame,output:null,imageFormat:'jpeg',jpegQuality:78,scale:Math.min(1,960/Math.max(composition.width,composition.height)),cancelSignal});
   if(!image.buffer)throw new Error('The review renderer did not produce an image.');
   frames.push({...frame,mimeType:'image/jpeg',data:image.buffer.toString('base64'),sha256:createHash('sha256').update(image.buffer).digest('hex')});
  }
  signal.throwIfAborted();const result=ReviewImagesSchema.parse({versionId:request.versionId,frames});
  const temporary=cache+'.partial';writeFileSync(temporary,JSON.stringify(result));renameSync(temporary,cache);return result;
 }finally{signal.removeEventListener('abort',cancel);if(browser)await browser.close({silent:true});await server.close();}
}
