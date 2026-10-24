import {test,expect,type Page} from '@playwright/test';

/** A Chrome screen recording (MediaRecorder VP9 WebM, an odd size, no duration or index in the file) imports with every
 * step working and plays. On October 24 a friend's 391x577 recording failed its thumbnail and preview copy with
 * "Decoding error." (Chromium's hardware VP9 decoder and odd sizes; engine/decoder-fix.ts) and stuttered. */
const state=(page:Page)=>page.evaluate(()=>(window as any).dream.command({type:'state'}));

test('an odd-sized screen recording imports and plays',async({page})=>{
 test.setTimeout(240_000);
 await page.setViewportSize({width:1280,height:720});
 await page.goto('/app/');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:90_000});
 // 5 s recorded from a canvas the way Chrome records a window.
 const bytes:number[]=await page.evaluate(async()=>{
  const canvas=Object.assign(document.createElement('canvas'),{width:391,height:577}),g=canvas.getContext('2d')!;
  const rec=new MediaRecorder(canvas.captureStream(30),{mimeType:'video/webm;codecs=vp9'}),parts:Blob[]=[];rec.ondataavailable=e=>parts.push(e.data);
  const t0=performance.now();let raf=0;const draw=()=>{const t=(performance.now()-t0)/1000;g.fillStyle=`hsl(${t*70} 80% 50%)`;g.fillRect(0,0,391,577);g.fillStyle='#000';g.fillRect((t*120)%391,0,20,577);raf=requestAnimationFrame(draw);};draw();
  rec.start(1000);await new Promise(r=>setTimeout(r,5200));rec.stop();cancelAnimationFrame(raf);await new Promise(r=>rec.onstop=r);
  return [...new Uint8Array(await new Blob(parts,{type:'video/webm'}).arrayBuffer())];});
 await page.evaluate(()=>(window as any).dream.createProject({requestId:'recording',text:'',paths:[]}));
 await page.reload();await page.getByRole('button',{name:'Untitled project'}).first().click();
 await expect(page.getByText('Your canvas is ready')).toBeVisible({timeout:30_000});
 await page.getByRole('button',{name:'Media'}).first().click();
 await page.evaluate(b=>{const file=new File([new Uint8Array(b)],'Screen recording 2026-10-24 11.50.10.webm',{type:'video/webm'}),data=new DataTransfer();data.items.add(file);
  const panel=document.querySelector<HTMLElement>('.project-media')!;for(const type of ['dragover','drop'])panel.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:data}));},bytes);
 await expect.poll(async()=>(await state(page)).footage.assets[0]?.status,{timeout:120_000}).toBe('ready');
 await expect.poll(async()=>(await state(page)).jobs.filter((j:any)=>j.status==='running'||j.status==='queued').length,{timeout:120_000}).toBe(0);
 const s=await state(page),asset=s.footage.assets[0];
 expect(asset).toMatchObject({width:391,height:577,kind:'video'});
 expect(s.jobs.filter((j:any)=>j.status==='failed').map((j:any)=>`${j.step}: ${j.error}`)).toEqual([]);
 expect(s.jobs.find((j:any)=>j.step==='thumbnail')?.status).toBe('complete');
 // Placed and played: the clock moves.
 await page.evaluate(id=>{const lane=document.querySelector<HTMLElement>('.manual-track-lane[data-track="video"]')!,box=lane.getBoundingClientRect(),data=new DataTransfer();data.setData('application/x-dream-asset',id);
  const at={bubbles:true,cancelable:true,dataTransfer:data,clientX:box.left+4,clientY:box.top+box.height/2};for(const type of ['dragenter','dragover','drop'])lane.dispatchEvent(new DragEvent(type,at));},asset.id);
 await expect.poll(async()=>(await state(page)).timeline.spine.length,{timeout:15_000}).toBe(1);
 const time=page.getByText(/^\d+:\d\d \/ 0:05$/).first();await expect(time).toHaveText('0:00 / 0:05',{timeout:15_000});
 await page.getByRole('button',{name:'Play'}).first().click();await expect(time).toHaveText('0:03 / 0:05',{timeout:10_000});
});
