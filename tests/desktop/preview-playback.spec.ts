import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {codeGateway,signIn} from '../fixtures/code-gateway';

const use=(id:string,name:string,input:unknown)=>({type:'tool_use',id,name,input});

/** Plays an edit of six one-second cuts in the real preview and measures how smoothly it plays: how often a clip's video is
 * seeked while playing (each seek is a visible hitch), how long the work for one display frame takes, and how many frames
 * arrive late. The window is shown (without focus) because a hidden window gets no animation frames. */
test('the preview plays through cuts without seeking or dropping frames',async()=>{
 test.setTimeout(240000);let assetId='';
 const cuts=[[3,4],[0,1],[4.5,5.5],[1,2],[2.5,3.5],[.5,1.5]];
 const script=(_body:any,step:number)=>[
  [use('s','edit_file',{path:'project.json',oldText:'"spine": [],',newText:`"spine": [${cuts.map(([a,b],i)=>`{"id":"c${i}","assetId":"${assetId}","srcIn":${a},"srcOut":${b},"speed":1,"reason":"Cut ${i}"}`).join(',')}],`})],
  [use('p','publish_project',{})],
  [use('f','finish',{status:'complete',summary:'Cut the clip into six shots.',evidence:[]})]][step]??[];
 const profile=mkdtempSync(join(tmpdir(),'dream-playback-profile-')),folder=mkdtempSync(join(tmpdir(),'dream-playback-project-')),source=join(profile,'source.mp4');copyFileSync(resolve('artifacts/fixtures/source.mp4'),source);
 const gateway=await codeGateway({script});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'fixture'}));
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
 try{
  const page=await app.firstWindow(),errors:string[]=[];await signIn(page);page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},folder);await page.evaluate(()=>window.dream.pickProject(true));
  await page.evaluate(async folder=>{await window.dream.command({type:'create',folder,name:'Playback'});},folder);await page.reload();
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
  const [path]=await page.evaluate(()=>window.dream.pickMedia());await page.evaluate(async path=>window.dream.command({type:'import',paths:[path],copy:true}),path);
  await expect.poll(()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).footage.assets[0]?.playback?.ready??false),{timeout:60000}).toBe(true);
  assetId=await page.evaluate(async()=>(await window.dream.command({type:'state'})).footage.assets[0].id);
  await page.getByLabel('Ask Gumbo to edit').fill('Cut my clip into six shots');await page.getByRole('button',{name:'Send prompt'}).click();
  await expect.poll(async()=>(await page.evaluate(async()=>(await window.dream.command({type:'state'})))).aiStatus,{timeout:60000}).toBe('complete');
  await expect(page.locator('.assistant-timeline [data-item-id="c5"]')).toBeVisible();await page.waitForTimeout(1500);

  // Count seeks of the preview's videos, time every animation-frame callback, and note late frames while it plays.
  await page.evaluate(()=>{const w=window as any,stats=w.__playback={seeks:0,frames:[] as number[],work:[] as number[]};
   const desc=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime')!;
   Object.defineProperty(HTMLMediaElement.prototype,'currentTime',{configurable:true,get(){return desc.get!.call(this);},set(v){if(this instanceof HTMLVideoElement&&w.__measuring)stats.seeks++;desc.set!.call(this,v);}});
   const raf=window.requestAnimationFrame.bind(window);
   // React renders a store update in a microtask queued during the callback, so the one queued after it runs once that is done.
   window.requestAnimationFrame=(cb)=>raf(t=>{const start=performance.now();cb(t);queueMicrotask(()=>{if(w.__measuring)stats.work.push(performance.now()-start);});});
   let last=0;const tick=(t:number)=>{if(w.__measuring&&last)stats.frames.push(t-last);last=t;raf(tick);};raf(tick);});
  await page.getByRole('button',{name:'Play'}).first().click();await page.waitForTimeout(400);await page.getByRole('button',{name:'Pause'}).first().click();
  await page.locator('.scrubber').fill('0');await page.waitForTimeout(800);
  await page.evaluate(()=>{(window as any).__measuring=true;});
  await page.getByRole('button',{name:'Play'}).first().click();
  await expect(page.getByRole('button',{name:'Play'}).first()).toBeVisible({timeout:15000});
  const stats=await page.evaluate(()=>{const s=(window as any).__playback;(window as any).__measuring=false;const sorted=[...s.work].sort((a:number,b:number)=>a-b),pick=(q:number)=>sorted[Math.floor(q*(sorted.length-1))]??0;
   const interval=[...s.frames].sort((a:number,b:number)=>a-b)[Math.floor(s.frames.length/2)]??16.7;
   return{seeks:s.seeks,frames:s.frames.length,late:s.frames.filter((d:number)=>d>interval*1.8).length,interval,workMedian:pick(.5),workP95:pick(.95),workMax:sorted.at(-1)??0};});
  console.log('playback stats',JSON.stringify(stats));
  expect(errors).toEqual([]);
  // Each clip's video is parked on its first frame once before its cut, and the cut itself needs no seek (it was 61 when the
  // next clip was re-seeked every frame on its way in).
  expect(stats.seeks).toBeLessThanOrEqual(cuts.length);
  expect(stats.late/stats.frames).toBeLessThan(.05);
 }finally{await app.close();await gateway.close();}
});
