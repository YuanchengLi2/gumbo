import {test,expect,type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {codeGateway} from '../fixtures/code-gateway';

/** Speech in imported footage on the web: signed in, the gateway's transcription hears it (here the scripted fixture,
 * so nothing is paid for), which takes seconds; signed out, Whisper in the browser (packages/web-ml) hears it, with no
 * account and no upload. The JFK recording is 11 seconds of speech. */
const speech=resolve('artifacts/fixtures/whisper-jfk.wav');
const state=(page:Page)=>page.evaluate(()=>(window as any).dream.command({type:'state'}));
async function importSpeech(page:Page){
 await page.evaluate(async url=>{
  const dream=(window as any).dream,file=new File([await (await fetch(url)).blob()],'jfk.wav',{type:'audio/wav'});
  const paths=await dream.registerDropped([file]);await dream.createProject({requestId:'web-speech',text:'',paths:[]});await dream.command({type:'import',paths,copy:true});
 },'/app/@fs/'+speech.replace(/\\/g,'/'));
}
const transcription=async(page:Page)=>(await state(page)).jobs.find((j:any)=>j.step==='transcription');
/** What the footage search finds for a word: the transcript is saved and indexed. */
const found=async(page:Page,word:string)=>JSON.stringify(await page.evaluate(query=>(window as any).dream.command({type:'search',query}),word)).toLowerCase();

test('speech is heard on this computer by Whisper, signed out',async({page})=>{
 test.setTimeout(600_000);
 const logs:string[]=[];page.on('console',m=>logs.push(m.text()));
 await page.goto('/app/');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:60_000});
 await importSpeech(page);
 // The model downloads once (about 100 MB), then the clip is heard.
 await expect.poll(async()=>(await transcription(page))?.status,{timeout:540_000,intervals:[2000]}).toBe('complete');
 for(const word of ['fellow','americans','country'])expect(await found(page,word)).toContain(word);
 expect(logs.some(l=>l.includes('[speech] heard on this computer'))).toBe(true);
});

test('speech is heard in the cloud when signed in, without loading Whisper',async({page})=>{
 test.setTimeout(180_000);
 const words='And so my fellow Americans'.split(' ').map((word,n)=>({word,start:.4+n*.45,end:.8+n*.45}));
 const gateway=await codeGateway({words,script:()=>[]});
 try{
  await page.addInitScript(url=>{if(window!==window.top)return;localStorage.setItem('gumbo-cloud',JSON.stringify({url,anonKey:'fixture'}));sessionStorage.setItem('gumbo-sign-in-verifier','fixture-verifier');},gateway.url);
  await page.goto('/app/?code=fixture-code');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:60_000});
  const models:string[]=[];page.on('request',r=>{if(/huggingface|onnx|whisper/i.test(r.url())&&!r.url().includes('jfk'))models.push(r.url());});
  const started=Date.now();await importSpeech(page);
  await expect.poll(async()=>(await transcription(page))?.status,{timeout:60_000}).toBe('complete');
  expect(Date.now()-started).toBeLessThan(30_000);expect(models).toEqual([]);
  expect(await found(page,'fellow')).toContain('fellow');expect(await found(page,'country')).not.toContain('country');
  expect(gateway.transcribeRefusals()).toEqual([]);
 }finally{await gateway.close();}
});

/** A long recording (10 minutes of video, as from OBS or a camera), dropped and signed in: heard in the cloud while it
 * is still being copied into the project, every chunk accepted by the gateway's own audio check, and Whisper never
 * runs in the browser. Before, the copy moving the file mid-read failed the transcription ("network error"), and a
 * chunk the gateway refused was heard by Whisper here, which took minutes for a 20-minute episode. */
test('a long video is heard in the cloud while it copies in, every chunk accepted',async({page})=>{
 test.setTimeout(300_000);
 const big=resolve('artifacts/fixtures/long-upload.mp4');
 const gateway=await codeGateway({words:[{word:'hello',start:.5,end:.9}],script:()=>[]});
 try{
  await page.addInitScript(url=>{if(window!==window.top)return;localStorage.setItem('gumbo-cloud',JSON.stringify({url,anonKey:'fixture'}));sessionStorage.setItem('gumbo-sign-in-verifier','fixture-verifier');},gateway.url);
  const logs:string[]=[];page.on('console',m=>logs.push(m.text()));
  await page.goto('/app/?code=fixture-code');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:60_000});
  const started=Date.now();
  await page.evaluate(async url=>{
   const dream=(window as any).dream,file=new File([await (await fetch(url)).blob()],'long-upload.mp4',{type:'video/mp4'});
   const paths=await dream.registerDropped([file]);await dream.createProject({requestId:'web-long-speech',text:'',paths:[]});await dream.command({type:'import',paths,copy:true});
  },'/app/@fs/'+big.replace(/\\/g,'/'));
  await expect.poll(async()=>(await transcription(page))?.status,{timeout:240_000,intervals:[2000]}).not.toBe('running');
  expect(await transcription(page)).toMatchObject({status:'complete',error:null});
  expect(Date.now()-started).toBeLessThan(120_000);
  expect(gateway.transcribeRefusals()).toEqual([]);
  expect(logs.filter(l=>l.includes('[speech] heard on this computer'))).toEqual([]);
 }finally{await gateway.close();}
});
