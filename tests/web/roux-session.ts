import {expect,type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {codeGateway} from '../fixtures/code-gateway';

/** Roux on the web against the scripted gateway (no AI is paid for), signed in through the page's PKCE return, with a
 * project holding the fixture clip and a granted folder. Shared by the web tests that run Roux. */
export const fixture=resolve('artifacts/fixtures/source.mp4');
export const use=(id:string,name:string,input:unknown)=>({type:'tool_use',id,name,input});
export const state=(page:Page)=>page.evaluate(()=>(window as any).dream.command({type:'state'}));
/** What the scripted call with this id returned, as the model was given it (the fixture numbers ids: v becomes v-3). */
export function returned(body:any,id:string){
 for(const m of body.messages??[])if(Array.isArray(m.content))for(const b of m.content)if(b.type==='tool_result'&&new RegExp(`^${id}-\\d+$`).test(b.tool_use_id))return typeof b.content==='string'?[{type:'text',text:b.content}]:b.content as any[];
 return [];
}
export const text=(blocks:any[])=>blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n');
export const images=(blocks:any[])=>blocks.filter(b=>b.type==='image').length;

/** Signed in, with a project holding the fixture clip and a granted folder; `steps` is Roux's script (it may use the
 * clip's asset id), and every scripted call's result is kept in `seen` as the model first got it. */
export async function session(page:Page,steps:(assetId:string)=>any[][]){
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
 await page.addInitScript(url=>{if(window!==window.top)return;
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
