import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,mkdirSync,writeFileSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {codeGateway,finish,signIn} from '../fixtures/code-gateway';

const use=(id:string,name:string,input:any)=>({type:'tool_use',id,name,input});
// The agent's script cuts three clips, warms one with its own grade, and adds a punch zoom and a grade over a stretch.
const cut=`const fs=require('fs');const p=JSON.parse(fs.readFileSync('project.json','utf8'));const a=JSON.parse(fs.readFileSync('footage/assets.json','utf8'))[0].id;
const clip=(id,i,o,extra={})=>({id,assetId:a,srcIn:i,srcOut:o,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'Live draft',...extra});
p.timeline.spine=[clip('one',0,1.5),clip('two',2,3.5,{framing:{mode:'fit',scale:1,x:.5,y:.5,temperature:.4}}),clip('three',4,5.5)];
p.timeline.attached=[{id:'zoom',type:'effect',component:'punch_zoom',start:{kind:'clip',clipId:'two',at:'start',offsetSec:0},durationSec:1,params:{amount:.15},layer:0,reason:''},{id:'look',type:'effect',component:'grade',start:{kind:'project',at:'start',offsetSec:0},durationSec:4,params:{saturation:1.2},layer:0,reason:''}];
fs.writeFileSync('project.json',JSON.stringify(p,null,2));`;

test('shows the agent\'s edit on the timeline as soon as its script writes it, as effect, filter and clip blocks, while it is still working',async()=>{
 test.setTimeout(240000);
 const profile=mkdtempSync(join(tmpdir(),'dream-live-profile-')),folder=mkdtempSync(join(tmpdir(),'dream-live-project-')),source=join(profile,'source.mp4');copyFileSync(resolve('artifacts/fixtures/source.mp4'),source);
 // Each response waits, so the edit is on screen for a while before the reply.
 const gateway=await codeGateway({delayMs:5000,script:(_body,step)=>step===0?[use('cut-write','write',{path:'src/cut.cjs',content:cut}),use('cut-run','run',{command:'node src/cut.cjs'})]:finish('done','Cut it into three clips with a zoom and a grade.')});
 writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'fixture'}));
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
 const out=resolve('artifacts/ui');mkdirSync(out,{recursive:true});
 const shot=async(name:string)=>{const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));writeFileSync(join(out,name),Buffer.from(png,'base64'));};
 try{
  const page=await app.firstWindow();await signIn(page);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1600,960));
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},folder);await page.evaluate(()=>window.dream.pickProject(true));
  await page.evaluate(async folder=>{await window.dream.command({type:'create',folder,name:'Live draft'});},folder);await page.reload();
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
  const [path]=await page.evaluate(()=>window.dream.pickMedia());await page.evaluate(async path=>window.dream.command({type:'import',paths:[path],copy:true}),path);
  await expect.poll(()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).footage.assets[0]?.playback?.ready??false),{timeout:60000}).toBe(true);
  await page.getByLabel('Ask Gumbo to edit').fill('Cut this into three clips with a zoom and a warmer look');await page.getByRole('button',{name:'Send prompt'}).click();
  // While Roux is still working: the script's change applied when it finished, and its blocks are on the timeline.
  const clips=page.locator('.assistant-timeline .track.video .timeline-item');
  await expect(clips).toHaveCount(3,{timeout:60000});
  expect((await page.evaluate(async()=>(await window.dream.command({type:'state'})).aiStatus))).toBe('running');
  expect((await page.evaluate(async()=>(await window.dream.command({type:'state'})).timeline.spine.length))).toBe(3);
  await expect(page.locator('.assistant-timeline .look-effect')).toContainText('Punch zoom');await expect(page.locator('.assistant-timeline .look-filter').first()).toContainText('Grade');
  await expect(page.locator('.assistant-timeline .derived')).toContainText('warm');
  await page.waitForTimeout(1500);await shot('live-draft.png');
  // Once it replies, the same blocks are the edit.
  await expect.poll(()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).aiStatus),{timeout:90000}).toBe('complete');
  await expect(page.locator('.live-editing')).toHaveCount(0);await expect(clips).toHaveCount(3);
 }finally{await app.close();await gateway.close();}
});
