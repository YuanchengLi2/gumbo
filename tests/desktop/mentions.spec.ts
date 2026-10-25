import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {codeGateway,finish,signIn,type Script} from '../fixtures/code-gateway';

/** The composer's @ menu end to end in the packaged app: typing @mr offers MrBeast from the style library, Enter writes
 * @MrBeast into the message, and the agent receives the mention resolved with the message: who it is and Gumbo's guide
 * to their editing style. */
test('@ picks a creator, and the agent gets their style with the message',async()=>{
 const profile=mkdtempSync(join(tmpdir(),'gumbo-mentions-profile-'));
 const seen:{context?:string}={};
 const script:Script=body=>{
  // The first message's text: the session start, then the request with its context.
  const content=body.messages?.[0]?.content,first=typeof content==='string'?content:Array.isArray(content)?content.map((b:any)=>b?.text??'').join(' '):'';
  if(first.includes('@MrBeast'))seen.context=first;
  return finish('styled','Matched the style.');
 };
 const gateway=await codeGateway({script,delayMs:200});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'fixture'}));
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
 try{
  const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await signIn(page);
  const box=page.getByLabel('Ask Gumbo to edit');await expect(box).toBeVisible({timeout:30000});
  await box.click();await page.keyboard.type('Make the intro like @mr');
  const menu=page.locator('.creator-menu');await expect(menu).toBeVisible();
  await expect(menu.getByRole('option').first()).toContainText('MrBeast');await expect(menu).toContainText('Style guide');await expect(menu).toContainText('Edit in the style of');
  writeFileSync(resolve('artifacts/mention-menu.png'),Buffer.from(await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')),'base64'));
  await page.keyboard.press('Enter');
  await expect(box).toHaveValue('Make the intro like @MrBeast ');await expect(menu).toHaveCount(0);
  // Esc closes the menu without picking, and Enter then sends.
  await page.keyboard.type('with big captions @vo');await expect(menu).toBeVisible();await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);
  await page.keyboard.press('Backspace');await page.keyboard.press('Backspace');await page.keyboard.press('Backspace');
  await page.getByRole('button',{name:'Send prompt'}).click();
  await expect.poll(()=>page.evaluate(async()=>(await window.dream.command({type:'state'}) as any).aiStatus),{timeout:90000}).toBe('complete');
  expect(seen.context).toContain("@MrBeast is MrBeast. Gumbo's guide to their editing style:");expect(seen.context).toContain('never use their footage');
  expect(errors).toEqual([]);
 }finally{await app.close();await gateway.close?.();}
});
