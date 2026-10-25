import {test,expect,type Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import ffmpeg from 'ffmpeg-static';

/** A long recording plays the moment it is dropped (project/staged.ts): before its copy into the browser's storage is
 * done, it is registered, placed on the timeline, played and shown, read straight from the file the user gave; the copy
 * then finishes behind the scenes, the project holds its own, and the waiting copy is gone. */
const source=resolve('artifacts/fixtures/source.mp4'),big=resolve('artifacts/fixtures/long-upload.mp4');
const state=(page:Page)=>page.evaluate(()=>(window as any).dream.command({type:'state'}));

test('a long recording plays at once while it copies in',async({page})=>{
 test.setTimeout(300_000);
 // About 300 MB: long enough that its copy takes seconds.
 if(!existsSync(big))execFileSync(ffmpeg!,['-v','error','-y','-stream_loop','-1','-t','600','-i',source,'-c:v','libx264','-preset','ultrafast','-b:v','4M','-c:a','aac',big]);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('gumbo-onboarded','1');});
 await page.goto('/app/');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:60_000});
 await page.evaluate(()=>(window as any).dream.createProject({requestId:'instant-'+Date.now(),text:'',paths:[]}));
 await page.reload();await page.getByRole('button',{name:'Untitled project'}).first().click();await expect(page.getByText('Your canvas is ready')).toBeVisible({timeout:30_000});
 await page.getByRole('button',{name:'Media'}).first().click();
 await page.evaluate(async url=>{(window as any).__big=new File([await (await fetch(url)).blob()],'long-upload.mp4',{type:'video/mp4'});},'/app/@fs/'+big.replace(/\\/g,'/'));
 await page.evaluate(()=>{const data=new DataTransfer();data.items.add((window as any).__big);const panel=document.querySelector<HTMLElement>('.project-media')!;for(const type of ['dragover','drop'])panel.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:data}));});
 await expect.poll(async()=>(await state(page)).footage.assets[0]?.playback?.ready,{timeout:3_000}).toBe(true);
 const asset=(await state(page)).footage.assets[0];expect(asset.originalPath).toMatch(/^\/imports\//);
 await expect(page.getByText('Drop media here to start your edit')).toBeVisible({timeout:15_000});
 await page.evaluate(id=>{const lane=document.querySelector<HTMLElement>('.manual-track-lane[data-track="video"]')!,box=lane.getBoundingClientRect(),data=new DataTransfer();data.setData('application/x-dream-asset',id);
  const at={bubbles:true,cancelable:true,dataTransfer:data,clientX:box.left+4,clientY:box.top+box.height/2};for(const type of ['dragenter','dragover','drop'])lane.dispatchEvent(new DragEvent(type,at));},asset.id);
 await expect.poll(async()=>(await state(page)).timeline.spine.length,{timeout:15_000}).toBe(1);
 await page.getByRole('button',{name:'Play'}).first().click();await page.waitForTimeout(1500);await page.getByRole('button',{name:'Pause'}).first().click();
 await page.waitForTimeout(600);const shot=await page.locator('.preview-frame').first().screenshot();
 const grey=execFileSync(ffmpeg!,['-v','error','-i','pipe:0','-vf','scale=32:18','-f','rawvideo','-pix_fmt','gray','-'],{input:shot});
 expect(grey.reduce((n,x)=>n+x,0)/grey.length).toBeGreaterThan(30);
 // All of that before the project's copy finished.
 const copyNow=(await state(page)).jobs.find((j:any)=>j.assetId===asset.id&&j.step==='copy')?.status;expect(copyNow).not.toBe('complete');
 // Then the copy finishes behind the scenes: the project holds its own, and nothing waits in /imports.
 await expect.poll(async()=>(await state(page)).footage.assets[0].originalPath,{timeout:240_000,intervals:[2000]}).toMatch(/\/Media\/Originals\//);
 await expect.poll(()=>page.evaluate(async()=>{const root=await navigator.storage.getDirectory();try{const names:string[]=[];for await(const name of (await root.getDirectoryHandle('imports') as any).keys())names.push(name);return names;}catch{return [];}}),{timeout:30_000}).toEqual([]);
 expect(errors).toEqual([]);
});
