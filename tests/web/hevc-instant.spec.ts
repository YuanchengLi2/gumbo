import {test,expect,type Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import ffmpeg from 'ffmpeg-static';

/** Phone footage (HEVC in a .mov) where the browser decodes HEVC itself: it plays the moment it is dropped, with no copy
 * made first (media-io.ts canPreviewOriginal, DREAM_PREVIEW_CODECS), and exports from the original. Where the browser has
 * no HEVC decoder the copy is still made, and this test says so and stops. */
const source=resolve('artifacts/fixtures/source.mp4'),phone=resolve('artifacts/fixtures/phone-hevc.mov');
const state=(page:Page)=>page.evaluate(()=>(window as any).dream.command({type:'state'}));

test('phone footage plays at once and exports',async({page})=>{
 test.setTimeout(240_000);
 if(!existsSync(phone))execFileSync(ffmpeg!,['-v','error','-y','-i',source,'-c:v','libx265','-preset','fast','-crf','26','-tag:v','hvc1','-c:a','aac',phone]);
 await page.addInitScript(()=>{localStorage.setItem('gumbo-onboarded','1');});
 await page.goto('/app/');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:60_000});
 const hevc=await page.evaluate(()=>MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"'));test.skip(!hevc,'this browser has no HEVC decoder: the copy is made first, as before');
 await page.evaluate(()=>(window as any).dream.createProject({requestId:'hevc-'+Date.now(),text:'',paths:[]}));
 await page.reload();await page.getByRole('button',{name:'Untitled project'}).first().click();await expect(page.getByText('Your canvas is ready')).toBeVisible({timeout:30_000});
 await page.getByRole('button',{name:'Media'}).first().click();
 await page.evaluate(async url=>{const file=new File([await (await fetch(url)).blob()],'phone.mov',{type:'video/quicktime'}),data=new DataTransfer();data.items.add(file);
  const panel=document.querySelector<HTMLElement>('.project-media')!;for(const type of ['dragover','drop'])panel.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:data}));},'/app/@fs/'+phone.replace(/\\/g,'/'));
 // Playable within a couple of seconds: the original, not a copy.
 await expect.poll(async()=>(await state(page)).footage.assets[0]?.playback,{timeout:5_000}).toMatchObject({ready:true,video:'original'});
 const asset=(await state(page)).footage.assets[0];expect(asset.videoCodec).toBe('hevc');
 await expect(page.getByText('Drop media here to start your edit')).toBeVisible({timeout:15_000});
 await page.evaluate(id=>{const lane=document.querySelector<HTMLElement>('.manual-track-lane[data-track="video"]')!,box=lane.getBoundingClientRect(),data=new DataTransfer();data.setData('application/x-dream-asset',id);
  const at={bubbles:true,cancelable:true,dataTransfer:data,clientX:box.left+4,clientY:box.top+box.height/2};for(const type of ['dragenter','dragover','drop'])lane.dispatchEvent(new DragEvent(type,at));},asset.id);
 await expect.poll(async()=>(await state(page)).timeline.spine.length,{timeout:15_000}).toBe(1);
 const time=page.getByText(/^\d+:\d\d \/ 0:06$/).first();await expect(time).toHaveText('0:00 / 0:06',{timeout:15_000});
 await page.getByRole('button',{name:'Play'}).first().click();await expect(time).not.toHaveText('0:00 / 0:06',{timeout:10_000});await page.getByRole('button',{name:'Pause'}).first().click();
 // The preview shows picture (not a black frame): the original decoded. Its screenshot, averaged by ffmpeg.
 await page.waitForTimeout(800);const shot=await page.locator('.preview-frame').first().screenshot();
 const grey=execFileSync(ffmpeg!,['-v','error','-i','pipe:0','-vf','scale=32:18','-f','rawvideo','-pix_fmt','gray','-'],{input:shot});
 expect(grey.reduce((n,x)=>n+x,0)/grey.length).toBeGreaterThan(30);
 // It exports from the original.
 await page.getByRole('button',{name:'Export'}).first().click();const dialog=page.getByRole('dialog',{name:'Export'});
 const [download]=await Promise.all([page.waitForEvent('download',{timeout:120_000}),dialog.getByRole('button',{name:'Export',exact:true}).click()]);
 const folder=mkdtempSync(join(tmpdir(),'gumbo-hevc-')),saved=join(folder,download.suggestedFilename());
 try{await download.saveAs(saved);
  const tiny=(file:string)=>execFileSync(ffmpeg!,['-v','error','-ss','2','-i',file,'-frames:v','1','-vf','scale=32:18','-f','rawvideo','-pix_fmt','rgb24','-']);
  const a=tiny(saved),b=tiny(source);let d=0;for(let i=0;i<a.length;i++)d+=Math.abs(a[i]-b[i]);expect(d/a.length).toBeLessThan(14);
 }finally{rmSync(folder,{recursive:true,force:true});}
});
