import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,copyFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

/** Screenshots of the home screen and the editor in light and dark, with Settings open, for judging the design.
 * DREAM_SHOTS=<folder> npx playwright test tests/desktop/design-shots.spec.ts */
test('the home screen and editor in light and dark',async()=>{
 const out=process.env.DREAM_SHOTS;test.skip(!out,'Set DREAM_SHOTS to a folder for the screenshots.');test.setTimeout(180000);mkdirSync(out!,{recursive:true});
 const profile=mkdtempSync(join(tmpdir(),'dream-shots-profile-')),folder=mkdtempSync(join(tmpdir(),'dream-shots-project-')),source=join(profile,'source.mp4');copyFileSync(resolve('artifacts/fixtures/source.mp4'),source);
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
 try{
  const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1536,960));
  const shot=async(name:string)=>{await page.waitForTimeout(250);const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));writeFileSync(join(out!,name),Buffer.from(png,'base64'));};
  const theme=async(choice:'light'|'dark')=>{await page.getByRole('button',{name:'Profile',exact:true}).click();await page.getByRole('menuitem',{name:'Settings'}).click();await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Appearance'}).click();await page.getByRole('radio',{name:choice==='light'?'Light':'Dark'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme',choice);await page.getByRole('button',{name:'Close settings'}).click();};
  await expect(page.getByRole('heading',{name:'What are we cooking today?'})).toBeVisible();
  await theme('light');await shot('home-light-settings.png');await page.keyboard.press('Escape');await shot('home-light.png');
  await theme('dark');await page.keyboard.press('Escape');await shot('home-dark.png');
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},folder);await page.evaluate(()=>window.dream.pickProject(true));
  await page.evaluate(async folder=>{await window.dream.command({type:'create',folder,name:'Design check'});},folder);await page.reload();
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
  const [path]=await page.evaluate(()=>window.dream.pickMedia());await page.evaluate(async path=>window.dream.command({type:'import',paths:[path],copy:true}),path);
  await expect.poll(()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).footage.assets[0]?.playback?.ready??false),{timeout:60000}).toBe(true);
  await page.evaluate(async()=>{const state=await window.dream.command({type:'state'}),a=state.footage.assets[0];await window.dream.command({type:'apply',expectedVersionId:state.versionId,requestId:crypto.randomUUID(),label:'Clip',ops:[{type:'insert_clip',position:0,clip:{id:'c1',assetId:a.id,srcIn:0,srcOut:3,speed:1,reason:'Design check'},reason:'Design check'}]});});
  await page.reload();await expect(page.locator('[data-item-id="c1"]')).toBeVisible();await page.waitForTimeout(4000);
  await shot('editor-dark.png');
  await theme('light');await shot('editor-light-settings.png');await page.keyboard.press('Escape');await page.waitForTimeout(300);await shot('editor-light.png');
  expect(errors).toEqual([]);
 }finally{await app.close();}
});
