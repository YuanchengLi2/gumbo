import {test,expect,type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';

/** How long a dropped video takes to be usable on the web: shown, copied in, probed, playable, every preparation step.
 * A measurement, not a pass/fail check: UPLOAD_FILE picks the video (default: a 3-minute 1080p clip when present). */
const file=resolve(process.env.UPLOAD_FILE??'marketing/ad2/footage/obby-AlGDfjRQY54.mp4');
const state=(page:Page)=>page.evaluate(()=>(window as any).dream.command({type:'state'}));

test('upload timing',async({page})=>{
 test.skip(!existsSync(file),'no video to measure with');test.setTimeout(600_000);
 await page.addInitScript(()=>{localStorage.setItem('gumbo-onboarded','1');});
 await page.goto('/app/');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:60_000});
 await page.evaluate(()=>(window as any).dream.createProject({requestId:'timing-'+Date.now(),text:'',paths:[]}));
 await page.reload();await page.getByRole('button',{name:'Untitled project'}).first().click();await expect(page.getByText('Your canvas is ready')).toBeVisible({timeout:30_000});
 await page.getByRole('button',{name:'Media'}).first().click();
 // The file is read into the page first (the test's own cost, not the app's), then dropped.
 await page.evaluate(async url=>{(window as any).__file=new File([await (await fetch(url)).blob()],url.split('/').pop()!,{type:'video/mp4'});},'/app/@fs/'+file.replace(/\\/g,'/'));
 const marks:Record<string,number>={};
 const t0=await page.evaluate(()=>{const data=new DataTransfer();data.items.add((window as any).__file);const panel=document.querySelector<HTMLElement>('.project-media')!;const t=performance.now();
  for(const type of ['dragover','drop'])panel.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:data}));return t;});
 const now=()=>page.evaluate(()=>performance.now());
 for(const start=Date.now(),limit=Number(process.env.UPLOAD_LIMIT_S??540)*1000;Date.now()-start<limit;){
  const at=(await now())-t0,s=await state(page).catch(()=>null),a=s?.footage?.assets?.[0];
  if(!marks.tile&&await page.locator('.project-media .asset-card').count())marks.tile=at;
  if(a&&!marks.registered)marks.registered=at;
  if(a?.playback?.ready&&!marks.playable)marks.playable=at;
  if(a?.status==='ready'&&!marks.ready)marks.ready=at;
  for(const j of s?.jobs??[])if(j.status==='complete'&&!marks['job:'+j.step])marks['job:'+j.step]=at;
  if(marks.ready&&(s?.jobs??[]).every((j:any)=>j.status!=='running'&&j.status!=='queued'))break;
  await page.waitForTimeout(150);
 }
 const sizeMb=(await page.evaluate(()=>(window as any).__file.size))/1e6;
 console.log(`UPLOAD ${file.split(/[\\/]/).pop()} ${sizeMb.toFixed(0)} MB`);
 for(const [k,v] of Object.entries(marks).sort((x,y)=>x[1]-y[1]))console.log(`  ${k.padEnd(28)} ${(v/1000).toFixed(2)} s`);
});
