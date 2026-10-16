import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {codeGateway,signIn} from '../fixtures/code-gateway';

const use=(id:string,name:string,input:unknown)=>({type:'tool_use',id,name,input});

test('the agent edits visibly, clips show their frames, and selection, clip actions and chat shortcuts work',async()=>{
 test.setTimeout(240000);let assetId='';
 // The agent places the imported clip by editing project.json, slowly enough to watch it work.
 const script=(_body:any,step:number)=>[
  [use('s','edit_file',{path:'project.json',oldText:'"spine": [],',newText:`"spine": [{"id":"c1","assetId":"${assetId}","srcIn":0,"srcOut":3,"speed":1,"reason":"Opening"}],`})],
  [use('p','publish_project',{})],
  [use('f','finish',{status:'complete',summary:'The clip is on the timeline.',evidence:[]})]][step]??[];
 const profile=mkdtempSync(join(tmpdir(),'dream-polish-profile-')),folder=mkdtempSync(join(tmpdir(),'dream-polish-project-')),source=join(profile,'source.mp4');copyFileSync(resolve('artifacts/fixtures/source.mp4'),source);
 const gateway=await codeGateway({script,delayMs:1500});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'fixture'}));
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
 try{
  const page=await app.firstWindow(),errors:string[]=[];await signIn(page);page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},folder);await page.evaluate(()=>window.dream.pickProject(true));
  await page.evaluate(async folder=>{await window.dream.command({type:'create',folder,name:'Polish'});},folder);await page.reload();
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
  const [path]=await page.evaluate(()=>window.dream.pickMedia());await page.evaluate(async path=>window.dream.command({type:'import',paths:[path],copy:true}),path);
  await expect.poll(()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).footage.assets[0]?.playback?.ready??false),{timeout:60000}).toBe(true);
  assetId=(await page.evaluate(async()=>(await window.dream.command({type:'state'})).footage.assets[0].id));

  // While the agent edits: a blue glow, a status bar with Stop, and Figjam's cursor visiting the block it adds.
  await page.evaluate(()=>{(window as any).__touched=false;new MutationObserver(list=>{if(list.some(m=>m.attributeName==='data-ai-touched'))(window as any).__touched=true;}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-ai-touched']});});
  const sentAt=Date.now();await page.getByLabel('Ask Figjam to edit').fill('Put my clip on the timeline');await page.getByRole('button',{name:'Send prompt'}).click();
  await expect(page.locator('.agent-bar')).toBeVisible({timeout:30000});await expect(page.locator('.agent-glow')).toBeVisible();await expect(page.locator('.agent-bar').getByRole('button',{name:'Stop'})).toBeVisible();
  // The run's clock starts with the run.
  const started=await page.evaluate(async()=>(await window.dream.command({type:'state'})).experience?.runStartedAt);expect(Math.abs(Date.parse(started!)-sentAt)).toBeLessThan(30000);
  await expect.poll(()=>page.evaluate(()=>(window as any).__touched),{timeout:30000}).toBe(true);
  await expect.poll(async()=>(await page.evaluate(async()=>(await window.dream.command({type:'state'})))).aiStatus,{timeout:60000}).toBe('complete');
  await expect(page.locator('.agent-bar')).toHaveCount(0);await expect(page.locator('.agent-cursor')).toHaveCount(0);

  // The clip shows real frames along its block, decoded from the video.
  const block=page.locator('.assistant-timeline [data-item-id="c1"]');await expect(block).toBeVisible();
  await expect.poll(()=>block.locator('canvas.manual-clip-filmstrip').evaluate((c:HTMLCanvasElement)=>{const d=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let lit=0;for(let i=0;i<d.length;i+=16)if(d[i+3]>0&&(d[i]+d[i+1]+d[i+2])>30)lit++;return lit;}),{timeout:30000}).toBeGreaterThan(50);

  // Each selected element has its own X.
  await block.click();await expect(page.locator('.selection-strip .media-tile')).toHaveCount(1);
  await page.locator('.selection-strip .media-tile').getByRole('button',{name:/^Remove /}).click();await expect(page.locator('.selection-strip')).toHaveCount(0);

  // Right-clicking a block offers its actions.
  await block.click({button:'right'});const menu=page.getByRole('menu',{name:/^Actions for /});await expect(menu).toBeVisible();
  await menu.getByRole('menuitem',{name:/Duplicate/}).click();await expect(menu).toHaveCount(0);
  await expect.poll(async()=>(await page.evaluate(async()=>(await window.dream.command({type:'state'})))).timeline.spine.length,{timeout:15000}).toBe(2);

  // Shortcuts: Ctrl+L types in the chat, Shift+Tab and Ctrl+1/2/3 pick the mode, Ctrl+Shift+M steps through models.
  await page.locator('.preview-viewport').click({position:{x:5,y:5}});await page.keyboard.press('Control+L');await expect(page.getByLabel('Ask Figjam to edit')).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(page.getByRole('button',{name:'Permissions: Plan first'})).toBeVisible();
  await page.keyboard.press('Control+3');await expect(page.getByRole('button',{name:'Permissions: Ask only'})).toBeVisible();
  await page.keyboard.press('Control+1');await expect(page.getByRole('button',{name:'Permissions: Edit automatically'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Model: Auto'})).toBeVisible();await page.keyboard.press('Control+Shift+M');await expect(page.getByRole('button',{name:'Model: Sonnet 5.5'})).toBeVisible();
  expect(errors).toEqual([]);
 }finally{await app.close();await gateway.close();}
});
