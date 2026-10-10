import {protocol} from 'electron';
import {join} from 'node:path';
import {registry} from './media';
import {mediaResponse} from './media-response';
import {engineRoute,sceneFromAsset,DraftScenes} from './engine-routes';
import {runtimePaths} from './resources';

export const drafts=new DraftScenes();
const beats=(id:string)=>(registry.get(id)?.generated as {beats?:number[]}|undefined)?.beats;

/** dream-engine://app/... serves engine scene documents to the player: the runtime chunks (immutable), each published
 * scene's host page, bundle and resources, and draft previews. Scenes can reach nothing else. */
export function installEngineProtocol(authorize?:(path:string)=>void){
 const runtimeDir=join(runtimePaths().staged,'engine');
 protocol.handle('dream-engine',request=>{
  const url=new URL(request.url);
  if(url.hostname!=='app')return new Response('Not found',{status:404});
  const answer=engineRoute(url.pathname,{runtimeDir,asset:id=>registry.get(id),scene:id=>{const asset=registry.get(id);return asset?sceneFromAsset(asset,beats):undefined;},draft:hash=>drafts.get(hash),cspSources:['dream-engine:']});
  if(answer.kind==='html')return new Response(answer.html,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':answer.csp,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
  if(answer.kind==='missing')return new Response('Not found',{status:404,headers:{'Access-Control-Allow-Origin':'*'}});
  // Project media keeps the same file-access checks as dream-media; runtime and compiled files are Dream's own.
  if(!answer.immutable||!answer.path.startsWith(runtimeDir))try{authorize?.(answer.path);}catch{return new Response('Not found',{status:404});}
  const response=mediaResponse(answer.path,request.headers.get('range'));
  if(answer.immutable)response.headers.set('Cache-Control','public, max-age=31536000, immutable');
  return response;
 });
}
