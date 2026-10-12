import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync,copyFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {codeGateway,scriptedEdit,finishKeeping,resultOf,type Script} from '../fixtures/code-gateway';
test('Dream discovers and imports computer media after one inline approval',async()=>{
 const profile=mkdtempSync(join(tmpdir(),'dream-computer-profile-')),folder=mkdtempSync(join(tmpdir(),'dream-computer-project-')),media=mkdtempSync(join(tmpdir(),'dream-computer-media-')),source=join(media,'holiday-source.mp4');copyFileSync(resolve('artifacts/fixtures/source.mp4'),source);let searches=0;
 // Haiku alone: search the computer, import the found clip, place it on the timeline, publish, finish.
 const script:Script=(body,step)=>{
  if(step===0){searches++;return[{type:'tool_use',id:'search',name:'search',input:{query:'holiday',scope:'computer',path:media}}];}
  if(step===1)return[{type:'tool_use',id:'import',name:'view_media',input:{scope:'computer',path:source}}];
  if(step===2){const asset=resultOf(body,'view_media').assetId;return scriptedEdit('use-'+Date.now(),`p.timeline.spine.push({id:'found-${Date.now()}',assetId:'${asset}',srcIn:0,srcOut:2,speed:1,audio:{gainDb:0,fadeInSec:0,fadeOutSec:0,mute:false},reason:'Use discovered footage'})`);}
  return finishKeeping(body,'done','Found and used your holiday clip.','The second request asked for the same clip again.');
 };
 const gateway=await codeGateway({script});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'fixture'}));
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:['--user-data-dir='+profile],env:{...process.env,DREAM_HEADLESS:'1'}});
 try{const page=await app.firstWindow();await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);await page.evaluate(async folder=>{await window.dream.pickProject(true);await window.dream.command({type:'create',folder,name:'Computer access'});},folder);await page.reload();await page.getByLabel('Ask Figjam to edit').fill('Find my holiday clips on this computer and make a short edit.');await page.getByRole('button',{name:'Send prompt'}).click();await expect(page.getByRole('button',{name:'Allow computer access',exact:true})).toBeVisible();expect((await page.evaluate(()=>window.dream.command({type:'state'}))).footage.assets).toHaveLength(0);
 await page.getByRole('button',{name:'Allow computer access',exact:true}).click();await expect.poll(()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).aiStatus),{timeout:60000}).toBe('complete');await expect(page.getByRole('dialog',{name:'Computer files'})).toHaveCount(0);const first=await page.evaluate(()=>window.dream.command({type:'state'}));expect(first.footage.assets.some(a=>a.filename==='holiday-source.mp4')).toBe(true);expect(first.timeline.spine).toHaveLength(1);
 await page.reload();await page.getByLabel('Ask Figjam to edit').fill('Find the holiday clip on my computer again and add another short cut.');await page.getByRole('button',{name:'Send prompt'}).click();await expect.poll(()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).aiStatus),{timeout:60000}).toBe('complete');await expect(page.getByRole('button',{name:'Allow computer access',exact:true})).toHaveCount(0);expect(searches).toBe(2);expect((await page.evaluate(()=>window.dream.command({type:'state'}))).timeline.spine).toHaveLength(2);
 expect(gateway.calls.filter(c=>c.purpose==='execution').every(c=>c.model==='claude-sonnet-5-5')).toBe(true);
 }finally{await app.close();await gateway.close();}
});
