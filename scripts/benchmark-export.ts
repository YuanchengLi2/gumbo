/** Times the real export path (render server, engine scenes, Remotion renderMedia) for an existing project at different
 * concurrency levels. No model calls. Usage: pnpm exec tsx scripts/benchmark-export.ts <project folder> [concurrency list, default the app's] [frames] */
import {join,resolve} from 'node:path';
import {mkdirSync} from 'node:fs';
import {renderMedia,selectComposition} from '@remotion/renderer';
import {ProjectDB} from '@dream/project-db';
import {renderServer} from '../apps/desktop/src/main/render-server';
import {frameFormat,renderConcurrency} from '../apps/desktop/src/main/render-settings';

const folder=resolve(process.argv[2]??''),levels=(process.argv[3]||String(renderConcurrency())).split(',').map(Number),frames=Number(process.argv[4]??150),start=Number(process.argv[5]??0);
const staged=resolve('apps/desktop/resources/staged'),browserExecutable=join(staged,'render-browser/chrome-headless-shell.exe'),serveUrl=join(staged,'remotion');
const project=new ProjectDB(folder),state=project.state();project.close();
// BENCH_NO_GRADE strips colour grading, BENCH_NO_TRANSITIONS strips transitions, BENCH_PNG renders PNG frames (as the app's export does).
if(process.env.BENCH_NO_GRADE)state.timeline.spine=state.timeline.spine.map((c:any)=>({...c,framing:c.framing?{mode:c.framing.mode,scale:c.framing.scale,x:c.framing.x,y:c.framing.y}:undefined}));
if(process.env.BENCH_BARE){state.timeline.attached=[];delete (state.timeline as any).captions;state.timeline.music=[];}
if(process.env.BENCH_NO_TRANSITIONS)state.timeline.spine=state.timeline.spine.map((c:any)=>({...c,transitionIn:undefined}));
const server=await renderServer(new Map(state.footage.assets.map(a=>[a.id,a])),undefined,{engineRuntime:join(staged,'engine')});
const out=join(folder,'benchmark');mkdirSync(out,{recursive:true});
try{
 const inputProps={timeline:state.timeline,footage:state.footage,media:server.media,audioMedia:server.audioMedia,exporting:true,engineBase:server.engineBase};
 const composition=await selectComposition({serveUrl,id:'Dream',inputProps,browserExecutable,binariesDirectory:join(staged,'compositor')});
 for(const concurrency of levels){
  const started=Date.now();
  await renderMedia({serveUrl,composition,inputProps,codec:'h264',...(process.env.BENCH_PNG?{imageFormat:'png' as const}:frameFormat()),outputLocation:join(out,`c${concurrency}.mp4`),browserExecutable,binariesDirectory:join(staged,'compositor'),concurrency,frameRange:[start,Math.min(start+frames,composition.durationInFrames)-1]});
  const seconds=(Date.now()-started)/1000;console.log(`concurrency ${concurrency}: ${Math.min(frames,composition.durationInFrames)} frames in ${seconds.toFixed(1)}s (${(seconds*1000/Math.min(frames,composition.durationInFrames)).toFixed(0)} ms/frame)`);
 }
}finally{await server.close();}
