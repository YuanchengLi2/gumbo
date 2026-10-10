import type {Asset} from '@dream/footage';
import {mediaAssetPath} from './media-paths';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {mediaResponse} from './media-response';

/** Snapshot-owned assets: opening another project cannot change an in-flight render. */
export async function renderServer(assets:ReadonlyMap<string,string|Asset>,authorize?:(path:string)=>void){
 const token=randomUUID();
 const server=createServer((req,res)=>{try{
  const url=new URL(req.url??'','http://localhost'),parts=url.pathname.split('/');
  if(parts.length!==3||parts[1]!==token){res.writeHead(403).end();return;}
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
  const asset=assets.get(decodeURIComponent(parts[2]));if(!asset){res.writeHead(404).end();return;}
  const path=typeof asset==='string'?asset:mediaAssetPath(asset,url.searchParams.get('variant')==='audio'?'audio':'original',url.searchParams.get('frame'));
  authorize?.(path);const response=mediaResponse(path,req.headers.range??null);res.writeHead(response.status,Object.fromEntries(response.headers));
  if(response.body&&req.method!=='HEAD'){const stream=Readable.fromWeb(response.body as any);res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);}else{void response.body?.cancel();res.end();}
 }catch{if(!res.headersSent)res.writeHead(404);res.end();}});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const {port}=server.address() as {port:number};
 return {audioMedia:Object.fromEntries([...assets.keys()].map(id=>[id,`http://127.0.0.1:${port}/${token}/${encodeURIComponent(id)}?variant=audio`])),media:Object.fromEntries([...assets.keys()].map(id=>[id,`http://127.0.0.1:${port}/${token}/${encodeURIComponent(id)}`])),close:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();})};
}
