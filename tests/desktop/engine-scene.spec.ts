import {test,expect,chromium} from '@playwright/test';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {renderStill,renderMedia,selectComposition} from '@remotion/renderer';
import {AssetSchema} from '../../packages/footage/src';
import {emptyTimeline,TimelineSchema} from '../../packages/timeline/src/schema';
import {renderServer} from '../../apps/desktop/src/main/render-server';
import {withWebGl} from '../../apps/desktop/src/main/gl-preflight';
import {png,publishFixtureScene} from '../fixtures/engine-fixtures';

const ffmpeg=resolve('apps/desktop/resources/staged/media-runtime/ffmpeg.exe'),browserPath=resolve('apps/desktop/resources/staged/render-browser/chrome-headless-shell.exe'),engineRuntime=resolve('apps/desktop/resources/staged/engine');
/** One pixel of an image or video frame, decoded by the shipped ffmpeg. */
const pixel=(file:string,x:number,y:number,seconds?:number)=>[...execFileSync(ffmpeg,[...(seconds!==undefined?['-ss',String(seconds)]:[]),'-i',file,'-frames:v','1','-vf',`format=rgb24,crop=1:1:${x}:${y}`,'-f','rawvideo','-pix_fmt','rgb24','-loglevel','error','-'])];
const near=(actual:number[],expected:number[],tolerance=14)=>actual.every((v,i)=>Math.abs(v-expected[i])<=tolerance);

test('engine scenes seek exactly in the player and export the same frames, on the spine and as overlays',async()=>{
 test.setTimeout(300000);
 const root=mkdtempSync(join(tmpdir(),'dream-engine-scene-'));writeFileSync(join(root,'image.png'),png(16,16,()=>[0,255,0]));
 const image=AssetSchema.parse({id:'fixture-image',filename:'image.png',kind:'image',durationSec:5,width:16,height:16,originalPath:join(root,'image.png'),fingerprint:'image'});
 const title=await publishFixtureScene(root,'title'),cube=await publishFixtureScene(root,'cube',{files:{'checker.png':png(8,8,(x,y)=>(x+y)%2?[255,255,0]:[255,0,255])}}),chart=await publishFixtureScene(root,'chart');
 expect(cube.scene!.engine!.chunks).toEqual(['core','three']);expect(chart.scene!.engine!.chunks).toEqual(['core','d3']);
 const assets=[image,title,cube,chart],footage={assets,words:[],shots:[],faces:[],revision:0};
 const timeline=TimelineSchema.parse({...emptyTimeline('engine'),settings:{fps:30,width:640,height:360},spine:[{id:'chart',assetId:'chart',srcIn:0,srcOut:1,speed:1,audio:{mute:true},reason:'Chart'},{id:'cube',assetId:'cube',srcIn:0,srcOut:1,speed:1,audio:{mute:true},reason:'Cube'}],
  attached:[{id:'overlay',type:'overlay',component:'source_layer',layer:1,start:{kind:'project',at:'start',offsetSec:0},durationSec:2,params:{x:.25,y:.25,scale:.5},source:{assetId:'title',srcIn:0,srcOut:2},reason:'Overlay'}]});
 const media=await renderServer(new Map(assets.map(a=>[a.id,a])),undefined,{engineRuntime});
 const props={timeline,footage,media:media.media,audioMedia:media.audioMedia,engineBase:media.engineBase};
 const bundle=await build({stdin:{contents:`import React,{createRef} from 'react';import{createRoot}from'react-dom/client';import{Player}from'@remotion/player';import{TimelineComposition}from'./packages/composition/src/index.tsx';const ref=createRef();window.player=ref;const props=${JSON.stringify({...props,timeline:{...timeline,spine:[{...timeline.spine[1],srcOut:3}],attached:[]}})};createRoot(document.getElementById('root')).render(React.createElement(Player,{ref,component:TimelineComposition,inputProps:props,compositionWidth:640,compositionHeight:360,durationInFrames:90,fps:30,style:{width:640,height:360}}));`,resolveDir:resolve('.'),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'},alias:{react:resolve('node_modules/react'),'react-dom':resolve('node_modules/react-dom'),remotion:resolve('node_modules/remotion'),'@remotion/player':resolve('node_modules/@remotion/player'),'@dream/scene-engine':resolve('packages/scene-engine/src/index.ts'),'@dream/timeline':resolve('packages/timeline/src/index.ts'),'@dream/footage':resolve('packages/footage/src/index.ts')}});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:'<!doctype html><body style="margin:0"><div id="root"></div><script src="/app.js"></script>');});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const userData=mkdtempSync(join(tmpdir(),'dream-engine-gl-'));
 try{
  await withWebGl(userData,true,async gl=>{
   const browser=await chromium.launch({executablePath:browserPath,args:gl?[`--use-angle=${gl==='angle'?'default':'swiftshader'}`,'--enable-unsafe-swiftshader']:[]});
   try{
    // Player: the 3D scene seeks out of order inside one live document and matches each frame drawn on its own.
    const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);const scene=page.locator('iframe');await expect(scene).toHaveAttribute('src',/\/engine\/scene\/cube\/index\.html/);
    const shot=async(frame:number)=>{await page.evaluate(f=>(window as any).player.current.seekTo(f),frame);await page.waitForTimeout(400);await expect(page.getByRole('alert')).toHaveCount(0);return(await scene.screenshot()).toString('base64');};
    const outOfOrder:Record<number,string>={};for(const frame of [0,29,3,17])outOfOrder[frame]=await shot(frame);
    for(const frame of [0,3,17,29]){await page.reload();await expect(scene).toBeVisible();expect(await shot(frame),`frame ${frame}`).toBe(outOfOrder[frame]);}
    expect(new Set(Object.values(outOfOrder)).size).toBe(4);expect(errors).toEqual([]);
   }finally{await browser.close();}
   // Export: stills and a concurrency-2 render draw the spine scenes and the overlay with the expected colors.
   const inputProps={...props,exporting:true},chromiumOptions=gl?{gl}:{},options={serveUrl:resolve('artifacts/remotion'),inputProps,browserExecutable:browserPath,chromiumOptions},composition=await selectComposition({...options,id:'Dream'});
   for(const frame of [45,15])await renderStill({...options,composition,frame,output:join(root,`still-${frame}.png`)});
   expect(near(pixel(join(root,'still-15.png'),160,150),[0,0,255])).toBe(true);expect(near(pixel(join(root,'still-15.png'),620,20),[255,255,255])).toBe(true);expect(near(pixel(join(root,'still-45.png'),5,355),[16,24,32])).toBe(true);
   await renderMedia({...options,composition,codec:'h264',outputLocation:join(root,'export.mp4'),concurrency:2});
   expect(existsSync(join(root,'export.mp4'))).toBe(true);
   expect(near(pixel(join(root,'export.mp4'),160,150,.5),[0,0,255],24)).toBe(true);expect(near(pixel(join(root,'export.mp4'),620,20,.5),[255,255,255],24)).toBe(true);expect(near(pixel(join(root,'export.mp4'),5,355,1.5),[16,24,32],24)).toBe(true);
  });
 }finally{await media.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
