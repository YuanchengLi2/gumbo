import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {build} from 'esbuild';
import {chromium,type BrowserContext,type Page} from 'playwright-core';
import {createServer,type Server} from 'node:http';
import {createReadStream,existsSync,mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {extname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {normalizeWord,type CapabilityReport,type LocalSpeechResult,type Override,type ProbeResult} from '../src';

/** Real speech through the real worker in headless Chromium (new headless mode, which has WebGPU where the machine
 * does). Fixtures (test/fixtures/README.md): the Gettysburg Address read by Windows' David voice, 90 s, so three seams;
 * a short Chinese passage read by the Huihui voice. Models download once into a browser profile in the temp folder (a
 * short path: Chromium's Cache API files nest too deep for Windows' path limit under the repo). */
const root=resolve(__dirname,'..'),out=join(root,'test-results/harness'),repo=resolve(root,'../..');
const profile=process.env.WEB_ML_PROFILE??join(tmpdir(),'gumbo-web-ml-chromium'),ort=join(repo,'node_modules/onnxruntime-web/dist');
const reference=readFileSync(join(root,'test/fixtures/gettysburg.txt'),'utf8'),chinese=readFileSync(join(root,'test/fixtures/chinese.txt'),'utf8');
const MATRIX=process.env.WEB_ML_MATRIX==='1';

const words=(text:string)=>text.split(/[\s—-]+/).map(normalizeWord).filter(Boolean);
function editDistance<T>(a:T[],b:T[]){let row=Array.from({length:b.length+1},(_,j)=>j);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(row[j]+1,next[j-1]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}return row[b.length];}
function common<T>(a:T[],b:T[]){let row=new Array(b.length+1).fill(0);for(let i=1;i<=a.length;i++){const next=[0];for(let j=1;j<=b.length;j++)next[j]=a[i-1]===b[j-1]?row[j-1]+1:Math.max(row[j],next[j-1]);row=next;}return row[b.length];}
/** Word error rate and overlap (shared words in order, over the reference) against the known text. "can not" and
 * "cannot", "battle-field" and "battlefield" are the same words said. */
function score(text:string,expected=reference){
 const join=(w:string[])=>w.join(' ').replace(/\bcan not\b/g,'cannot').replace(/\bbattle field\b/g,'battlefield').split(' ');
 const ref=join(words(expected)),hyp=join(words(text));
 return{wer:editDistance(ref,hyp)/ref.length,overlap:common(ref,hyp)/ref.length,refWords:ref.length,hypWords:hyp.length};
}

let server:Server,context:BrowserContext,page:Page,base='';
const logs:string[]=[];
beforeAll(async()=>{
 mkdirSync(out,{recursive:true});
 await build({entryPoints:{harness:join(root,'test/browser/harness.ts'),'ml.worker':join(root,'src/ml.worker.ts')},outdir:out,bundle:true,format:'esm',platform:'browser',target:'es2022',logLevel:'error'});
 writeFileSync(join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>web-ml</title><script type="module" src="harness.js"></script>');
 // Production headers: cross-origin isolated (threads for WASM), everything served from this origin except the models.
 server=createServer((req,res)=>{
  const path=decodeURIComponent(new URL(req.url!,'http://x').pathname);
  const file=path==='/'?join(out,'index.html'):path.startsWith('/ort/')?join(ort,path.slice(5)):path.startsWith('/fixtures/')?join(root,'test/fixtures',path.slice(10)):join(out,path.slice(1));
  if(!existsSync(file)||!statSync(file).isFile()){res.writeHead(404).end();return;}
  const type={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.ogg':'audio/ogg','.txt':'text/plain'}[extname(file)]??'application/octet-stream';
  res.writeHead(200,{'content-type':type,'cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp','cross-origin-resource-policy':'same-origin','cache-control':'no-store'});
  createReadStream(file).pipe(res);
  if(path.startsWith('/ort/'))logs.push('served '+path);
 // A fixed port: the Cache API is per origin, and a new port each run would download the models again.
 }).listen(Number(process.env.WEB_ML_PORT??47231),'127.0.0.1');
 await new Promise(r=>server.once('listening',r));base=`http://localhost:${(server.address() as any).port}/`;
 context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium'});
 page=await context.newPage();page.on('console',m=>logs.push(m.text()));page.on('pageerror',e=>logs.push('pageerror '+e.message));
 await page.goto(base);await page.waitForFunction(()=>'webml' in window);
 expect(await page.evaluate(()=>crossOriginIsolated)).toBe(true);
});
afterAll(async()=>{await context?.close();server?.close();});

const call=<T>(name:string,...args:unknown[])=>page.evaluate(([name,args])=>(window as any).webml[name as string](...(args as unknown[])),[name,args] as const) as Promise<T>;
type Run={result:LocalSpeechResult;settled:{at:number;count:number}[];settledWords:LocalSpeechResult['words'];pushedBy:number;wallMs:number};

function checkEnglish(run:Run,minOverlap:number){
 const {result}=run,s=score(result.words.map(w=>w.word).join(' '));
 console.log(`${result.model} ${result.device}: WER ${(s.wer*100).toFixed(1)}%, overlap ${(s.overlap*100).toFixed(1)}%, ${s.hypWords}/${s.refWords} words, ${result.durationSec}s audio in ${(result.elapsedMs/1000).toFixed(1)}s (RTF ${result.rtf})`);
 expect(s.overlap).toBeGreaterThanOrEqual(minOverlap);
 // Seams neither repeat nor drop speech: about as many words as were said, and no silent hole where windows meet.
 expect(Math.abs(s.hypWords-s.refWords)/s.refWords).toBeLessThan(.05);
 const ws=result.words;
 for(let i=1;i<ws.length;i++){expect(ws[i].start).toBeGreaterThanOrEqual(ws[i-1].start-.05);expect(ws[i].start-ws[i-1].end).toBeLessThan(2.5);}
 for(const w of ws){expect(w.end).toBeGreaterThanOrEqual(w.start);expect(w.end).toBeLessThanOrEqual(result.durationSec+.01);expect(w.probability).toBeGreaterThan(0);expect(w.language).toBe('english');}
 expect(ws[0].start).toBeLessThan(1.5);expect(ws.at(-1)!.end).toBeGreaterThan(result.durationSec-3);
 expect(result).toMatchObject({language:'english',languageCode:'en'});
 // Words were handed out window by window, before the end, and together they are the transcript.
 expect(run.settled.length).toBeGreaterThan(1);expect(run.settledWords).toEqual(result.words);
 expect(result.segments.map(x=>x.start)[0]).toBe(0);expect(result.segments.at(-1)!.end).toBe(result.durationSec);
 return s;
}

describe('local Whisper in headless Chromium',()=>{
 it('reports what the device can run, and picks WASM where there is no WebGPU',async()=>{
  const report=await call<CapabilityReport>('capabilities');console.log('capabilities',JSON.stringify(report));
  expect(report.choice.device).toBe(report.capabilities.webgpu?'webgpu':'wasm');
  // The old headless shell has no GPU adapter: the same page there falls back to the CPU build.
  const shell=await chromium.launch({headless:true});
  try{const p=await shell.newPage();await p.goto(base);await p.waitForFunction(()=>'webml' in window);
   const none=await p.evaluate(()=>(window as any).webml.capabilities()) as CapabilityReport;
   expect(none.capabilities.webgpu).toBe(false);expect(none.choice).toMatchObject({device:'wasm',size:'base',encoder:'q8',decoder:'q8'});}
  finally{await shell.close();}
 });

 it('transcribes the Gettysburg Address with the model the device picks, words timed and merged across three seams',async()=>{
  const run=await call<Run>('transcribe','gettysburg.ogg');
  checkEnglish(run,.9);
  expect(run.result.segments).toHaveLength(4);
  // Downloaded once into the Cache API, and known to be there.
  expect((await call<CapabilityReport>('capabilities')).cached).toBe(true);
 });

 it('hears Chinese as Chinese without being told',async()=>{
  const {result}=await call<Run>('transcribe','chinese.ogg');
  const heard=result.words.map(w=>w.word).join(''),chars=(s:string)=>[...s.replace(/[^\p{L}\p{N}]/gu,'')];
  console.log('chinese:',heard,result.language);
  expect(result).toMatchObject({language:'chinese',languageCode:'zh'});
  // Simplified or traditional, the characters mostly match.
  expect(common(chars(chinese),chars(heard))/chars(chinese).length).toBeGreaterThan(.6);
 });

 it('runs on the CPU (WASM) when WebGPU is not there',async()=>{
  checkEnglish(await call<Run>('transcribe','gettysburg.ogg',{override:{device:'wasm',size:'base'}}),.85);
 });

 it('cancels a running transcription and is ready for the next one',async()=>{
  const outcome=await call<{name:string;after?:string}>('cancel','gettysburg.ogg');
  expect(outcome.name).toBe('AbortError');expect(words(outcome.after??'').slice(0,4)).toEqual(['four','score','and','seven']);
 });

 it('probes speed and says whether to offer the cloud',async()=>{
  const probe=await call<ProbeResult>('probe',undefined,'gettysburg.ogg');console.log('probe',JSON.stringify(probe));
  expect(probe.rtf).toBeGreaterThan(0);expect(probe.measuredRtf).toBeGreaterThan(0);expect(['local','cloud']).toContain(probe.verdict);
  expect(probe.verdict).toBe((probe.measuredRtf??probe.rtf)<=.5?'local':'cloud');
 });

 it.runIf(MATRIX)('measures every model on every device',async()=>{
  const rows=[];
  // Every model with the encoder and decoder each on the GPU or the CPU (the CPU-only rows are what a device without WebGPU gets).
  for(const override of ['base','small'].flatMap(size=>[['webgpu','webgpu'],['webgpu','wasm'],['wasm','wasm']].map(([device,decoderDevice])=>({size,device,decoderDevice}))) as Override[]){
   const load=await call<{loadMs:number;downloadMB:number}>('load',override),probe=await call<ProbeResult>('probe',override);
   const runs=[await call<Run>('transcribe','gettysburg.ogg',{override}),await call<Run>('transcribe','gettysburg.ogg',{override})];
   const best=runs.sort((a,b)=>a.result.elapsedMs-b.result.elapsedMs)[0],s=score(best.result.words.map(w=>w.word).join(' '));
   const zh=(await call<Run>('transcribe','chinese.ogg',{override})).result;
   rows.push({...override,downloadMB:load.downloadMB,loadMs:load.loadMs,encoderMs:probe.encoderMs,tokenMs:probe.tokenMs,estimatedRtf:probe.rtf,rtf:best.result.rtf,elapsedSec:best.result.elapsedMs/1000,wer:Math.round(s.wer*1000)/10,overlap:Math.round(s.overlap*1000)/10,chinese:zh.language,firstWordsAfterMs:best.settled[0]?.at});
   console.log(JSON.stringify(rows.at(-1)));
  }
  console.table(rows);writeFileSync(join(root,'test-results/matrix.json'),JSON.stringify(rows,null,1));
 });
});
afterAll(()=>{writeFileSync(join(out,'console.log'),logs.join('\n'));});
