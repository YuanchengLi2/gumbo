import {test,expect,type Page} from '@playwright/test';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

/** Phase 1 of Gumbo on the web, without AI: the desktop's project service runs in the browser, so footage is imported
 * into the browser's own storage (probe, playback audio, waveform, proxy, loudness), the project opens from the home
 * list after a reload, a clip is placed and played, and the export (drawn by the engine, the sound mixed and levelled in
 * a worker, joined without re-encoding) downloads as an MP4 with the clip's picture and sound at -14 LUFS. */
const fixture=resolve('artifacts/fixtures/source.mp4');
const state=(page:Page)=>page.evaluate(()=>(window as any).dream.command({type:'state'}));

test('import, edit, play and export in the browser, kept across a reload',async({page})=>{
 test.setTimeout(240_000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(`${e.message}\n${e.stack??''}`));
 page.on('console',m=>{if(['error','warning'].includes(m.type())||m.text().startsWith('[export]'))console.log(`[page ${m.type()}] ${m.text()}`);});
 await page.goto('/app/');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:60_000});

 // An empty project, opened from the home list after a reload: it lives in this browser.
 await page.evaluate(()=>(window as any).dream.createProject({requestId:'web-e2e',text:'',paths:[]}));
 await page.reload();await page.getByRole('button',{name:'Untitled project'}).first().click();
 await expect(page.getByText('Your canvas is ready')).toBeVisible({timeout:30_000});

 // The fixture dropped on the media panel is copied into the browser's storage and imported there.
 await page.getByRole('button',{name:'Media'}).first().click();
 await page.evaluate(async url=>{const file=new File([await (await fetch(url)).blob()],'source.mp4',{type:'video/mp4'}),data=new DataTransfer();data.items.add(file);
  const panel=document.querySelector<HTMLElement>('.project-media')!;for(const type of ['dragover','drop'])panel.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:data}));},'/app/@fs/'+fixture.replace(/\\/g,'/'));
 await expect.poll(async()=>{const s=await state(page);return Object.fromEntries(s.jobs.filter((j:any)=>['playback_audio','waveform','preview_proxy','loudness','thumbnail'].includes(j.step)).map((j:any)=>[j.step,j.status]));},{timeout:90_000})
  .toEqual({playback_audio:'complete',waveform:'complete',preview_proxy:'complete',loudness:'complete',thumbnail:'complete'});
 const asset=(await state(page)).footage.assets[0];
 expect(asset).toMatchObject({filename:'source.mp4',durationSec:6,width:1280,height:720,hasAudio:true,status:'ready'});
 // Kept once: in the project's own folder, the file waiting in /imports removed.
 expect(asset.source.path).toMatch(/^\/imports\/\w+\/source\.mp4$/);expect(asset.originalPath).toMatch(/^\/Dream\/Projects\/\w+\/Media\/Originals\/.+source\.mp4$/);
 await expect.poll(()=>page.evaluate(async()=>{const root=await navigator.storage.getDirectory();try{const names=[];for await(const name of (await root.getDirectoryHandle('imports') as any).keys())names.push(name);return names;}catch{return [];}}),{timeout:10_000}).toEqual([]);

 // Placed on the timeline, as dragging its tile does.
 await expect(page.getByText('Drop media here to start your edit')).toBeVisible({timeout:15_000});
 await page.evaluate(id=>{const lane=document.querySelector<HTMLElement>('.manual-track-lane[data-track="video"]')!,box=lane.getBoundingClientRect(),data=new DataTransfer();data.setData('application/x-dream-asset',id);
  const at={bubbles:true,cancelable:true,dataTransfer:data,clientX:box.left+4,clientY:box.top+box.height/2};for(const type of ['dragenter','dragover','drop'])lane.dispatchEvent(new DragEvent(type,at));},asset.id);
 await expect.poll(async()=>(await state(page)).timeline.spine.length,{timeout:15_000}).toBe(1);

 // It plays.
 const time=page.getByText(/^\d+:\d\d \/ 0:06$/).first();await expect(time).toHaveText('0:00 / 0:06',{timeout:15_000});
 await page.getByRole('button',{name:'Play'}).first().click();await expect(time).not.toHaveText('0:00 / 0:06',{timeout:10_000});
 await page.getByRole('button',{name:'Pause'}).first().click();

 // The export downloads.
 await page.evaluate(()=>(window as any).dream.onEvent((e:any)=>{if(e.type==='export.progress'&&e.payload.status!=='rendering')console.warn('[export] progress '+JSON.stringify(e.payload));}));
 await page.getByRole('button',{name:'Export'}).first().click();
 const dialog=page.getByRole('dialog',{name:'Export'});await expect(dialog).toBeVisible();
 const [download]=await Promise.all([page.waitForEvent('download',{timeout:120_000}),dialog.getByRole('button',{name:'Export',exact:true}).click()]);
 await expect(dialog.getByText('Exported')).toBeVisible({timeout:30_000});
 const folder=mkdtempSync(join(tmpdir(),'gumbo-web-export-')),saved=join(folder,download.suggestedFilename());
 try{
  await download.saveAs(saved);expect(download.suggestedFilename()).toBe('Untitled project.mp4');
  const probe=JSON.parse(execFileSync(ffprobe.path,['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height,sample_rate,channels','-of','json',saved]).toString());
  expect(Number(probe.format.duration)).toBeCloseTo(6,1);
  expect(probe.streams.find((s:any)=>s.codec_type==='video')).toMatchObject({codec_name:'h264',width:1920,height:1080});
  expect(probe.streams.find((s:any)=>s.codec_type==='audio')).toMatchObject({codec_name:'aac',sample_rate:'48000',channels:2});
  // The picture at 3 s matches the source's, and the sound is at the standard level.
  const tiny=(file:string)=>execFileSync(ffmpeg!,['-v','error','-ss','3','-i',file,'-frames:v','1','-vf','scale=32:18','-f','rawvideo','-pix_fmt','rgb24','-']);
  const a=tiny(saved),b=tiny(fixture);let difference=0;for(let i=0;i<a.length;i++)difference+=Math.abs(a[i]-b[i]);
  expect(difference/a.length).toBeLessThan(12);
  const log=spawnSync(ffmpeg!,['-hide_banner','-nostats','-i',saved,'-af','ebur128=peak=true','-f','null','-']).stderr.toString();
  const loudness=Number(/I:\s*(-?[\d.]+) LUFS/.exec(log.slice(log.lastIndexOf('Summary:')))?.[1]);
  expect(loudness).toBeGreaterThan(-15.5);expect(loudness).toBeLessThan(-12.5);
 }finally{rmSync(folder,{recursive:true,force:true});}

 // Still there after another reload, with its edit.
 await page.reload();await page.getByRole('button',{name:'Untitled project'}).first().click();
 await expect.poll(async()=>(await state(page)).timeline.spine.map((c:any)=>c.assetId),{timeout:30_000}).toEqual([asset.id]);
 expect(errors).toEqual([]);
});
