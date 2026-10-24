import {test,expect,type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {codeGateway} from '../fixtures/code-gateway';

/** Share link after an export on the web (bridge/share.ts): signed in, the exported video is uploaded to the gateway's
 * storage with its story (the clips it was made from, their length and a still) and the link is usegumbo.app/s/?t=…. */
const fixture=resolve('artifacts/fixtures/source.mp4');
const state=(page:Page)=>page.evaluate(()=>(window as any).dream.command({type:'state'}));

test('share how a video was made, after exporting it',async({page})=>{
 test.setTimeout(240_000);
 const gateway=await codeGateway({providers:{anthropic:true},script:()=>[]}),calls:{create?:any;upload?:number;complete?:any}={};
 try{
  await page.addInitScript(url=>{if(window!==window.top)return;localStorage.setItem('gumbo-cloud',JSON.stringify({url,anonKey:'fixture'}));localStorage.setItem('gumbo-onboarded','1');sessionStorage.setItem('gumbo-sign-in-verifier','fixture-verifier');},gateway.url);
  await page.route('**/dream-gateway/share-create',route=>{calls.create=route.request().postDataJSON();return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'share-1',token:'tok123',objectKey:'u/share-1.mp4',uploadUrl:gateway.url+'/storage/upload'})});});
  await page.route('**/storage/upload',route=>{calls.upload=route.request().postDataBuffer()?.length;return route.fulfill({status:200,body:'{}'});});
  await page.route('**/dream-gateway/share-complete',route=>{calls.complete=route.request().postDataJSON();return route.fulfill({status:200,contentType:'application/json',body:'{"ready":true}'});});
  await page.goto('/app/?code=fixture-code');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:90_000});

  await page.evaluate(()=>(window as any).dream.createProject({requestId:'web-share',text:'',paths:[]}));
  await page.reload();await page.getByRole('button',{name:'Untitled project'}).first().click();
  await expect(page.getByText('Your canvas is ready')).toBeVisible({timeout:30_000});
  await page.getByRole('button',{name:'Media'}).first().click();
  await page.evaluate(async url=>{const file=new File([await (await fetch(url)).blob()],'source.mp4',{type:'video/mp4'}),data=new DataTransfer();data.items.add(file);
   const panel=document.querySelector<HTMLElement>('.project-media')!;for(const type of ['dragover','drop'])panel.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:data}));},'/app/@fs/'+fixture.replace(/\\/g,'/'));
  await expect.poll(async()=>(await state(page)).jobs.find((j:any)=>j.step==='thumbnail')?.status,{timeout:90_000}).toBe('complete');
  const asset=(await state(page)).footage.assets[0];
  await expect(page.getByText('Drop media here to start your edit')).toBeVisible({timeout:15_000});
  await page.evaluate(id=>{const lane=document.querySelector<HTMLElement>('.manual-track-lane[data-track="video"]')!,box=lane.getBoundingClientRect(),data=new DataTransfer();data.setData('application/x-dream-asset',id);
   const at={bubbles:true,cancelable:true,dataTransfer:data,clientX:box.left+4,clientY:box.top+box.height/2};for(const type of ['dragenter','dragover','drop'])lane.dispatchEvent(new DragEvent(type,at));},asset.id);
  await expect.poll(async()=>(await state(page)).timeline.spine.length,{timeout:15_000}).toBe(1);

  await page.getByRole('button',{name:'Export'}).first().click();
  const exporting=page.getByRole('dialog',{name:'Export'});
  await expect(exporting.getByText('Free plan videos end with a small "Edited with Gumbo"')).toBeVisible();
  await Promise.all([page.waitForEvent('download',{timeout:120_000}),exporting.getByRole('button',{name:'Export',exact:true}).click()]);
  await exporting.getByRole('button',{name:'Share link'}).click();
  const share=page.getByRole('dialog',{name:'Share your video'});await share.getByRole('button',{name:'Create link'}).click();
  await expect(share.getByLabel('Share link')).toHaveValue('https://usegumbo.app/s/?t=tok123',{timeout:30_000});
  expect(calls.create).toMatchObject({title:'Untitled project',prompts:[],source:{clips:1,durationSec:6},durationSec:6});
  expect(calls.create.source.stills).toHaveLength(1);expect(calls.create.source.stills[0]).toMatch(/^data:image\/jpeg;base64,/);
  expect(calls.upload).toBeGreaterThan(50_000);expect(calls.complete).toEqual({id:'share-1'});
 }finally{await gateway.close();}
});
