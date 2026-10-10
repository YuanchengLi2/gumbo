import {app} from 'electron';
import {performance} from 'node:perf_hooks';
import {mkdirSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {renderMedia,selectComposition} from '@remotion/renderer';
import {compileInWorker} from '../../apps/desktop/src/sandbox/compiler-client';
import {renderVisual} from '../../apps/desktop/src/sandbox/manager';
import {renderServer} from '../../apps/desktop/src/main/render-server';
import {AssetSchema,emptyFootage} from '@dream/footage';
import {VisualDefinitionSchema} from '@dream/contracts';
import {emptyTimeline,ClipSchema} from '@dream/timeline';
app.on('window-all-closed',()=>{});
async function main(){await app.whenReady();
try{
 const output=process.argv[2],root=process.argv[3],staged=resolve('apps/desktop/resources/staged'),worker=resolve('artifacts/compute-benchmark/component-compile.cjs');mkdirSync(root,{recursive:true});
 const times:Record<string,number>={};const measure=async<T>(name:string,fn:()=>Promise<T>)=>{const start=performance.now();const value=await fn();times[name]=performance.now()-start;return value;};
 const definition=VisualDefinitionSchema.parse({schemaVersion:1,id:'compute-scene',title:'Compute sample',code:"import React from 'react';import {AbsoluteFill,useCurrentFrame} from 'remotion';export default function Scene(){const f=useCurrentFrame();return <AbsoluteFill>{Array.from({length:80},(_,i)=><div key={i} style={{position:'absolute',left:(i*71+f*3)%1280,top:(i*47)%720,width:15+i%25,height:15+i%25,borderRadius:'50%',background:i%2?'#b7a5ff':'#77d8db',opacity:.6,transform:'scale('+(1+Math.sin(f/8+i)*.2)+')'}}/>)}</AbsoluteFill>}",parameters:{},parameterSchema:{type:'object'},width:1280,height:720,fps:30,durationInFrames:60,seed:1,transparent:true});
 await measure('compileMs',()=>compileInWorker(worker,definition,new AbortController().signal));
 const options={runtimeDirectory:join(staged,'sandbox'),cacheDirectory:join(root,'cache'),compilerWorker:worker};
 const visual=await measure('visualRenderMs',()=>renderVisual(definition,[],options,new AbortController().signal));
 const warm=await measure('visualCacheHitMs',()=>renderVisual(definition,[],options,new AbortController().signal));
 const source=AssetSchema.parse({id:'source',filename:'Calibration source',kind:'video',durationSec:6,fps:30,width:1280,height:720,hasAudio:true,originalPath:resolve('artifacts/fixtures/source.mp4'),fingerprint:'fixture',status:'ready'}),generated=AssetSchema.parse({id:'generated',filename:'Compute sample',kind:'video',durationSec:2,fps:30,width:1280,height:720,hasAudio:false,originalPath:join(visual.directory,'000000.png'),fingerprint:visual.manifest.revisionId,status:'ready',sequence:{directory:visual.directory,frameCount:60,fps:30,revisionId:visual.manifest.revisionId}});
 const footage=emptyFootage();footage.assets=[source,generated];const timeline=emptyTimeline('benchmark');timeline.spine=[ClipSchema.parse({id:'clip',assetId:'source',srcIn:0,srcOut:3,reason:'Benchmark'})];
 const server=await renderServer(new Map(footage.assets.map(a=>[a.id,a])));
 try{for(const mixed of [false,true]){timeline.attached=mixed?[{id:'overlay',type:'overlay',component:'generated_visual',start:{kind:'project',at:'start',offsetSec:0},durationSec:2,source:{assetId:'generated',srcIn:0,srcOut:2},params:{},layer:0,reason:'Benchmark'}]:[];const inputProps={timeline,footage,media:server.media,exporting:true},runtime={serveUrl:join(staged,'remotion'),browserExecutable:join(staged,'render-browser/chrome-headless-shell.exe'),binariesDirectory:join(staged,'compositor')};await measure(mixed?'mixedExportMs':'simpleExportMs',async()=>{const composition=await selectComposition({...runtime,id:'Dream',inputProps});await renderMedia({...runtime,composition,inputProps,codec:'h264',imageFormat:'png',colorSpace:'bt709',concurrency:2,outputLocation:join(root,mixed?'mixed.mp4':'simple.mp4')});});}}
 finally{await server.close();}
 const pngBytes=readdirSync(visual.directory).filter(n=>n.endsWith('.png')).reduce((sum,name)=>sum+statSync(join(visual.directory,name)).size,0);
 writeFileSync(output,JSON.stringify({times,visual:{width:1280,height:720,fps:30,frames:60,framePngBytes:pngBytes,cacheHit:warm.cacheHit},export:{width:1920,height:1080,fps:30,frames:90,concurrency:2,simpleBytes:statSync(join(root,'simple.mp4')).size,mixedBytes:statSync(join(root,'mixed.mp4')).size},compilerHeapLimitMiB:384,notes:'Synthetic calibration footage and an 80-particle scene. Export times include composition/browser startup; no extrapolation guarantee for arbitrary footage.'},null,2));app.exit(0);
}catch(error){console.error(error);app.exit(1);}

}
void main();
