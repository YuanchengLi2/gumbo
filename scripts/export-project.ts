/** Exports a saved project folder the way the app's Export does (native export, with the browser drawing only what it alone
 * can draw), and reports the time and what went through the browser. Usage:
 * pnpm exec tsx scripts/export-project.ts <project folder> [output.mp4] */
import {join,resolve} from 'node:path';
import {existsSync,rmSync} from 'node:fs';
import ffmpegStatic from 'ffmpeg-static';
import {renderMedia,selectComposition} from '@remotion/renderer';
import {ProjectDB} from '@dream/project-db';
import {renderServer} from '../apps/desktop/src/main/render-server';
import {renderConcurrency} from '../apps/desktop/src/main/render-settings';
import {exportNative,planPieces,browserLayer} from '../apps/desktop/src/main/native-export';
import {normalizeLoudness} from '../apps/desktop/src/main/export-loudness';

const [folderArg,outputArg]=process.argv.slice(2);if(!folderArg)throw new Error('Name a project folder.');
const ffmpeg=process.env.DREAM_FFMPEG??ffmpegStatic!,folder=resolve(folderArg),output=resolve(outputArg??join(folder,'Exports','export-project.mp4'));
const staged=resolve('apps/desktop/resources/staged'),browserExecutable=join(staged,'render-browser/chrome-headless-shell.exe'),serveUrl=join(staged,'remotion'),binariesDirectory=join(staged,'compositor');
if(!existsSync(browserExecutable))throw new Error('Stage the render browser first.');
const db=new ProjectDB(folder);const state=db.state();db.close();
const pieces=planPieces(state.timeline,state.footage),fps=state.timeline.settings.fps,browser=pieces.filter(p=>p.browser);
console.log(`${pieces.length} pieces, ${(pieces.at(-1)!.to/fps/60).toFixed(1)} minutes; browser: ${browser.map(p=>`${p.browserLayer} ${((p.to-p.from)/fps).toFixed(1)}s (${p.browser})`).join(', ')||'none'}`);
const server=await renderServer(new Map(state.footage.assets.map(a=>[a.id,a])),undefined,{engineRuntime:join(staged,'engine')}),workDir=output+'.work',started=Date.now();
try{
 const inputProps={timeline:state.timeline,footage:state.footage,media:server.media,audioMedia:server.audioMedia,exporting:true,engineBase:server.engineBase};
 const composition=await selectComposition({serveUrl,id:'Dream',inputProps,browserExecutable,binariesDirectory});
 const result=await exportNative({ffmpeg,timeline:state.timeline,footage:state.footage,output,workDir,
  onProgress:(done,total,phase)=>console.log(`${((Date.now()-started)/1000).toFixed(0)}s ${phase} ${done}/${total}`),
  renderBrowser:async(from,to,file,layer)=>{const l=browserLayer(state.timeline,layer),t=Date.now(),props={...inputProps,timeline:l.timeline,transparentBackground:l.transparentBackground};
   // A composition renders with the props it was selected with.
   const selected=await selectComposition({serveUrl,id:'Dream',inputProps:props,browserExecutable,binariesDirectory});
   await renderMedia({serveUrl,composition:selected,inputProps:props,...l.render,muted:true,outputLocation:file,browserExecutable,binariesDirectory,concurrency:renderConcurrency(),frameRange:[from,to-1]});console.log(`  browser ${layer} ${from}-${to}: ${((Date.now()-t)/1000).toFixed(1)}s`);}});
 const loudness=await normalizeLoudness(ffmpeg,output);
 console.log(JSON.stringify({...result,seconds:Math.round((Date.now()-started)/1000),loudness,output}));
}finally{await server.close();rmSync(workDir,{recursive:true,force:true});}
