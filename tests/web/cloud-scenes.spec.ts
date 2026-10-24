import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import ffmpeg from 'ffmpeg-static';
import {session,use,state} from './roux-session';

/** Quick render without Modal: a coded scene packed as the editor sends it (bridge sceneJob), drawn by
 * services/scene-render/render.mjs on this computer in two pieces as two cloud workers would, and an export that takes
 * its frames from those pieces (export.ts CloudFrames) instead of drawing the scene. The card is magenta over the clip,
 * and the pieces keep the scene's transparency around it. */
const scene="export default function Card({word}:{word:string}){\n return <div style={{position:'absolute',left:80,top:80,padding:'28px 40px',background:'#ff00ff',color:'white',fontSize:64,fontFamily:'sans-serif',borderRadius:16}}>{word}</div>;\n}\n";
const renderer=resolve('services/scene-render/render.mjs');

test('a scene drawn by the cloud renderer is in the export',async({page})=>{
 test.setTimeout(400_000);
 const folder=mkdtempSync(join(tmpdir(),'gumbo-cloud-scene-'));
 const run=await session(page,asset=>[
  [use('w','write_file',{path:'src/card.tsx',content:scene})],
  [use('e','edit_file',{path:'project.json',oldText:'"spine": [],',newText:`"spine": [{"id":"c1","assetId":"${asset}","srcIn":0,"srcOut":6,"speed":1,"audio":{"mute":true},"reason":"Clip"}],`})],
  [use('a','edit_file',{path:'project.json',oldText:'"attached": [],',newText:'"attached": [{"id":"card_o","type":"overlay","start":{"kind":"project","at":"start","offsetSec":0},"durationSec":6,"component":"source","params":{},"source":{"assetId":"output:card","srcIn":0,"srcOut":6},"layer":2,"reason":"Card"}],'})],
  [use('o','edit_file',{path:'project.json',oldText:'"outputs": []',newText:'"outputs": [{"id":"card","path":"src/card.tsx","kind":"scene","durationInFrames":180,"transparent":true,"props":{"word":"Pho"}}]'})],
  [use('p','publish_project',{})],
  [use('f','finish',{status:'complete',summary:'Added the card.',evidence:[]})]]);
 try{
  await run.ask('Add a card.');
  const card=(await state(page)).footage.assets.find((a:any)=>a.scene);expect(card?.scene?.format).toBe('engine');
  // The cloud, here: each request is drawn in two pieces by render.mjs against this dev server's scene page.
  const requests:any[]=[];
  await page.exposeFunction('drawInCloud',async(job:any)=>{
   requests.push({frames:job.frames,width:job.width,height:job.height,fps:job.fps,files:Object.keys(job.payload.files)});
   const half=Math.ceil(job.frames/2),pieces=[[0,half],[half,job.frames]],out:{start:number;end:number;webm:string}[]=[];
   for(const [start,end] of pieces){const jobPath=join(folder,`job-${start}.json`),webm=join(folder,`piece-${start}.webm`);
    writeFileSync(jobPath,JSON.stringify({...job,page:`${new URL(page.url()).origin}/app/engine/app/scene/${encodeURIComponent(card.id)}/index.html`,start,end}));
    execFileSync(process.execPath,[renderer,jobPath,webm],{stdio:'inherit',env:{...process.env,SCENE_BROWSER_CHANNEL:'msedge'}});
    out.push({start,end,webm:readFileSync(webm).toString('base64')});}
   return {fps:job.fps,chunks:out};
  });
  await page.evaluate(()=>{const dream=(window as any).dream;
   dream.cloudScene=async(request:any)=>{const payload=await dream.sceneJob(request.assetId),answer=await (window as any).drawInCloud({...request,signal:undefined,payload});
    return{fps:answer.fps,chunks:answer.chunks.map((c:any)=>({start:c.start,end:c.end,video:new Blob([Uint8Array.from(atob(c.webm),ch=>ch.charCodeAt(0))],{type:'video/webm'})}))};};});
  const log:any[]=[];page.on('console',async m=>{if(m.text().startsWith('[export]'))log.push(await m.args()[1]?.jsonValue().catch(()=>null));});
  await page.getByRole('button',{name:'Export'}).first().click();
  const dialog=page.getByRole('dialog',{name:'Export'});
  const [download]=await Promise.all([page.waitForEvent('download',{timeout:300_000}),dialog.getByRole('button',{name:'Export',exact:true}).click()]);
  const saved=join(folder,download.suggestedFilename());await download.saveAs(saved);
  expect(requests).toEqual([{frames:180,width:card.width,height:card.height,fps:card.fps||30,files:expect.any(Array)}]);
  // The pieces: a transparent page with the magenta card, as the scene draws it.
  const rgba=(file:string,x:number,y:number)=>execFileSync(ffmpeg!,['-v','error','-c:v','libvpx-vp9','-i',file,'-frames:v','1','-vf',`crop=8:8:${x}:${y},scale=1:1`,'-f','rawvideo','-pix_fmt','rgba','-']);
  const inCard=rgba(join(folder,'piece-90.webm'),90,90),outside=rgba(join(folder,'piece-90.webm'),card.width-40,card.height-40);
  expect(inCard[0]).toBeGreaterThan(200);expect(inCard[1]).toBeLessThan(80);expect(inCard[3]).toBeGreaterThan(240);expect(outside[3]).toBeLessThan(10);
  // The export: the card over the clip at 3 s (the second piece), drawn by neither the scene page here nor its fallback.
  const pixel=execFileSync(ffmpeg!,['-v','error','-ss','3','-i',saved,'-frames:v','1','-vf','crop=8:8:90:90,scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-']);
  expect(pixel[0]).toBeGreaterThan(200);expect(pixel[1]).toBeLessThan(80);expect(pixel[2]).toBeGreaterThan(200);
  await expect.poll(()=>log.at(-1)?.render?.cloud).toMatchObject({scenes:1,failed:0});
  expect(log.at(-1).render.scenes.asked).toBe(0);
 }finally{await run.gateway.close();rmSync(folder,{recursive:true,force:true});}
});
