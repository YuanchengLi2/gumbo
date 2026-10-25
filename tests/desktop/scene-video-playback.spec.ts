import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {codeGateway,signIn} from '../fixtures/code-gateway';

const use=(id:string,name:string,input:unknown)=>({type:'tool_use',id,name,input});

/** A scene that plays the source video itself, twice (a blurred copy filling the frame and a sharp one in front), the
 * way the agent builds a vertical short's layout: while the preview plays, the scene must keep up with the frames it is
 * asked for instead of seeking its videos on every frame. Also checks the Fullscreen button fills the screen with the
 * picture. Saves what it sees to test-results/scene-video-playback. */
test('a scene with video in it plays smoothly, and fullscreen shows the picture',async()=>{
 test.setTimeout(300000);let assetId='';
 const scene=(id:string)=>`import React from 'react';\nimport {AbsoluteFill} from 'remotion';\nimport {SourceVideo,asset} from '@dream/engine';\nexport default function Layout(){\n const video=(style:React.CSSProperties)=><SourceVideo src={asset('${id}')} style={style}/>;\n return <AbsoluteFill style={{background:'#000'}}>\n  <AbsoluteFill style={{filter:'blur(32px)'}}>{video({position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover'})}</AbsoluteFill>\n  <div style={{position:'absolute',left:0,top:'30%',width:'100%',height:'40%',overflow:'hidden'}}>{video({width:'100%',height:'100%',objectFit:'cover'})}</div>\n </AbsoluteFill>;\n}\n`;
 const script=(_body:any,step:number)=>[
  [use('w','write',{path:'src/layout.tsx',content:scene(assetId)})],
  [use('s','edit',{path:'project.json',oldText:'"spine": [],',newText:`"spine": [{"id":"c0","assetId":"${assetId}","srcIn":0,"srcOut":6,"speed":1,"reason":"Clip"}],`})],
  [use('a','edit',{path:'project.json',oldText:'"attached": [],',newText:'"attached": [{"id":"layout_o","type":"overlay","start":{"kind":"project","at":"start","offsetSec":0},"durationSec":6,"component":"source","params":{},"source":{"assetId":"output:layout","srcIn":0,"srcOut":6},"layer":2,"reason":"Layout"}],'})],
  [use('o','edit',{path:'project.json',oldText:'"outputs": []',newText:'"outputs": [{"id":"layout","path":"src/layout.tsx","kind":"scene","durationInFrames":180}]'})],
  [{type:'text',text:'Built the layout.'}]][step]??[];
 const profile=mkdtempSync(join(tmpdir(),'dream-scenevideo-profile-')),folder=mkdtempSync(join(tmpdir(),'dream-scenevideo-project-')),source=join(profile,'source.mp4');copyFileSync(resolve('artifacts/fixtures/source.mp4'),source);
 const gateway=await codeGateway({script});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'fixture'}));
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
 try{
  const page=await app.firstWindow(),errors:string[]=[];await signIn(page);page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},folder);await page.evaluate(()=>window.dream.pickProject(true));
  await page.evaluate(async folder=>{await window.dream.command({type:'create',folder,name:'Scene video'});},folder);await page.reload();
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
  const [path]=await page.evaluate(()=>window.dream.pickMedia());await page.evaluate(async path=>window.dream.command({type:'import',paths:[path],copy:true}),path);
  await expect.poll(()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).footage.assets[0]?.playback?.ready??false),{timeout:60000}).toBe(true);
  assetId=await page.evaluate(async()=>(await window.dream.command({type:'state'})).footage.assets[0].id);
  await page.getByLabel('Ask Gumbo to edit').fill('Build the layout');await page.getByRole('button',{name:'Send prompt'}).click();
  await expect.poll(async()=>(await page.evaluate(async()=>(await window.dream.command({type:'state'})))).aiStatus,{timeout:90000}).toBe('complete');
  await page.locator('.scrubber').fill('0');await page.waitForTimeout(2500);
  // Count the frames the preview asks the scene for and the frames the scene finishes, while it plays for four seconds.
  await page.evaluate(()=>{const w=window as any;w.__acks=0;w.__asked=0;addEventListener('message',e=>{if(w.__measure&&e.data?.dreamScene&&typeof e.data.requestId==='number'&&!e.data.error)w.__acks++;});
});
  await page.evaluate(()=>{(window as any).__measure=true;});
  await page.getByRole('button',{name:'Play'}).first().click();await page.waitForTimeout(4000);
  const drawn=await page.evaluate(()=>{(window as any).__measure=false;return(window as any).__acks;});
  await page.getByRole('button',{name:'Pause'}).first().click();
  console.log('scene frames drawn in 4s of playback:',drawn);
  const out=resolve('test-results/scene-video-playback');mkdirSync(out,{recursive:true});
  await page.locator('.preview-frame').screenshot({path:join(out,'preview.png')});
  // Fullscreen: the window goes fullscreen and the picture fills it at its own shape; Esc ends it.
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus();});await page.waitForTimeout(500);
  await page.getByTitle('Fullscreen preview').click();await page.waitForTimeout(2000);
  const full=await page.evaluate(()=>{const canvas=document.querySelector('.preview-frame canvas')!.getBoundingClientRect(),viewport=document.querySelector('.preview-viewport')!.getBoundingClientRect();
   return{window:{w:innerWidth,h:innerHeight},viewport:{w:Math.round(viewport.width),h:Math.round(viewport.height)},canvas:{w:Math.round(canvas.width),h:Math.round(canvas.height)}};});
  const windowFull=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen());
  console.log('fullscreen',JSON.stringify({windowFull,...full}));await page.screenshot({path:join(out,'fullscreen.png')});
  expect(windowFull).toBe(true);expect(full.viewport).toEqual({w:full.window.w,h:full.window.h});
  // The 16:9 picture keeps its shape and fills the screen's width or height.
  expect(Math.abs(full.canvas.w/full.canvas.h-1920/1080)).toBeLessThan(.03);expect(Math.max(full.canvas.w/full.window.w,full.canvas.h/full.window.h)).toBeGreaterThan(.97);
  await page.keyboard.press('Escape');await page.waitForTimeout(1500);
  expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);await expect(page.locator('.preview-fullscreen')).toHaveCount(0);
  // Four seconds at 30 fps is 120 frames; a scene that keeps up draws most of them.
  expect(drawn).toBeGreaterThan(90);
  expect(errors).toEqual([]);
 }finally{await app.close();await gateway.close();}
});
