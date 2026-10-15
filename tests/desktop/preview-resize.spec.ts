import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {codeGateway} from '../fixtures/code-gateway';

const use=(id:string,name:string,input:unknown)=>({type:'tool_use',id,name,input});

/** Dragging the divider between the preview and the timeline makes the preview smaller or larger: the picture must scale
 * with it, showing the same whole frame at every size (never more or less of the video). Saves the preview at each size
 * to test-results/preview-resize. */
test('the preview shows the same whole frame, graphics included, at every height',async()=>{
 test.setTimeout(240000);let assetId='';
 const scene="export default function Card(){\n return <div style={{position:'absolute',left:80,top:80,padding:'28px 40px',background:'#ff00ff',color:'white',fontSize:64,fontFamily:'sans-serif',borderRadius:16}}>Pho - noodle soup</div>;\n}\n";
 const script=(_body:any,step:number)=>[
  [use('w','write_file',{path:'src/card.tsx',content:scene})],
  [use('s','edit_file',{path:'project.json',oldText:'"spine": [],',newText:`"spine": [{"id":"c0","assetId":"${assetId}","srcIn":1,"srcOut":5,"speed":1,"reason":"Clip"}],`})],
  [use('a','edit_file',{path:'project.json',oldText:'"attached": [],',newText:'"attached": [{"id":"card_o","type":"overlay","start":{"kind":"project","at":"start","offsetSec":0},"durationSec":4,"component":"source","params":{},"source":{"assetId":"output:card","srcIn":0,"srcOut":4},"layer":2,"reason":"Card"}],'})],
  [use('o','edit_file',{path:'project.json',oldText:'"outputs": []',newText:'"outputs": [{"id":"card","path":"src/card.tsx","kind":"scene","durationInFrames":120,"transparent":true}]'})],
  [use('p','publish_project',{})],
  [use('f','finish',{status:'complete',summary:'Placed the clip and a card.',evidence:[]})]][step]??[];
 const profile=mkdtempSync(join(tmpdir(),'dream-resize-profile-')),folder=mkdtempSync(join(tmpdir(),'dream-resize-project-')),source=join(profile,'source.mp4');copyFileSync(resolve('artifacts/fixtures/source.mp4'),source);
 const gateway=await codeGateway({script});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'fixture'}));
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
 try{
  const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},folder);await page.evaluate(()=>window.dream.pickProject(true));
  await page.evaluate(async folder=>{await window.dream.command({type:'create',folder,name:'Resize'});},folder);await page.reload();
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
  const [path]=await page.evaluate(()=>window.dream.pickMedia());await page.evaluate(async path=>window.dream.command({type:'import',paths:[path],copy:true}),path);
  await expect.poll(()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).footage.assets[0]?.playback?.ready??false),{timeout:60000}).toBe(true);
  assetId=await page.evaluate(async()=>(await window.dream.command({type:'state'})).footage.assets[0].id);
  await page.getByLabel('Ask Figjam to edit').fill('Place my clip');await page.getByRole('button',{name:'Send prompt'}).click();
  await expect.poll(async()=>(await page.evaluate(async()=>(await window.dream.command({type:'state'})))).aiStatus,{timeout:60000}).toBe('complete');
  await page.locator('.scrubber').fill('30');await page.waitForTimeout(1500);
  const out=resolve('test-results/preview-resize');mkdirSync(out,{recursive:true});
  const measure=()=>page.evaluate(()=>{const frame=document.querySelector('.preview-frame')!.getBoundingClientRect(),canvas=document.querySelector('.preview-frame canvas') as HTMLCanvasElement,c=canvas.getBoundingClientRect();
   const wrap=document.querySelector('.preview-frame canvas + div > div:not([role])')?.getBoundingClientRect();
   return{dpr:devicePixelRatio,scene:wrap?{w:Math.round(wrap.width),h:Math.round(wrap.height)}:null,frame:{w:Math.round(frame.width),h:Math.round(frame.height)},canvasBox:{w:Math.round(c.width),h:Math.round(c.height)},canvasPixels:{w:canvas.width,h:canvas.height}};});
  const resizer=page.getByRole('separator',{name:'Resize timeline'}),results:any[]=[];
  for(const share of [.2,.5,.75,.35]){
   const stage=(await page.locator('.ai-stage').boundingBox())!,handle=(await resizer.boundingBox())!;
   await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
   await page.mouse.move(handle.x+handle.width/2,stage.y+stage.height*(1-share),{steps:8});await page.mouse.up();await page.waitForTimeout(700);
   const m=await measure();results.push({share,...m});await page.locator('.preview-frame').screenshot({path:join(out,`timeline-${Math.round(share*100)}.png`)});
  }
  console.log('sizes',JSON.stringify(results));
  // The picture keeps the project's 16:9 shape and the canvas draws at the size it is shown.
  for(const r of results){expect(r.scene,'the card is shown').toBeTruthy();expect(Math.abs(r.scene.w-r.frame.w)).toBeLessThanOrEqual(2);expect(Math.abs(r.scene.h-r.frame.h)).toBeLessThanOrEqual(2);expect(Math.abs(r.frame.w/r.frame.h-16/9)).toBeLessThan(.02);expect(Math.abs(r.canvasPixels.w/r.canvasPixels.h-16/9)).toBeLessThan(.02);expect(Math.abs(r.canvasPixels.w-Math.min(1920,r.canvasBox.w*r.dpr))).toBeLessThanOrEqual(2);}
  expect(errors).toEqual([]);
 }finally{await app.close();await gateway.close();}
});
