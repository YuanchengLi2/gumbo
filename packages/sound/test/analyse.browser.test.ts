import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {build} from 'esbuild';
import {chromium,type BrowserContext,type Page} from 'playwright-core';
import {createServer,type Server} from 'node:http';
import {createReadStream,existsSync,mkdirSync,statSync,writeFileSync} from 'node:fs';
import {extname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

/** The web's sound analysis end to end in headless Edge: web-sound-runtime.ts hands samples to sound-analysis.worker.ts,
 * which runs both models on ONNX Runtime's WebAssembly (the build the web app serves at /ort/), cross-origin isolated as
 * in production so it has threads. The models download from Hugging Face once into a browser profile in the temp folder.
 * The fixture is two people talking, then applause (artifacts/models-download/2-two-speakers-en.wav, from sherpa-onnx's
 * speaker-embedding test files). */
const root=resolve(__dirname,'..'),repo=resolve(root,'../..'),out=join(root,'test-results/harness'),ort=join(repo,'node_modules/onnxruntime-web/dist');
const fixture=process.env.SOUND_FIXTURE??join(repo,'artifacts/models-download/2-two-speakers-en.wav'),profile=join(tmpdir(),'gumbo-sound-edge');
let server:Server,context:BrowserContext,page:Page;const logs:string[]=[];
beforeAll(async()=>{
 mkdirSync(out,{recursive:true});
 // The worker's URL in web-sound-runtime.ts names its .ts source, which Vite builds; here esbuild builds it beside the page.
 await build({entryPoints:{harness:join(root,'test/browser/harness.ts'),'sound-analysis.worker':join(repo,'apps/web/src/project/sound-analysis.worker.ts')},outdir:out,bundle:true,format:'esm',platform:'browser',target:'es2022',logLevel:'error',
  alias:{'@dream/sound':join(root,'src/index.ts')},define:{'import.meta.env.BASE_URL':'"/"'},
  plugins:[{name:'worker-url',setup(b){b.onLoad({filter:/web-sound-runtime\.ts$/},async args=>({contents:(await import('node:fs')).readFileSync(args.path,'utf8').replace("'./sound-analysis.worker.ts'","'./sound-analysis.worker.js'"),loader:'ts'}));}}]});
 writeFileSync(join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>sound</title><script type="module" src="harness.js"></script>');
 server=createServer((req,res)=>{
  const path=decodeURIComponent(new URL(req.url!,'http://x').pathname);
  const file=path==='/'?join(out,'index.html'):path.startsWith('/ort/')?join(ort,path.slice(5)):path==='/fixture.wav'?fixture:join(out,path.slice(1));
  if(!existsSync(file)||!statSync(file).isFile()){res.writeHead(404).end();return;}
  const type={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.wav':'audio/wav'}[extname(file)]??'application/octet-stream';
  res.writeHead(200,{'content-type':type,'cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp','cross-origin-resource-policy':'same-origin','cache-control':'no-store'});
  createReadStream(file).pipe(res);
 }).listen(47241,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 context=await chromium.launchPersistentContext(profile,{headless:true,channel:'msedge'});
 page=await context.newPage();page.on('console',m=>logs.push(m.text()));page.on('pageerror',e=>logs.push('pageerror '+e.message));
 await page.goto('http://localhost:47241/');await page.waitForFunction(()=>'sound' in window);
 expect(await page.evaluate(()=>crossOriginIsolated)).toBe(true);
});
afterAll(async()=>{await context?.close();server?.close();});

describe.skipIf(!existsSync(fixture))('sound analysis in the browser',()=>{
 it('hears two voices and the applause, in a worker of its own',async()=>{
  const {result,ms,threads}=await page.evaluate(()=>(window as any).sound.analyse('/fixture.wav'));
  const again=await page.evaluate(()=>(window as any).sound.analyse('/fixture.wav'));console.log(`again, models loaded: ${again.ms} ms`);
  console.log(`${result.durationSec} s of audio analysed in ${ms} ms on ${threads} cores; ${result.speakers.count} voices, sections ${result.sections.map((s:any)=>s.kind).join(', ')}`);
  if(logs.some(l=>l.startsWith('pageerror')))console.log(logs.join('\n'));
  expect(result.speakers.count).toBe(2);
  expect(result.events.some((e:any)=>e.group==='applause')).toBe(true);
  expect(result.sections[0].kind).toBe('speech');
 });
});
