import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {codeGateway,finish} from '../fixtures/code-gateway';

/** No guests, and signing in happens in the browser: the first request to Figjam AI asks to sign in, opens the sign-in
 * page (here the test plays the browser: it answers the app's one-time callback with a code), and the request goes on
 * once the app is signed in. A callback with the wrong state is refused. Signing out in Settings brings the dialog back.
 * Saves the dialog to test-results/sign-in. */
test('Figjam AI asks to sign in in the browser, then carries on with the request',async()=>{
 test.setTimeout(180000);
 const profile=mkdtempSync(join(tmpdir(),'dream-signin-profile-')),out=resolve('test-results/sign-in');mkdirSync(out,{recursive:true});
 const gateway=await codeGateway({script:()=>finish('done','Hello.')});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'fixture'}));
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
 try{
  const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
  expect(await page.evaluate(async()=>(await window.dream.command<any>({type:'account',action:'get'})).signedIn)).toBe(false);
  const prompt=page.getByRole('textbox').first();await prompt.fill('Make a short intro');await prompt.press('Enter');
  const dialog=page.getByRole('dialog',{name:'Sign in to Figjam'});await expect(dialog).toBeVisible();await page.screenshot({path:join(out,'ask.png')});
  // Sign in with your browser: the app opens the sign-in page for a callback on this computer.
  await dialog.getByRole('button',{name:'Sign in with your browser'}).click();
  await expect(dialog).toContainText('Waiting for you to sign in');await page.screenshot({path:join(out,'waiting.png')});
  const {url}=await page.evaluate(()=>window.dream.command<{url:string}>({type:'account',action:'browser'}));
  const signInPage=new URL(url);expect(signInPage.origin+signInPage.pathname).toBe('https://usegumbo.app/signin/');expect(signInPage.searchParams.get('challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const desktop=new URL(signInPage.searchParams.get('desktop')!);expect(desktop.hostname).toBe('127.0.0.1');expect(desktop.pathname).toBe('/callback');
  // A callback that is not this sign-in's is refused; the right one signs in.
  const forged=new URL(desktop);forged.searchParams.set('state','forged');forged.searchParams.set('code','x');expect((await fetch(forged)).status).toBe(400);
  desktop.searchParams.set('code','fixture-code');const answer=await fetch(desktop);expect(answer.status).toBe(200);expect(await answer.text()).toContain('signed in to Figjam');
  await expect(dialog).toHaveCount(0);
  await expect.poll(()=>page.evaluate(async()=>(await window.dream.command<any>({type:'account',action:'get'})).signedIn)).toBe(true);
  await expect(page.getByLabel('Ask Figjam to edit')).toBeVisible({timeout:60000});
  // Settings shows the account; signing out brings sign-in back for the next request.
  await page.getByRole('button',{name:'Settings'}).first().click();const settings=page.getByRole('dialog',{name:'Settings'});
  await settings.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Account'}).click();
  await expect(settings).toContainText('local-fixture@example.invalid');
  await settings.getByRole('button',{name:'Sign out'}).click();await expect(settings.getByRole('button',{name:'Sign in'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(settings).toHaveCount(0);
  await expect.poll(async()=>(await page.evaluate(async()=>(await window.dream.command({type:'state'})))).aiStatus,{timeout:60000}).not.toBe('running');
  await page.getByLabel('Ask Figjam to edit').fill('Now add music');await page.getByRole('button',{name:'Send prompt'}).click();
  await expect(page.getByRole('dialog',{name:'Sign in to Figjam'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Sign in to Figjam'})).toHaveCount(0);
  expect(errors).toEqual([]);
 }finally{await app.close();await gateway.close();}
});
