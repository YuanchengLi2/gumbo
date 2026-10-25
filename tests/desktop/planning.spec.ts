import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {codeGateway,planningScript,signIn} from '../fixtures/code-gateway';
const executable=resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe');

test('chat planning survives reload, waits for approval and groups the approved workflow into one undo',async()=>{
 const gateway=await codeGateway({script:planningScript(false),transientOnce:true,shortSession:true}),profile=mkdtempSync(resolve(tmpdir(),'dream-plan-profile-')),folder=mkdtempSync(resolve(tmpdir(),'dream-plan-project-'));
 writeFileSync(resolve(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'local-fixture'}));
 const app=await electron.launch({executablePath:executable,args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1'}});
 try{
  const page=await app.firstWindow();await signIn(page);await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);await page.evaluate(()=>window.dream.pickProject(true));await page.evaluate(async folder=>{await window.dream.command({type:'create',folder,name:'Planning acceptance'});await window.dream.command({type:'account',action:'signin',email:'local-fixture@example.invalid',password:'local-fixture'});},folder);await page.reload();
  const before=await page.evaluate(async()=>(await window.dream.command({type:'state'})).versionId);
  await page.getByRole('button',{name:/^Permissions:/}).click();await page.getByRole('menuitemradio',{name:/Plan first/}).click();await expect(page.getByRole('button',{name:'Permissions: Plan first'})).toBeVisible();await page.getByLabel('Ask Gumbo to edit').fill('Plan a square video at 60 fps');await page.getByRole('button',{name:'Send prompt'}).click();
  await expect(page.getByRole('button',{name:'Accept',exact:true})).toBeVisible();await expect(page.getByLabel('What to change in the plan')).toBeVisible();expect(gateway.failures()).toBe(1);expect(await page.evaluate(async()=>(await window.dream.command({type:'state'})).versionId)).toBe(before);
  // Codex-style answer: a change typed under the plan revises it; Accept runs it with the model chosen underneath.
  const changes=page.getByLabel('Proposed edit plan');await changes.getByLabel('What to change in the plan').fill('Keep the natural timing');await changes.getByRole('button',{name:'Send changes'}).click();
  await expect.poll(async()=>(await page.evaluate(async()=>(await window.dream.command({type:'state'})))).messages.some((m:any)=>m.role==='user'&&m.text==='Keep the natural timing'),{timeout:60000}).toBe(true);
  await expect.poll(async()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).aiStatus),{timeout:60000}).toBe('awaiting_approval');
  await page.reload();await page.getByRole('button',{name:'Edit plan',exact:true}).click();const document=await page.getByLabel('Edit plan document').inputValue();expect(document).toContain('Prepare a square 60 fps edit');await page.getByLabel('Edit plan document').fill(document.replace(/### [^\n]+/,'### Preserve natural timing'));await page.getByRole('button',{name:'Save',exact:true}).click();await page.reload();await expect(page.getByLabel('Proposed edit plan')).toContainText('Preserve natural timing');
  const card=page.getByLabel('Proposed edit plan');await card.getByRole('button',{name:/^Model:/}).click();await page.getByRole('menuitemradio',{name:/Haiku/}).click();await expect(card.getByRole('button',{name:'Model: Haiku 5.5'})).toBeVisible();
  const approvedFrom=gateway.calls.length;await card.getByRole('button',{name:'Accept',exact:true}).click();
  await expect.poll(async()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).aiStatus),{timeout:60000}).toBe('complete');expect(await page.evaluate(async()=>(await window.dream.command({type:'state'})).timeline.settings)).toMatchObject({fps:60,width:1080,height:1080});
  expect(gateway.calls.slice(approvedFrom).every(c=>/haiku/i.test(String(c.model)))).toBe(true);
  await page.reload();await page.getByRole('button',{name:'Tasks',exact:true}).click();await expect(page.getByLabel('Tasks in progress')).toContainText('Preserve natural timing');await expect(page.getByLabel('Tasks in progress').getByText('Done',{exact:true})).toHaveCount(2);expect(await page.getByLabel('Tasks in progress').evaluate(el=>el.closest('.conversation'))).toBeNull();writeFileSync(resolve('artifacts/dream-task-dock.png'),Buffer.from(await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64')),'base64'));expect(gateway.refreshes()).toBeGreaterThanOrEqual(4);expect(gateway.streams()).toBeGreaterThanOrEqual(3);
  await page.evaluate(async()=>window.dream.command({type:'undo'}));expect(await page.evaluate(async()=>(await window.dream.command({type:'state'})).timeline.settings)).toMatchObject({fps:30,width:1920,height:1080});
 }finally{await app.close();await gateway.close();}
});

test('a plan whose last step waits on the user asks, and a follow-up message completes it',async()=>{
 const gateway=await codeGateway({script:planningScript(true)}),profile=mkdtempSync(resolve(tmpdir(),'dream-blocked-profile-')),folder=mkdtempSync(resolve(tmpdir(),'dream-blocked-project-'));
 writeFileSync(resolve(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'local-fixture'}));
 const app=await electron.launch({executablePath:executable,args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1'}});
 try{
  const page=await app.firstWindow();await signIn(page);await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);await page.evaluate(()=>window.dream.pickProject(true));await page.evaluate(async folder=>{await window.dream.command({type:'create',folder,name:'Blocked acceptance'});await window.dream.command({type:'account',action:'signin',email:'local-fixture@example.invalid',password:'local-fixture'});},folder);await page.reload();
  await page.getByRole('button',{name:/^Permissions:/}).click();await page.getByRole('menuitemradio',{name:/Plan first/}).click();await expect(page.getByRole('button',{name:'Permissions: Plan first'})).toBeVisible();await page.getByLabel('Ask Gumbo to edit').fill('Plan a square 60 fps edit');await page.getByRole('button',{name:'Send prompt'}).click();await page.getByRole('button',{name:'Accept',exact:true}).click();
  await expect.poll(async()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).aiStatus),{timeout:60000}).toBe('complete');
  await expect(page.getByText('Confirm the square format?').first()).toBeVisible();
  const versions=await page.evaluate(async()=>(await window.dream.command({type:'state'})).versions.length);
  await page.reload();await page.getByRole('button',{name:'Tasks',exact:true}).click();const progress=page.getByLabel('Tasks in progress');await expect(progress.getByText('Done',{exact:true})).toHaveCount(1);
  await expect(page.getByLabel('Continue saved request')).toHaveCount(0);await page.getByLabel('Ask Gumbo to edit').fill('Square format is confirmed; continue.');await page.getByRole('button',{name:'Send prompt'}).click();
  await expect.poll(async()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).aiStatus),{timeout:60000}).toBe('complete');
  // The task window closes for each new request (the bar stays small); opening it again shows both steps done.
  await page.getByRole('button',{name:'Tasks',exact:true}).click();await expect(progress.getByText('Done',{exact:true})).toHaveCount(2);
  const state=await page.evaluate(async()=>window.dream.command({type:'state'}));expect(state.versions).toHaveLength(versions);expect(state.messages.some(m=>m.role==='user'&&m.text==='Square format is confirmed; continue.')).toBe(true);
 }finally{await app.close();await gateway.close();}
});
