import {test,expect} from '@playwright/test';
import {session,use,state,text,images} from './roux-session';

/** Roux on the web, against the scripted gateway (no AI is paid for), signed in through the page's PKCE return.
 * Phase 2: it edits project.json and publishes, looks at its edit (frames drawn by the editor's engine) and at the source
 * with its sound measured, listens to the edit (mixed and encoded as MP3 in the browser), reads a web page through the
 * gateway's fetch-url, and lists a folder the user granted. Phase 3: its commands run in the browser sandbox (Python,
 * ffprobe, the shell's tools) over the project's own files, and its prompt says so. */
test('Roux edits, looks, listens, reads the web and a granted folder in the browser',async({page})=>{
 test.setTimeout(300_000);
 const run=await session(page,asset=>[
  [use('e','edit_file',{path:'project.json',oldText:'"spine": [],',newText:`"spine": [{"id":"c1","assetId":"${asset}","srcIn":0,"srcOut":6,"speed":1,"reason":"Clip"}],`})],
  [use('p','publish_project',{})],
  [use('v','view_media',{target:'preview',times:[1,4]})],
  [use('s','view_media',{target:'source',assetId:asset,startSec:1,endSec:4,audio:true})],
  [use('l','listen',{target:'preview',startSec:0,endSec:4})],
  [use('w','fetch_url',{url:'https://example.com/skate'})],
  [use('c','list_files',{scope:'computer',path:''})],
  [use('f','finish',{status:'complete',summary:'Placed the clip and checked it.',evidence:[]})]]);
 try{
  await run.ask('Put the clip in, then check how it looks and sounds.');
  const {seen}=run,s=await state(page);expect(s.timeline.spine.map((c:any)=>c.assetId)).toEqual([run.assetId]);
  // Its edit, drawn by the editor; the source, with its sound measured; the edit's sound, heard.
  expect(images(seen.v)).toBeGreaterThanOrEqual(2);
  expect(images(seen.s)).toBeGreaterThanOrEqual(1);expect(text(seen.s)).toMatch(/LUFS/);expect(text(seen.s)).toMatch(/Shots in this range/);
  expect(text(seen.l)).toContain('A steady test tone');expect(text(seen.l)).toMatch(/integratedLufs/);
  expect(text(seen.w)).toContain('Kickflip basics');expect(text(seen.w)).not.toContain('ignore()');
  expect(text(seen.c)).toMatch(/\/granted\/pretend-videos-[0-9a-f]{4}/);
  expect(run.errors).toEqual([]);
 }finally{await run.gateway.close();}
});

test('Roux runs commands in the browser sandbox over the project\'s files',async({page})=>{
 test.setTimeout(300_000);
 const run=await session(page,()=>[
  [use('a','run_command',{command:'python3 -c "import numpy as np; print(int(np.arange(4).sum()))"'})],
  [use('b','run_command',{command:'ffprobe -v error -show_entries format=duration -of csv=p=0 ../Media/Originals/*source.mp4'})],
  [use('c','run_command',{command:"printf 'skate\\nsunset\\nskate\\n' | sort | uniq -c | sort -rn | head -1 > counts.txt && cat counts.txt"})],
  [use('d','read_file',{path:'counts.txt'})],
  [use('p','publish_project',{})],
  [use('f','finish',{status:'complete',summary:'Ran the checks.',evidence:[]})]]);
 try{
  await run.ask('Check the footage with a few commands.');
  const {seen}=run;
  expect(run.system[0]).toContain('sandbox in the browser');expect(run.system[0]).not.toContain('BusyBox');
  expect(text(seen.a)).toMatch(/"exitCode":0/);expect(text(seen.a)).toMatch(/\b6\b/);
  expect(text(seen.b)).toMatch(/"exitCode":0/);expect(text(seen.b)).toMatch(/\b6\.0/);
  expect(text(seen.c)).toMatch(/2 skate/);expect(text(seen.d)).toMatch(/2 skate/);
  expect(run.errors).toEqual([]);
 }finally{await run.gateway.close();}
});
