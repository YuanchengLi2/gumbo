import type {CompiledVisual} from './compile';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {Asset} from '@dream/footage';
import type {VisualDefinition} from '@dream/contracts';
import {mediaResponse} from '../main/media-response';
import {mediaAssetPath} from '../main/media-paths';
import {visualCSP} from './policy';

/** The server has a finite registry. URLs never select filesystem paths. */
export async function visualAssets(runtimeDirectory:string,definition:VisualDefinition,code:string|CompiledVisual,assets:Asset[],authorize?:(path:string)=>void){
 const token=randomBytes(24).toString('hex'),prefix=`/${token}/`,files=new Map<string,Uint8Array>();
 for(const entry of await readdir(runtimeDirectory,{withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith('.js'))files.set(`runtime/${entry.name}`,await readFile(join(runtimeDirectory,entry.name)));
 if(!files.has('runtime/entry.js'))throw new Error('The packaged visual runtime is missing.');
 const chosen=new Map<string,Asset>();for(const id of definition.assetIds){const asset=assets.find(a=>a.id===id);if(!asset)throw new Error(`Selected visual asset ${id} is unavailable.`);chosen.set(id,asset);}
 if(typeof code!=='string')for(const [name,source] of Object.entries(code.files)){if(!/^(?:component|module-[a-f0-9]{64})\.js$/.test(name))throw new Error('Invalid compiled module URL.');files.set(name,Buffer.from(source));}
 const {moduleSources,code:sourceCode,...metadata}=definition;
 const configuration=JSON.stringify({definition:metadata,assets:Object.fromEntries([...chosen.keys()].map(id=>[id,`${prefix}assets/${encodeURIComponent(id)}`]))}).replaceAll('<','\\u003c');
 const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><style>html,body,#root{margin:0;width:${definition.width}px;height:${definition.height}px;overflow:hidden;background:${definition.transparent?'transparent':'#000'};}*{box-sizing:border-box;}</style></head><body><div id="root"></div><script id="dream-definition" type="application/json">${configuration}</script><script type="module" src="./runtime/entry.js"></script></body></html>`;
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',visualCSP);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  try{
   if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
   const url=new URL(req.url!,'http://127.0.0.1'),path=url.pathname;if(!path.startsWith(prefix)){res.writeHead(404).end();return;}const key=path.slice(prefix.length);
   if(key==='index.html'){res.setHeader('Content-Type','text/html');res.end(req.method==='HEAD'?undefined:html);return;}
   if(key==='component.js'||files.has(key)){res.setHeader('Content-Type','text/javascript');res.end(req.method==='HEAD'?undefined:key==='component.js'&&typeof code==='string'?code:files.get(key));return;}
   if(key.startsWith('assets/')){const asset=chosen.get(decodeURIComponent(key.slice(7)));if(asset){let source:string;try{source=mediaAssetPath(asset,'preview',url.searchParams.get('frame'));}catch{res.writeHead(404).end();return;}authorize?.(source);const response=mediaResponse(source,req.headers.range??null);res.writeHead(response.status,Object.fromEntries(response.headers));if(req.method==='HEAD'){await response.body?.cancel();res.end();}else if(response.body)await pipeline(Readable.fromWeb(response.body as any),res);else res.end();return;}}
   res.writeHead(404).end();
  }catch{if(!res.headersSent)res.writeHead(500);res.end();}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address() as {port:number},origin=`http://127.0.0.1:${address.port}`;
 return{origin,url:`${origin}${prefix}index.html`,close:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();})};
}
