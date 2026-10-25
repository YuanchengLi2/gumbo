import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {codeGateway,signIn} from '../fixtures/code-gateway';

const use=(id:string,name:string,input:unknown)=>({type:'tool_use',id,name,input});
// The JFK recording, word by word (its speech runs from about 0.3s to 10.5s).
const speech='And so my fellow Americans ask not what your country can do for you ask what you can do for your country'.split(' ');
const words=speech.map((word,n)=>({word,start:.4+n*.45,end:.4+n*.45+.4}));

/** What the agent sees when it looks at its own edit: a video clip, narration on the music track captioned by the
 * built-in captions, and a coded graphic drawn from its props. The frames look returns are saved to
 * test-results/agent-view so a person can look at exactly what the model was shown. */
test('the agent sees the captions and graphics of its published edit',async()=>{
 test.setTimeout(300000);const ids:Record<string,string>={};let seen:any;
 const scene="export default function Card({word,meaning}:{word:string;meaning:string}){\n return <div style={{position:'absolute',left:80,top:80,padding:'28px 40px',background:'#ff00ff',color:'white',fontSize:64,fontFamily:'sans-serif',borderRadius:16}}>{word} - {meaning}</div>;\n}\n";
 const log:string[]=[];
 const script=(body:any,step:number)=>{
  const last=(body.messages??[]).at(-1);log.push(step+': '+JSON.stringify(last?.content??'').slice(0,400));
  if(step===6){const messages:any[]=body.messages??[];for(const m of messages)if(Array.isArray(m.content))for(const b of m.content)if(b.type==='tool_result'&&/^v(-|$)/.test(b.tool_use_id))seen=b;}
  return[
  [use('w','write',{path:'src/card.tsx',content:scene})],
  [use('e','edit',{path:'project.json',oldText:'"spine": [],',newText:`"spine": [{"id":"c1","assetId":"${ids.video}","srcIn":0,"srcOut":6,"speed":1,"audio":{"mute":true},"reason":"Clip"}],`})],
  [use('e2','edit',{path:'project.json',oldText:'"music": [],',newText:`"music": [{"id":"voice","assetId":"${ids.voice}","srcIn":0,"srcOut":6,"start":{"kind":"project","at":"start","offsetSec":0},"gainDb":0}],"captions":{"style":"clean","params":{},"overrides":[]},"attached":[{"id":"card_o","type":"overlay","start":{"kind":"project","at":"start","offsetSec":0},"durationSec":6,"component":"source","params":{},"source":{"assetId":"output:card","srcIn":0,"srcOut":6},"layer":2,"reason":"Definition"}],`})],
  [use('e3','edit',{path:'project.json',oldText:'"attached": [],',newText:''})],
  [use('e4','edit',{path:'project.json',oldText:'"outputs": []',newText:'"outputs": [{"id":"card","path":"src/card.tsx","kind":"scene","durationInFrames":180,"transparent":true,"props":{"word":"Pho","meaning":"noodle soup"}}]'})],
  [use('v','look',{target:'edit',times:[2,4]})],
  [{type:'text',text:'Looked at the edit.'}]][step]??[];};
 const profile=mkdtempSync(join(tmpdir(),'dream-sees-profile-')),folder=mkdtempSync(join(tmpdir(),'dream-sees-project-'));
 const video=join(profile,'clip.mp4'),voice=join(profile,'voice.wav');copyFileSync(resolve('artifacts/fixtures/source.mp4'),video);copyFileSync(resolve('artifacts/fixtures/whisper-jfk.wav'),voice);
 const gateway=await codeGateway({script,words});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'fixture'}));
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
 try{
  const page=await app.firstWindow(),errors:string[]=[];await signIn(page);page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},folder);await page.evaluate(()=>window.dream.pickProject(true));
  await page.evaluate(async folder=>{await window.dream.command({type:'create',folder,name:'Sees'});},folder);await page.reload();
  for(const [key,path] of [['video',video],['voice',voice]] as const){
   await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);
   const [picked]=await page.evaluate(()=>window.dream.pickMedia());await page.evaluate(async path=>window.dream.command({type:'import',paths:[path],copy:true}),picked);
   const name=path.split(/[\\/]/).pop();
   await expect.poll(()=>page.evaluate(async name=>(await window.dream.command({type:'state'})).footage.assets.find((a:any)=>a.filename===name)?.status??'',name),{timeout:90000}).toBe('ready');
   ids[key]=await page.evaluate(async name=>(await window.dream.command({type:'state'})).footage.assets.find((a:any)=>a.filename===name)!.id,name);
  }
  // Transcription and analysis finish before the edit, so the narration has its words.
  await expect.poll(()=>page.evaluate(async()=>(await window.dream.command({type:'state'})).jobs.filter((j:any)=>j.status==='running'||j.status==='queued').length),{timeout:120000}).toBe(0);
  await page.getByLabel('Ask Gumbo to edit').fill('Add a definition card and captions');await page.getByRole('button',{name:'Send prompt'}).click();
  await expect.poll(async()=>(await page.evaluate(async()=>(await window.dream.command({type:'state'})))).aiStatus,{timeout:120000}).toBe('complete');
  if(!seen)console.log(log.join('\n'));
  expect(seen,'look result reached the model').toBeTruthy();
  const parts:any[]=Array.isArray(seen.content)?seen.content:[],text=parts.filter(p=>p.type==='text').map(p=>p.text).join('\n'),images=parts.filter(p=>p.type==='image');
  const out=resolve('test-results/agent-view');mkdirSync(out,{recursive:true});writeFileSync(join(out,'result.txt'),text);
  images.forEach((image,n)=>writeFileSync(join(out,`frame-${n+1}.jpg`),Buffer.from(image.source.data,'base64')));
  console.log('look text:',text.slice(0,3000));console.log('images:',images.length);
  // What is on screen, as the agent reads it: the clip, the card scene and the caption with the words spoken there.
  expect(text).toContain('card_o');expect(text).toMatch(/"kind":"caption","text":"[^"]+"/);
  expect(images.length).toBe(2);
  // The pink card covers much of the top-left ninth of the frame at every moment, so that region is far bluer than the
  // red and green bars under it. (The first frame of a scene was captured before it painted, without the card.)
  const moments=JSON.parse(parts.find(p=>p.type==='text').text).moments as {colours:{grid:string[]}}[];
  for(const m of moments)expect(parseInt(m.colours.grid[0].slice(5,7),16)).toBeGreaterThan(0x40);
  expect(errors).toEqual([]);
 }finally{await app.close();await gateway.close();}
});
