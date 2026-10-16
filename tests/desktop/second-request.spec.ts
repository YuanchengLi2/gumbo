import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {codeGateway,signIn} from '../fixtures/code-gateway';

const use=(id:string,name:string,input:unknown)=>({type:'tool_use',id,name,input});

test('a later request in a project shows its steps, the editing overlay and Stop while a long command runs',async()=>{
 test.setTimeout(240000);let assetId='',turn=0;
 const script=(_body:any,step:number)=>{
  if(step===0)turn++;
  if(turn===1)return[[use('s','edit_file',{path:'project.json',oldText:'"spine": [],',newText:`"spine": [{"id":"c1","assetId":"${assetId}","srcIn":0,"srcOut":3,"speed":1,"reason":"Opening"}],`})],[use('p','publish_project',{})],[use('f','finish',{status:'complete',summary:'Placed the clip.',evidence:[]})]][step]??[];
  // The second request runs a long command, as normalising a long soundtrack does.
  return[[use('r','run_command',{command:'sleep 30',progress:'Normalising the narration'})],[use('p2','publish_project',{})],[use('f2','finish',{status:'complete',summary:'Done.',evidence:[]})]][step]??[];
 };
 const profile=mkdtempSync(join(tmpdir(),'dream-second-profile-')),folder=mkdtempSync(join(tmpdir(),'dream-second-project-')),source=join(profile,'source.mp4');copyFileSync(resolve('artifacts/fixtures/source.mp4'),source);
 const gateway=await codeGateway({script});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'fixture'}));
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
 try{
  const page=await app.firstWindow();await signIn(page);
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},folder);await page.evaluate(()=>window.dream.pickProject(true));
  await page.evaluate(async folder=>{await window.dream.command({type:'create',folder,name:'Second request'});},folder);await page.reload();
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
  const [path]=await page.evaluate(()=>window.dream.pickMedia());await page.evaluate(async path=>window.dream.command({type:'import',paths:[path],copy:true}),path);
  await expect.poll(()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).footage.assets[0]?.playback?.ready??false),{timeout:60000}).toBe(true);
  assetId=await page.evaluate(async()=>(await window.dream.command({type:'state'})).footage.assets[0].id);
  const send=async(text:string)=>{await page.getByLabel('Ask Figjam to edit').fill(text);await page.getByRole('button',{name:'Send prompt'}).click();};
  await send('Place my clip');await expect.poll(async()=>(await page.evaluate(async()=>(await window.dream.command({type:'state'})))).aiStatus,{timeout:60000}).toBe('complete');
  // The second request: while its long command runs, the window must show it.
  await send('Normalise the narration');
  await expect.poll(async()=>(await page.evaluate(async()=>(await window.dream.command({type:'state'})))).experience?.activity?.events?.some((e:any)=>e.tool==='run_command'&&e.status==='running')??false,{timeout:30000}).toBe(true);
  await page.waitForTimeout(1500);
  const seen=await page.evaluate(()=>({bar:!!document.querySelector('.agent-bar'),glow:!!document.querySelector('.agent-glow'),stream:[...document.querySelectorAll('[aria-label="Figjam activity"],[aria-label="What Figjam is doing"]')].map(e=>e.textContent).join(' | '),stop:[...document.querySelectorAll('button')].filter(b=>/stop/i.test(b.getAttribute('aria-label')??b.textContent??'')).length}));
  console.log('SEEN',JSON.stringify(seen));
  expect(seen.stream).toContain('Normalising the narration');expect(seen.bar).toBe(true);expect(seen.glow).toBe(true);expect(seen.stop).toBeGreaterThan(0);
  // Stop ends it.
  await page.locator('.agent-bar').getByRole('button',{name:'Stop'}).click();
  await expect.poll(async()=>(await page.evaluate(async()=>(await window.dream.command({type:'state'})))).aiStatus,{timeout:30000}).not.toBe('running');
 }finally{await app.close();await gateway.close();}
});
