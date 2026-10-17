import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {codeGateway,signIn} from '../fixtures/code-gateway';

const ffmpeg=resolve('apps/desktop/resources/staged/media-runtime/ffmpeg.exe');
/** One pixel of a video frame, decoded by the shipped ffmpeg. */
const pixel=(file:string,x:number,y:number,seconds:number)=>[...execFileSync(ffmpeg,['-ss',String(seconds),'-i',file,'-frames:v','1','-vf',`format=rgb24,crop=1:1:${x}:${y}`,'-f','rawvideo','-pix_fmt','rgb24','-loglevel','error','-'])];
const near=(actual:number[],expected:number[],tolerance=24)=>actual.length===3&&actual.every((v,i)=>Math.abs(v-expected[i])<=tolerance);
const use=(id:string,name:string,input:unknown)=>({type:'tool_use',id,name,input});
const card=`import {AbsoluteFill,useCurrentFrame} from 'remotion';
export default function Card(){
 const frame=useCurrentFrame();
 return <AbsoluteFill data-testid="card" style={{background:frame<15?'rgb(255, 0, 0)':'rgb(0, 0, 255)'}}/>;
}
`;

test('a coded scene plays live in the engine preview, under a lower third, and Export draws its frames, the same for the agent',async()=>{
 test.setTimeout(300000);
 const script=(_body:any,step:number)=>[
  [use('w','write_file',{path:'src/card.tsx',content:card})],
  [use('o','edit_file',{path:'project.json',oldText:'"outputs": []',newText:'"outputs": [{"id":"card","path":"src/card.tsx","kind":"scene","durationInFrames":60}]'})],
  [use('s','edit_file',{path:'project.json',oldText:'"spine": [],',newText:'"spine": [{"id":"c1","assetId":"output:card","srcIn":0,"srcOut":2,"speed":1,"audio":{"mute":true},"reason":"Card"}],'})],
  [use('a','edit_file',{path:'project.json',oldText:'"attached": [],',newText:'"attached": [{"id":"name","type":"overlay","component":"lower_third","start":{"kind":"project","at":"start","offsetSec":0},"durationSec":2,"params":{"text":"Over the scene"},"reason":"Name"}],'})],
  [use('p','publish_project',{})],
  [use('f','finish',{status:'complete',summary:'The card is in the preview.',evidence:[]})]][step]??[];
 const gateway=await codeGateway({script}),profile=mkdtempSync(join(tmpdir(),'dream-scene-export-profile-')),folder=mkdtempSync(join(tmpdir(),'dream-scene-export-')),out=mkdtempSync(join(tmpdir(),'dream-scene-export-out-'));
 writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'local-fixture'}));
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1'}});
 try{
  const page=await app.firstWindow(),errors:string[]=[];await signIn(page);page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);await page.evaluate(()=>window.dream.pickProject(true));
  await page.evaluate(async folder=>{await window.dream.command({type:'create',folder,name:'Scene export'});},folder);await page.reload();
  await page.evaluate(text=>window.dream.command({type:'message',text}),'Make an intro card');
  await expect.poll(async()=>(await page.evaluate(()=>window.dream.command({type:'state'}))).aiStatus,{timeout:120000}).toBe('complete');
  const state:any=await page.evaluate(()=>window.dream.command({type:'state'})),scene=state.footage.assets.find((a:any)=>a.scene?.format==='engine');
  expect(scene).toBeTruthy();expect(state.timeline.attached.some((i:any)=>i.component==='lower_third')).toBe(true);

  // Preview: the scene's own document is placed over the engine's canvas and seeks with the player.
  const selector=`.preview-viewport iframe[src^="dream-engine://app/scene/${scene.id}/"]`;await expect(page.locator(selector)).toHaveCount(1,{timeout:30000});
  const frame=page.frameLocator(selector).locator('[data-testid=card]');
  await page.getByLabel('Preview position').fill('5');await expect(frame).toHaveCSS('background-color','rgb(255, 0, 0)');
  await page.getByLabel('Preview position').fill('30');await expect(frame).toHaveCSS('background-color','rgb(0, 0, 255)');
  // The lower third lies over the scene, so it is drawn on the transparent canvas above it.
  const overlay=await page.evaluate(()=>{const canvases=[...document.querySelectorAll('.preview-viewport canvas')] as HTMLCanvasElement[],top=canvases.at(-1)!;
   const copy=document.createElement('canvas');copy.width=top.width;copy.height=top.height;const ctx=copy.getContext('2d')!;ctx.drawImage(top,0,0);
   const data=ctx.getImageData(0,0,copy.width,copy.height).data;let opaque=0;for(let i=3;i<data.length;i+=4)if(data[i]>200)opaque++;
   return{count:canvases.length,visible:getComputedStyle(top).visibility,opaque,corner:[...ctx.getImageData(2,2,1,1).data]};});
  expect(overlay.count).toBe(2);expect(overlay.visible).toBe('visible');expect(overlay.opaque).toBeGreaterThan(100);expect(overlay.corner[3]).toBe(0);

  // Export: the same frames, drawn by the scene in a hidden window and composited by the engine with the lower third.
  await app.evaluate(({dialog},out)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[out]});},out);
  await page.getByRole('button',{name:'Export',exact:true}).first().click();const dialog=page.getByRole('dialog',{name:'Export'});
  await dialog.getByLabel('Choose folder').click();await expect(dialog.locator('.export-folder')).toHaveAttribute('title',out);
  await dialog.getByRole('button',{name:'Export',exact:true}).click();
  await expect(dialog.getByText('Exported')).toBeVisible({timeout:180000});
  const file=readdirSync(out).find(f=>f.endsWith('.mp4'));expect(file).toBeTruthy();const video=join(out,file!);expect(existsSync(video)).toBe(true);
  const {width,height}=state.timeline.settings;
  const early=pixel(video,8,8,.2),late=pixel(video,8,8,1.5);
  expect(near(early,[255,0,0]),`frame at 0.2 s is ${early}`).toBe(true);expect(near(late,[0,0,255]),`frame at 1.5 s is ${late}`).toBe(true);
  // Somewhere along the bottom the lower third covers the scene.
  const bottom=Array.from({length:16},(_,n)=>pixel(video,Math.round(width*(n+.5)/16),Math.round(height*.8),1.5));
  expect(bottom.some(p=>!near(p,[0,0,255],40))).toBe(true);
  // The agent's export (an approved render_video) runs the same engine export, so it comes out the same as the button's.
  await page.evaluate(()=>window.dream.grantComputer());const agentVideo=join(out,'agent.mp4');
  const receipt:any=await page.evaluate(r=>window.dream.files({action:'propose',requestId:'agent-export',title:'Export the video',operations:[{kind:'render_video',path:r.path,projectId:r.projectId,versionId:r.versionId}]}),{path:agentVideo,projectId:state.meta.id,versionId:state.versionId});
  expect(receipt.status,receipt.error).toBe('complete');expect(existsSync(agentVideo)).toBe(true);
  for(const [x,y,t] of [[8,8,.2],[8,8,1.5],...bottom.map((_,n)=>[Math.round(width*(n+.5)/16),Math.round(height*.8),1.5])]){const a=pixel(agentVideo,x,y,t),b=pixel(video,x,y,t);expect(near(a,b,6),`agent ${a} vs button ${b} at ${x},${y} ${t}s`).toBe(true);}
  expect(errors).toEqual([]);
 }finally{await app.close();await gateway.close?.();}
});
