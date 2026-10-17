import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {codeGateway,signIn} from '../fixtures/code-gateway';

const use=(id:string,name:string,input:unknown)=>({type:'tool_use',id,name,input});

test('a reply lists its changes as cards that light up, select and undo each one, and Elements lists everything added',async()=>{
 test.setTimeout(240000);let assetId='';
 const script=(_body:any,step:number)=>[
  [use('s','edit_file',{path:'project.json',oldText:'"spine": [],',newText:`"spine": [{"id":"c1","assetId":"${assetId}","srcIn":0,"srcOut":3,"speed":1,"reason":"Opening"}],`})],
  [use('a','edit_file',{path:'project.json',oldText:'"attached": [],',newText:'"attached": [{"id":"t1","type":"overlay","component":"title_card","start":{"kind":"project","at":"start","offsetSec":0},"durationSec":2,"params":{"text":"Hello"},"reason":"Title"}],'})],
  [use('p','publish_project',{})],
  [use('f','finish',{status:'complete',summary:'Added the clip and a title.',evidence:[]})]][step]??[];
 const profile=mkdtempSync(join(tmpdir(),'dream-cards-profile-')),folder=mkdtempSync(join(tmpdir(),'dream-cards-project-')),source=join(profile,'source.mp4');copyFileSync(resolve('artifacts/fixtures/source.mp4'),source);
 const gateway=await codeGateway({script});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'fixture'}));
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
 try{
  const page=await app.firstWindow(),errors:string[]=[];await signIn(page);page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},folder);await page.evaluate(()=>window.dream.pickProject(true));
  await page.evaluate(async folder=>{await window.dream.command({type:'create',folder,name:'Cards'});},folder);await page.reload();
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
  const [path]=await page.evaluate(()=>window.dream.pickMedia());await page.evaluate(async path=>window.dream.command({type:'import',paths:[path],copy:true}),path);
  await expect.poll(()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).footage.assets[0]?.playback?.ready??false),{timeout:60000}).toBe(true);
  assetId=await page.evaluate(async()=>(await window.dream.command({type:'state'})).footage.assets[0].id);
  await page.getByLabel('Ask Gumbo to edit').fill('Add my clip with a title');await page.getByRole('button',{name:'Send prompt'}).click();
  await expect.poll(async()=>(await page.evaluate(async()=>(await window.dream.command({type:'state'})))).aiStatus,{timeout:60000}).toBe('complete');

  // The reply's change card lists both changes; opening one selects it on the timeline.
  const card=page.getByLabel('Changes');await expect(card).toContainText('2 changes');await expect(card).toContainText('Added source.mp4');await expect(card).toContainText('Added title card “Hello”');
  await card.getByRole('button',{name:/^Added source\.mp4/}).click();await expect(card.locator('.change-details')).toContainText('of the source');
  // Showing a change lights it up on the timeline without selecting it, so nothing goes into the chat box.
  await expect(page.locator('.assistant-timeline [data-item-id="c1"]')).toHaveAttribute('data-ai-touched','true');await expect(page.locator('.selection-strip')).toHaveCount(0);await expect(page.locator('.assistant-timeline [data-item-id="c1"]')).toHaveAttribute('aria-selected','false');
  // Undo on one card reverts that change alone.
  await card.getByRole('button',{name:'Undo Added title card “Hello”'}).click();
  await expect.poll(async()=>(await page.evaluate(async()=>(await window.dream.command({type:'state'})))).timeline.attached.length,{timeout:15000}).toBe(0);
  expect((await page.evaluate(async()=>(await window.dream.command({type:'state'})))).timeline.spine.length).toBe(1);
  await expect(card.getByRole('button',{name:'Undone: Added title card “Hello”'})).toBeVisible();

  // Elements lists the clip as added by Gumbo; picking it selects it, and its X removes it.
  await page.getByRole('button',{name:'Elements',exact:true}).click();const clips=page.getByRole('region',{name:'Clips'});
  await expect(clips).toContainText('source.mp4');await expect(clips).toContainText('Gumbo');
  await page.getByLabel('Only what Gumbo added').check();await expect(clips).toContainText('source.mp4');
  await clips.getByRole('button',{name:/source\.mp4/}).first().click();await expect(page.locator('.assistant-timeline [data-item-id="c1"]')).toHaveAttribute('data-ai-touched','true');await expect(page.locator('.selection-strip')).toHaveCount(0);
  await clips.getByRole('button',{name:'Remove source.mp4'}).click();
  await expect.poll(async()=>(await page.evaluate(async()=>(await window.dream.command({type:'state'})))).timeline.spine.length,{timeout:15000}).toBe(0);
  expect(errors).toEqual([]);
 }finally{await app.close();await gateway.close();}
});
