import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';

/** Screenshots of the editing workspace on a real project, for judging the layout by eye.
 * DREAM_UI_PROJECT=<project folder> npx playwright test tests/desktop/workspace-layout.spec.ts
 * Writes artifacts/ui/*.png. Skipped without a project. */
test('shows the editing workspace on a real project',async()=>{
 const folder=process.env.DREAM_UI_PROJECT;test.skip(!folder,'Set DREAM_UI_PROJECT to a project folder.');test.setTimeout(120000);
 const profile=mkdtempSync(join(tmpdir(),'dream-ui-')),out=resolve('artifacts/ui');mkdirSync(out,{recursive:true});
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:['--user-data-dir='+profile],env:{...process.env,DREAM_HEADLESS:'1'}});
 try{
  const page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setContentSize(1600,960);});
  // The window is headless, so capture through Electron rather than waiting on the page's fonts.
  const shot=async(name:string)=>{const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));writeFileSync(join(out,name),Buffer.from(png,'base64'));};
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},resolve(folder!));
  await page.evaluate(()=>window.dream.pickProject(true));await page.evaluate(async folder=>{await window.dream.command({type:'open',folder});},resolve(folder!));await page.reload();
  await page.getByRole('button',{name:/Open|Recent/}).first().click({timeout:5000}).catch(()=>{});
  await expect(page.locator('.workspace-header, .editor-workspace').first()).toBeVisible({timeout:30000});
  await page.waitForTimeout(2500);await shot('workspace.png');
  const clip=page.locator('.assistant-timeline .track.video .timeline-item').nth(2);if(await clip.count()){await clip.click();await page.waitForTimeout(400);await shot('workspace-selected.png');}
  // A finished request's steps, opened, and the mode menu.
  const work=page.locator('.turn-work>summary').last();if(await work.count()){await work.click();await work.scrollIntoViewIfNeeded();await page.waitForTimeout(400);await shot('workspace-stream.png');}
  await page.getByRole('button',{name:/^Permissions:/}).click();await page.waitForTimeout(300);await shot('workspace-menu.png');await page.keyboard.press('Escape');
  // The media bin, and its selection.
  await page.locator('.sidebar-tabs button',{hasText:'Media'}).click();await page.waitForTimeout(1500);await shot('workspace-media.png');
  await page.locator('.asset-select').nth(1).click();await page.locator('.asset-select').nth(3).click();await page.locator('.asset-card').nth(5).hover();await page.waitForTimeout(800);await shot('workspace-media-selected.png');
  // Home, with this project and any other in DREAM_UI_PROJECTS among the recent ones.
  for(const other of (process.env.DREAM_UI_PROJECTS??'').split(';').filter(Boolean)){await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},resolve(other));await page.evaluate(()=>window.dream.pickProject(true));await page.evaluate(async folder=>{await window.dream.command({type:'open',folder});},resolve(other));}
  await page.getByLabel('Back to projects').click();await expect(page.locator('.fig-home .project-card').first()).toBeVisible({timeout:15000});await page.waitForTimeout(1500);await shot('home.png');
 }finally{await app.close();}
});
