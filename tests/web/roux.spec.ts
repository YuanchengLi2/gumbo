import {test,expect,type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {codeGateway} from '../fixtures/code-gateway';

/** Roux on the web, against the scripted gateway (no AI is paid for), signed in through the page's PKCE return.
 * Phase 2: it edits project.json and publishes, looks at its edit (frames drawn by the editor's engine) and at the source
 * with its sound measured, listens to the edit (mixed and encoded as MP3 in the browser), reads a web page through the
 * gateway's fetch-url, and lists a folder the user granted. Phase 3: its commands run in the browser sandbox (Python,
 * ffprobe, the shell's tools) over the project's own files, and its prompt says so. */
const fixture=resolve('artifacts/fixtures/source.mp4');
const use=(id:string,name:string,input:unknown)=>({type:'tool_use',id,name,input});
const state=(page:Page)=>page.evaluate(()=>(window as any).dream.command({type:'state'}));
/** What the scripted call with this id returned, as the model was given it (the fixture numbers ids: v becomes v-3). */
function returned(body:any,id:string){
 for(const m of body.messages??[])if(Array.isArray(m.content))for(const b of m.content)if(b.type==='tool_result'&&new RegExp(`^${id}-\\d+$`).test(b.tool_use_id))return typeof b.content==='string'?[{type:'text',text:b.content}]:b.content as any[];
 return [];
}
const text=(blocks:any[])=>blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n');
const images=(blocks:any[])=>blocks.filter(b=>b.type==='image').length;

/** Signed in, with a project holding the fixture clip and a granted folder; `steps` is Roux's script (it may use the
 * clip's asset id), and every scripted call's result is kept in `seen` as the model first got it. */
async function session(page:Page,steps:(assetId:string)=>any[][]){
 const ids={asset:''},seen:Record<string,any[]>={},system:string[]=[];
 const gateway=await codeGateway({providers:{anthropic:true,google:true},pages:{'https://example.com/skate':{contentType:'text/html; charset=utf-8',text:'<title>Skate</title><p>Kickflip basics</p><script>ignore()</script>'}},script:(body,step)=>{
  if(body.purpose==='listening')return [{type:'text',text:'A steady test tone, no speech.'}];
  // Helpers without tools (titles, summaries, shot descriptions) answer plainly.
  if(!body.tools?.length)return [{type:'text',text:body.purpose==='shot_index'?'[]':'Fixture.'}];
  if(!system.length)system.push(JSON.stringify(body.system??''));
  // Each result as the model first gets it: pictures are detached from older turns later on.
  for(const [id] of steps(ids.asset).flat().map((b:any)=>[b.id]))if(!seen[id]?.length)seen[id]=returned(body,id);
  return steps(ids.asset)[step]??[];}});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(`${e.message}\n${e.stack??''}`));
 page.on('console',m=>{if(['error','warning'].includes(m.type()))console.log(`[page ${m.type()}] ${m.text()}`);});
 await page.addInitScript(url=>{
  localStorage.setItem('gumbo-cloud',JSON.stringify({url,anonKey:'fixture'}));sessionStorage.setItem('gumbo-sign-in-verifier','fixture-verifier');
  // The folder picker, answered with a folder in the site's storage, as if the user chose one.
  (window as any).showDirectoryPicker=async()=>(await navigator.storage.getDirectory()).getDirectoryHandle('pretend-videos',{create:true});
 },gateway.url);
 // Back from the sign-in page with a code: the page finishes signing in.
 await page.goto('/app/?code=fixture-code');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:60_000});
 expect(await page.evaluate(()=>(window as any).dream.command({type:'account'}))).toMatchObject({signedIn:true});
 expect(new URL(page.url()).searchParams.has('code')).toBe(false);
 await page.evaluate(async url=>{
  const dream=(window as any).dream,file=new File([await (await fetch(url)).blob()],'source.mp4',{type:'video/mp4'});
  const paths=await dream.registerDropped([file]);await dream.createProject({requestId:'web-roux',text:'',paths:[]});await dream.command({type:'import',paths,copy:true});
  const root=await navigator.storage.getDirectory(),folder=await root.getDirectoryHandle('pretend-videos',{create:true}),notes=await (await folder.getFileHandle('shot list.txt',{create:true})).createWritable();await notes.write('skate, sunset');await notes.close();
  await dream.grantComputer();
 },'/app/@fs/'+fixture.replace(/\\/g,'/'));
 await expect.poll(async()=>(await state(page)).footage.assets[0]?.status,{timeout:90_000}).toBe('ready');
 ids.asset=(await state(page)).footage.assets[0].id;
 return{gateway,seen,system,errors,assetId:ids.asset,
  /** Asks in the editor, which draws the frames Roux looks at, and waits for the run to finish. */
  async ask(request:string){
   await page.reload();await page.getByRole('button',{name:'Untitled project'}).first().click();
   await expect(page.getByRole('button',{name:'Media 1'})).toBeVisible({timeout:30_000});
   await page.getByRole('textbox',{name:'Ask Gumbo to edit'}).fill(request);
   const send=page.getByRole('button',{name:'Send prompt'});await expect(send).toBeEnabled();await send.click();
   await expect.poll(async()=>['complete','interrupted','failed','error'].includes((await state(page)).aiStatus),{timeout:180_000}).toBe(true);
   const ended=await state(page);
   // A run that did not finish shows how it ended.
   if(ended.aiStatus!=='complete')console.log('Run ended',ended.aiStatus,JSON.stringify(ended.messages?.slice(-3)).slice(0,3000),JSON.stringify(seen).slice(0,3000));
   expect(ended.aiStatus).toBe('complete');
  }};
}

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
