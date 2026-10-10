import type {Asset} from '@dream/footage';
import {mediaAssetPath} from './media-paths';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {mediaResponse} from './media-response';
import {engineRoute,sceneFromAsset} from './engine-routes';

/** Snapshot-owned assets: opening another project cannot change an in-flight render. Engine scenes are served under
 * /<token>/engine/ with the same routes as dream-engine:// in the player, restricted to this server's origin. */
export async function renderServer(assets:ReadonlyMap<string,string|Asset>,authorize?:(path:string)=>void,options:{engineRuntime?:string}={}){
 const token=randomUUID();let origin='';
 const assetOf=(id:string)=>{const value=assets.get(id);return typeof value==='object'?value:undefined;};
 const beats=(id:string)=>(assetOf(id)?.generated as {beats?:number[]}|undefined)?.beats;
 const pipe=(req:import('node:http').IncomingMessage,res:import('node:http').ServerResponse,response:Response)=>{res.writeHead(response.status,Object.fromEntries(response.headers));
  if(response.body&&req.method!=='HEAD'){const stream=Readable.fromWeb(response.body as any);res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);}else{void response.body?.cancel();res.end();}};
 const server=createServer((req,res)=>{try{
  const url=new URL(req.url??'','http://localhost'),parts=url.pathname.split('/');
  if(parts[1]!==token){res.writeHead(403).end();return;}
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
  if(parts[2]==='engine'&&options.engineRuntime){
   const answer=engineRoute(parts.slice(3).join('/'),{runtimeDir:options.engineRuntime,asset:assetOf,scene:id=>{const asset=assetOf(id);return asset?sceneFromAsset(asset,beats):undefined;},draft:()=>undefined,cspSources:[origin]});
   if(answer.kind==='html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':answer.csp,'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}).end(answer.html);return;}
   if(answer.kind==='missing'){res.writeHead(404,{'Access-Control-Allow-Origin':'*'}).end();return;}
   if(!answer.immutable)authorize?.(answer.path);
   pipe(req,res,mediaResponse(answer.path,req.headers.range??null));return;
  }
  if(parts.length!==3){res.writeHead(403).end();return;}
  const asset=assets.get(decodeURIComponent(parts[2]));if(!asset){res.writeHead(404).end();return;}
  const path=typeof asset==='string'?asset:mediaAssetPath(asset,url.searchParams.get('variant')==='audio'?'audio':'original',url.searchParams.get('frame'));
  authorize?.(path);pipe(req,res,mediaResponse(path,req.headers.range??null));
 }catch{if(!res.headersSent)res.writeHead(404);res.end();}});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const {port}=server.address() as {port:number};origin=`http://127.0.0.1:${port}`;
 return {engineBase:`${origin}/${token}/engine`,audioMedia:Object.fromEntries([...assets.keys()].map(id=>[id,`${origin}/${token}/${encodeURIComponent(id)}?variant=audio`])),media:Object.fromEntries([...assets.keys()].map(id=>[id,`${origin}/${token}/${encodeURIComponent(id)}`])),close:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();})};
}
