// Draws frames of one Gumbo scene in a real browser and encodes them as a WebM with transparency (VP9, yuva420p).
// Each cloud worker (app.py, on Modal) runs it for its share of a scene's frames; it also runs on any computer with
// Node, Playwright's Chromium and ffmpeg, which is how it is tested.
//   node render.mjs job.json out.webm
// job.json: {page, width, height, fps, start, end, payload:{config, version, bundle, files, media}}, where page is a
// scene address on usegumbo.app (…/app/engine/app/scene/<id>/index.html, which serves the scene host page) and bundle,
// files and media are base64. The page gets them as the editor sends them (apps/web/src/bridge/engine.ts), is told
// each frame to draw as an export tells it (packages/scene-engine/src/runtime/bridge.ts), and each frame is a native
// screenshot with a transparent background: in a page of its own, on screen, nothing has to copy the page's styles.
import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const [jobPath,outPath]=process.argv.slice(2);
if(!jobPath||!outPath){console.error('Usage: node render.mjs job.json out.webm');process.exit(2);}
const job=JSON.parse(readFileSync(jobPath,'utf8'));
const {width,height,fps,start,end}=job;
if(!(width>0&&height>0&&fps>0&&end>start))throw new Error('The job needs a size, a frame rate and frames to draw.');
const ffmpegPath=process.env.FFMPEG??(()=>{try{return createRequire(import.meta.url)('ffmpeg-static');}catch{return 'ffmpeg';}})();

const browser=await chromium.launch({channel:process.env.SCENE_BROWSER_CHANNEL||undefined,args:['--disable-gpu-vsync','--force-color-profile=srgb','--hide-scrollbars']});
const encoder=spawn(ffmpegPath,['-v','error','-y','-f','image2pipe','-framerate',String(fps),'-c:v','png','-i','-',
 '-c:v','libvpx-vp9','-pix_fmt','yuva420p','-b:v','0','-crf','24','-deadline','realtime','-cpu-used','8','-row-mt','1','-auto-alt-ref','0','-an',outPath],{stdio:['pipe','inherit','inherit']});
const encoded=new Promise((resolve,reject)=>{encoder.on('error',reject);encoder.on('exit',code=>code===0?resolve():reject(new Error(`ffmpeg exited ${code}`)));});
const write=data=>new Promise((resolve,reject)=>encoder.stdin.write(data,error=>error?reject(error):resolve()));
try{
 const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
 page.on('pageerror',error=>console.error('scene:',error.message));
 await page.goto(job.page,{waitUntil:'load'});
 // The page is its own parent here: what it posts to its parent comes back to it, and so does what is posted to it.
 await page.evaluate(async payload=>{
  const blob=(base64,type='application/octet-stream')=>new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type});
  const files=map=>Object.fromEntries(Object.entries(map??{}).map(([name,data])=>[name,blob(data)]));
  window.__scene={waiting:new Map(),next:0,ready:null};
  window.__scene.ready=new Promise((resolve,reject)=>{
   addEventListener('message',event=>{const data=event.data;if(!data?.dreamScene)return;
    if(data.ready)resolve();
    else if(data.error&&data.fatal&&data.requestId===undefined)reject(new Error(String(data.error)));
    else if(data.requestId!==undefined&&!data.type){const waiter=window.__scene.waiting.get(data.requestId);if(waiter){window.__scene.waiting.delete(data.requestId);data.error?waiter.reject(new Error(String(data.error))):waiter.resolve();}}});
   setTimeout(()=>reject(new Error('The scene did not start within a minute.')),60_000);
  });
  postMessage({dreamScene:true,type:'load',config:payload.config,version:payload.version,bundle:blob(payload.bundle,'text/javascript'),files:files(payload.files),media:files(payload.media)},'*');
  await window.__scene.ready;
 },job.payload);
 // Screenshots straight from the browser's DevTools protocol: a transparent page background set once, the scene's own
 // rectangle, and fast PNG compression (Playwright's element screenshot set the background and scrolled every frame).
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Emulation.setDefaultBackgroundColorOverride',{color:{r:0,g:0,b:0,a:0}});
 const began=performance.now();let drawing=0,capturing=0;
 for(let frame=start;frame<end;frame++){
  await page.evaluate(({frame,fps})=>new Promise((resolve,reject)=>{const id=++window.__scene.next;window.__scene.waiting.set(id,{resolve,reject});
   postMessage({dreamScene:true,type:'frame',frame,fps,playing:false,requestId:id},'*');}),{frame,fps});
  const drawn=performance.now();drawing+=drawn-began-drawing-capturing;
  const {data}=await cdp.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width,height,scale:1},optimizeForSpeed:true,fromSurface:true});
  capturing+=performance.now()-drawn;await write(Buffer.from(data,'base64'));
 }
 encoder.stdin.end();await encoded;
 console.error(`Drew frames ${start}-${end} in ${((performance.now()-began)/1000).toFixed(1)} s (${Math.round((performance.now()-began)/(end-start))} ms a frame: ${Math.round(drawing/(end-start))} drawing, ${Math.round(capturing/(end-start))} capturing).`);
}catch(error){encoder.kill();throw error;}
finally{await browser.close();}
