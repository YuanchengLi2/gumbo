import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {codeGateway,finish} from '../fixtures/code-gateway';

/** No guests: the app opens without an account, and the first request to Figjam AI asks to sign in (Google, or an
 * emailed code), then goes on by itself. Signing out in Settings brings the dialog back for the next request. Saves the
 * dialog to test-results/sign-in. */
test('Figjam AI asks to sign in with a code or Google, then carries on with the request',async()=>{
 test.setTimeout(180000);
 const profile=mkdtempSync(join(tmpdir(),'dream-signin-profile-')),out=resolve('test-results/sign-in');mkdirSync(out,{recursive:true});
 const gateway=await codeGateway({script:()=>finish('done','Hello.')});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'fixture'}));
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
 try{
  const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
  // Without an account the app works, but asking the AI opens sign-in.
  expect(await page.evaluate(async()=>(await window.dream.command<any>({type:'account',action:'get'})).signedIn)).toBe(false);
  const prompt=page.getByRole('textbox').first();await prompt.fill('Make a short intro');await prompt.press('Enter');
  const dialog=page.getByRole('dialog',{name:'Sign in to Figjam'});await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Continue with Google'})).toBeVisible();await page.screenshot({path:join(out,'email.png')});
  await dialog.getByLabel('Email').fill('Creator@Example.com');await dialog.getByRole('button',{name:'Email me a code'}).click();
  await expect(dialog).toContainText('We sent a code to creator@example.com');await expect(dialog.getByRole('button',{name:/Send a new code in \d+s/})).toBeDisabled();
  await page.screenshot({path:join(out,'code.png')});
  await dialog.getByLabel('Code').fill('1234 5678');await dialog.getByRole('button',{name:'Sign in',exact:true}).click();
  // Signed in, the request goes on: the project opens with the message sent.
  await expect(dialog).toHaveCount(0);
  await expect.poll(()=>page.evaluate(async()=>(await window.dream.command<any>({type:'account',action:'get'})).signedIn)).toBe(true);
  await expect(page.getByLabel('Ask Figjam to edit')).toBeVisible({timeout:60000});
  // Settings shows the account; signing out brings sign-in back for the next request.
  await page.getByRole('button',{name:'Settings'}).first().click();const settings=page.getByRole('dialog',{name:'Settings'});
  await settings.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Account'}).click();
  await expect(settings).toContainText('local-fixture@example.invalid');
  await settings.getByRole('button',{name:'Sign out'}).click();
  await expect(settings.getByRole('button',{name:'Sign in'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(settings).toHaveCount(0);
  await expect.poll(async()=>(await page.evaluate(async()=>(await window.dream.command({type:'state'})))).aiStatus,{timeout:60000}).not.toBe('running');
  await page.getByLabel('Ask Figjam to edit').fill('Now add music');await page.getByRole('button',{name:'Send prompt'}).click();
  await expect(page.getByRole('dialog',{name:'Sign in to Figjam'})).toBeVisible();
  await page.getByRole('button',{name:'Close sign-in'}).click();await expect(page.getByRole('dialog',{name:'Sign in to Figjam'})).toHaveCount(0);
  expect(errors).toEqual([]);
 }finally{await app.close();await gateway.close();}
});
