import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync,copyFileSync,mkdirSync,utimesSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {codeGateway,resultOf,scriptedEdit,finish,type Script,signIn} from '../fixtures/code-gateway';

test('finds what was shot today on the computer, imports it in capture order and cuts it together',async()=>{
 const profile=mkdtempSync(join(tmpdir(),'dream-today-profile-')),folder=mkdtempSync(join(tmpdir(),'dream-today-project-')),camera=join(profile,'Camera Roll');mkdirSync(camera);
 // Three clips shot earlier today, named out of order. The capture time is the file time (the fixture video has no camera
 // metadata), so the times are in the past: a copy's own creation time is now, and the earlier of the two counts.
 const ago=(seconds:number)=>new Date(Date.now()-seconds*1000);
 for(const [name,seconds] of [['C.mp4',90],['A.mp4',30],['B.mp4',60]] as const){const target=join(camera,name);copyFileSync(resolve('artifacts/fixtures/source.mp4'),target);utimesSync(target,ago(seconds),ago(seconds));}
 copyFileSync(resolve('artifacts/fixtures/source.mp4'),join(camera,'old.mp4'));utimesSync(join(camera,'old.mp4'),ago(3*86400),ago(3*86400));
 const script:Script=(body,step)=>{
  if(step===0)return[{type:'tool_use',id:'find',name:'media',input:{action:'find',when:'today',folders:[camera],kinds:['video']}}];
  // Found files are listed under their folder, one "name | time | ..." line each; imported ones as "- a_… \"name\"" lines.
  if(step===1)return[{type:'tool_use',id:'import',name:'media',input:{action:'import',paths:[...String(resultOf(body,'media')).matchAll(/^  ([^|]+?) \|/gm)].map(m=>join(camera,m[1].trim()))}}];
  if(step===2){const ids=[...String(resultOf(body,'media')).matchAll(/^- (a_\S+) /gm)].map(m=>m[1]);return scriptedEdit('today',`p.timeline.spine=${JSON.stringify(ids)}.map((assetId,n)=>({id:'today-'+n,assetId,srcIn:0,srcOut:1,speed:1,audio:{gainDb:0,fadeInSec:0,fadeOutSec:0,mute:false},reason:'Shot today'}))`);}
  return finish('done','Cut your three clips from today together in the order you shot them.');
 };
 const gateway=await codeGateway({script});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'fixture'}));
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
 try{
  const page=await app.firstWindow();await signIn(page);
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},folder);await page.evaluate(()=>window.dream.pickProject(true));
  await page.evaluate(async folder=>{await window.dream.command({type:'create',folder,name:'Today acceptance'});await window.dream.command({type:'account',action:'signin',email:'local-fixture@example.invalid',password:'local-fixture'});},folder);
  await page.evaluate(()=>window.dream.grantComputer());await page.reload();
  await page.getByLabel('Ask Gumbo to edit').fill('Look at what I shot today and make a short');await page.getByRole('button',{name:'Send prompt'}).click();
  await expect.poll(()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).aiStatus),{timeout:120000}).toBe('complete');
  const state=await page.evaluate(async()=>window.dream.command({type:'state'}));
  // Only today's three clips were imported, and they play in the order they were shot.
  expect(state.footage.assets.map((a:any)=>a.filename).sort()).toEqual(['A.mp4','B.mp4','C.mp4']);
  const order=state.timeline.spine.map((c:any)=>state.footage.assets.find((a:any)=>a.id===c.assetId)?.filename);expect(order).toEqual(['C.mp4','B.mp4','A.mp4']);
  expect(state.footage.assets.every((a:any)=>a.capturedAt&&a.source?.path)).toBe(true);
  // The import shows up in the chat stream as media.
  await expect(page.locator('.stream-media .stream-thumb').first()).toBeVisible();
 }finally{await app.close();await gateway.close();}
});
