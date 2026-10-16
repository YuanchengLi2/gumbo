import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {codeGateway,signIn} from '../fixtures/code-gateway';

/** Settings as a page with a sidebar: every section opens, the profile and switched-off providers are saved for the next
 * start (settings.json), the AI and export choices are the ones the chat box and Export window use, and Esc closes it.
 * Saves each section in light and dark to test-results/settings. */
test('Settings opens every section and keeps what is changed',async()=>{
 test.setTimeout(180000);
 const profile=mkdtempSync(join(tmpdir(),'dream-settings-profile-'));
 const gateway=await codeGateway({script:()=>[]});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'fixture'}));
 const launch=()=>electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
 const out=resolve('test-results/settings');mkdirSync(out,{recursive:true});
 let app=await launch();
 try{
  const page=await app.firstWindow(),errors:string[]=[];await signIn(page);page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
  const settings=page.getByRole('dialog',{name:'Settings'}),nav=page.getByRole('navigation',{name:'Settings sections'});
  await page.getByRole('button',{name:'Settings'}).first().click();await expect(settings).toBeVisible();
  await expect(settings.getByRole('heading',{name:'Profile'})).toBeVisible();
  // Profile: saved when a field is left.
  await settings.getByLabel('Name').fill('Yuan');await settings.getByLabel('What you make').fill('Travel vlogs and anime shorts');
  await settings.getByLabel('Your style').fill('Plain white captions, fast cuts, no zoom');await settings.getByLabel('Name').click();
  await expect.poll(()=>JSON.parse(readFileSync(join(profile,'settings.json'),'utf8')).profile).toEqual({name:'Yuan',makes:'Travel vlogs and anime shorts',style:'Plain white captions, fast cuts, no zoom'});
  // Privacy: DeepSeek switched off is saved; Claude cannot be.
  await nav.getByRole('button',{name:'Privacy'}).click();
  await expect(settings.getByRole('switch',{name:'Claude'})).toBeDisabled();
  await settings.getByRole('switch',{name:'DeepSeek'}).click();await expect(settings.getByRole('switch',{name:'DeepSeek'})).toHaveAttribute('aria-checked','false');
  await expect.poll(()=>JSON.parse(readFileSync(join(profile,'settings.json'),'utf8')).disabledProviders).toEqual(['deepseek']);
  // AI: the composer's own mode and effort.
  await nav.getByRole('button',{name:'AI'}).click();await settings.getByRole('radio',{name:'Plan'}).click();await settings.getByRole('radio',{name:'High'}).click();
  expect(await page.evaluate(()=>[localStorage.getItem('dream-permission'),localStorage.getItem('dream-effort')])).toEqual(['plan','high']);
  // Export: what the Export window starts with.
  await nav.getByRole('button',{name:'Export'}).click();await settings.getByLabel('Resolution').selectOption('1080');await settings.getByLabel('Codec').selectOption('hevc');
  expect(JSON.parse(await page.evaluate(()=>localStorage.getItem('dream-export')??'{}'))).toMatchObject({resolution:'1080',codec:'hevc'});
  // Every section, in light and dark.
  for(const theme of ['Light','Dark']){
   await nav.getByRole('button',{name:'Appearance'}).click();await settings.getByRole('radio',{name:theme}).click();
   for(const section of ['Profile','Appearance','Account','Usage and billing','AI','Files and access','Export','Privacy','Shortcuts','About']){
    await nav.getByRole('button',{name:section}).click();await expect(settings.getByRole('heading',{name:section})).toBeVisible();await page.waitForTimeout(250);
    await page.screenshot({path:join(out,`${theme.toLowerCase()}-${section.toLowerCase().replace(/\W+/g,'-')}.png`)});
   }
  }
  await expect(settings.getByText(/^\d+\.\d+\.\d+/)).toBeVisible();
  await page.keyboard.press('Escape');await expect(settings).toHaveCount(0);
  expect(errors).toEqual([]);
  // The profile is there after the app starts again.
  await app.close();app=await launch();const again=await app.firstWindow();await signIn(again);
  await again.getByRole('button',{name:'Settings'}).first().click();await expect(again.getByRole('dialog',{name:'Settings'}).getByLabel('Name')).toHaveValue('Yuan');
 }finally{await app.close();await gateway.close();}
});
