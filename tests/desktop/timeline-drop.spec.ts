import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {codeGateway,finish} from '../fixtures/code-gateway';

test('drags project media onto the timeline at the drop point and shows selections and attachments as media tiles',async()=>{
 const profile=mkdtempSync(join(tmpdir(),'dream-drop-profile-')),folder=mkdtempSync(join(tmpdir(),'dream-drop-project-')),source=join(profile,'source.mp4');copyFileSync(resolve('artifacts/fixtures/source.mp4'),source);
 const gateway=await codeGateway({script:()=>finish('done','Done.')});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'fixture'}));
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
 try{
  const page=await app.firstWindow();
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},folder);await page.evaluate(()=>window.dream.pickProject(true));
  await page.evaluate(async folder=>{await window.dream.command({type:'create',folder,name:'Drop acceptance'});},folder);await page.reload();
  // Import through the picker (which grants the file), then wait until it is ready to place.
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
  const [path]=await page.evaluate(()=>window.dream.pickMedia());await page.evaluate(async path=>window.dream.command({type:'import',paths:[path],copy:true}),path);
  await expect.poll(()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).footage.assets[0]?.playback?.ready??false),{timeout:60000}).toBe(true);
  // Before any draft the timeline is already there, as a drop zone.
  await page.locator('.sidebar-tabs button',{hasText:'Media'}).click();const card=page.locator('.asset-card').first();await expect(card).toBeVisible();
  const track=page.locator('.assistant-timeline .track.video .manual-track-lane');await expect(track).toContainText('Drop media here to start your edit');
  await card.dragTo(track,{targetPosition:{x:20,y:10}});
  await expect.poll(()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).timeline.spine.length),{timeout:15000}).toBe(1);
  const state=await page.evaluate(async()=>window.dream.command({type:'state'}));expect(state.timeline.spine[0].assetId).toBe(state.footage.assets[0].id);
  // Selecting the clip shows it as a tile with its in-point frame, not a count.
  await page.locator('.assistant-timeline .timeline-item').first().click();
  await expect(page.locator('.selection-strip .media-tile.video video')).toHaveAttribute('src',/dream-media:\/\/.+\/preview#t=0\.00/);
  // Attaching from Media shows a media tile in the composer.
  await card.locator('.asset-select').click();await page.locator('.sidebar-tabs button',{hasText:'Chat'}).click();
  await expect(page.locator('.attachment-list .media-tile.video')).toContainText('source.mp4');
 }finally{await app.close();await gateway.close();}
});
