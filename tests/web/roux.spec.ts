import {test,expect} from '@playwright/test';
import {session,use,state,text,images} from './roux-session';

/** Roux on the web, against the scripted gateway (no AI is paid for), signed in through the page's PKCE return. It edits
 * project.json (applied live as it is written), looks at its edit (frames drawn by the editor's engine) and at the source
 * at chosen times and over a range with its sound measured, listens to the edit (mixed and encoded as MP3 in the browser),
 * reads a web page through the gateway's fetch-url, lists a folder the user granted, reads the footage index and reviews
 * the whole cut. Its commands run in the browser sandbox (Python, ffprobe, the shell's tools) over the project's own
 * files, and its prompt says so. */
test('Roux edits, looks, listens, reads the web, a granted folder and the footage, and reviews its cut in the browser',async({page})=>{
 test.setTimeout(300_000);
 const run=await session(page,asset=>[
  [use('e','edit',{path:'project.json',oldText:'"spine": [],',newText:`"spine": [{"id":"c1","assetId":"${asset}","srcIn":0,"srcOut":6,"speed":1,"reason":"Clip"}],`})],
  [use('v','look',{target:'edit',times:[1,4]})],
  [use('s','look',{source:asset,start:1,end:4,audio:true})],
  [use('t','look',{source:asset,times:[0.5,2.5]})],
  [use('l','listen',{target:'edit',start:0,end:4})],
  [use('w','web',{url:'https://example.com/skate'})],
  [use('c','list',{scope:'computer',path:''})],
  [use('i','read',{path:'footage/INDEX.md'})],
  [use('r','review',{})],
  [{type:'text',text:'Placed the clip and checked it.'}]]);
 try{
  await run.ask('Put the clip in, then check how it looks and sounds.');
  const {seen}=run,s=await state(page);expect(s.timeline.spine.map((c:any)=>c.assetId)).toEqual([run.assetId]);
  // Writing project.json applied the edit at once.
  expect(text(seen.e)).toMatch(/Applied/);
  // Its edit, drawn by the editor; the source at exact times and over a range with its sound measured; the edit, heard.
  expect(images(seen.v)).toBeGreaterThanOrEqual(1);
  expect(images(seen.s)).toBeGreaterThanOrEqual(1);expect(text(seen.s)).toMatch(/LUFS/);expect(text(seen.s)).toMatch(/Shots in this range/);
  expect(images(seen.t)).toBeGreaterThanOrEqual(1);expect(text(seen.t)).toMatch(/at 0\.5 s, 2\.5 s/);
  expect(text(seen.l)).toContain('A steady test tone');expect(text(seen.l)).toMatch(/integratedLufs/);
  expect(text(seen.w)).toContain('Kickflip basics');expect(text(seen.w)).not.toContain('ignore()');
  expect(text(seen.c)).toMatch(/\/granted\/pretend-videos-[0-9a-f]{4}/);
  // The footage as files, and the whole cut reviewed with a frame of its shot.
  expect(text(seen.i)).toMatch(/source\.mp4/);expect(text(seen.i)).toMatch(/footage\/source-a_/);
  expect(text(seen.r)).toMatch(/Main track, in playback order/);expect(images(seen.r)).toBeGreaterThanOrEqual(1);
  // The run's log reaches the gateway by itself, as the gateway's edit-log route keeps it: by run, from the web.
  await expect.poll(()=>run.gateway.editLogs.length).toBeGreaterThanOrEqual(1);
  expect(run.gateway.editLogs[0]).toMatchObject({key:expect.stringMatching(/@/),appVersion:'0.3.0',platform:expect.stringMatching(/^web /),log:expect.any(Object)});
  expect(run.errors).toEqual([]);
 }finally{await run.gateway.close();}
});

test('Roux runs commands in the browser sandbox over the project\'s files',async({page})=>{
 test.setTimeout(300_000);
 const run=await session(page,()=>[
  [use('a','run',{command:'python3 -c "import numpy as np; print(int(np.arange(4).sum()))"'})],
  [use('b','run',{command:'ffprobe -v error -show_entries format=duration -of csv=p=0 ../Media/Originals/*source.mp4'})],
  [use('c','run',{command:"printf 'skate\\nsunset\\nskate\\n' | sort | uniq -c | sort -rn | head -1 > counts.txt && cat counts.txt"})],
  [use('d','read',{path:'counts.txt'})],
  [use('g','grep',{pattern:'skate',path:'counts.txt'})],
  [{type:'text',text:'Ran the checks.'}]]);
 try{
  await run.ask('Check the footage with a few commands.');
  const {seen}=run;
  expect(run.system[0]).toContain('sandbox in the browser');expect(run.system[0]).not.toContain('BusyBox');
  expect(text(seen.a)).toMatch(/Exit code 0/);expect(text(seen.a)).toMatch(/\b6\b/);
  expect(text(seen.b)).toMatch(/Exit code 0/);expect(text(seen.b)).toMatch(/\b6\.0/);
  expect(text(seen.c)).toMatch(/2 skate/);expect(text(seen.d)).toMatch(/2 skate/);
  expect(text(seen.g)).toMatch(/counts\.txt:1: +2 skate/);
  expect(run.errors).toEqual([]);
 }finally{await run.gateway.close();}
});
