import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {join,resolve,extname,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const here=dirname(fileURLToPath(import.meta.url)),pkg=resolve(here,'../..'),modules=resolve(pkg,'../../node_modules');
/** Where each URL prefix is served from: the test page and bundles, and the wasm parts as the web app would host them. */
export const routes:Record<string,string>={
 '/dist/':join(here,'dist'),
 '/assets/pyodide/':join(modules,'pyodide'),
 '/assets/ffmpeg/':join(modules,'@ffmpeg/core/dist/esm'),
 '/assets/ffmpeg-mt/':join(modules,'@ffmpeg/core-mt/dist/esm'),
 '/assets/esbuild/':join(modules,'esbuild-wasm'),
};
const types:Record<string,string>={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.zip':'application/zip','.map':'application/json'};
/** Bundles the worker and the page, then serves them with COOP/COEP so the page is cross-origin isolated (SharedArrayBuffer
 * for ffmpeg's threads and Python interrupts), counting the bytes each URL prefix sends. */
export async function startServer(){
 await build({entryPoints:{'sandbox.worker':join(pkg,'src/sandbox.worker.ts'),page:join(here,'page.ts')},outdir:join(here,'dist'),bundle:true,format:'esm',platform:'browser',target:'es2022',logLevel:'error',sourcemap:'linked'});
 const bytes=new Map<string,number>(),requests:string[]=[];
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url??'/','http://localhost'),path=decodeURIComponent(url.pathname);requests.push(path);
  let file:string|undefined;
  if(path==='/'||path==='/index.html')file=join(here,'index.html');
  else for(const [prefix,dir] of Object.entries(routes))if(path.startsWith(prefix)){const target=resolve(dir,path.slice(prefix.length));if(target.startsWith(dir))file=target;break;}
  try{
   if(!file||!(await stat(file)).isFile())throw new Error('not found');
   const body=await readFile(file);
   const prefix=Object.keys(routes).find(p=>path.startsWith(p))??'/';bytes.set(prefix,(bytes.get(prefix)??0)+body.length);bytes.set(path,(bytes.get(path)??0)+body.length);
   res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Content-Length':body.length,'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin','Cache-Control':'no-store'});
   res.end(body);
  }catch{res.writeHead(404,{'Cross-Origin-Resource-Policy':'same-origin'});res.end('not found');}
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',()=>r()));
 const port=(server.address() as {port:number}).port;
 return{url:`http://127.0.0.1:${port}/`,bytes,requests,close:()=>new Promise<void>(r=>server.close(()=>r()))};
}
