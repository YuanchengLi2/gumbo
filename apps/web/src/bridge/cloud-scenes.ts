import {resolve} from '@dream/timeline';
import {fileAt} from '../project/media/paths';
import type {ProjectClient} from './project';
import type {Account} from './account';
import {onEvent} from './events';

/** Quick render (services/scene-render): an export's coded scene drawn in the cloud, many frames at once. The gateway
 * says whether this account has it and gives a pass; the scene goes to the render service as its scene page would get
 * it here (engine.ts): configuration, compiled bundle, resources and the project media it uses. The answer is the
 * scene's frames as transparent WebM pieces. Anything short of that, and the export draws the scene itself.
 * Scenes are also drawn ahead, in the background, once an edit settles (prerenderScenes): by the time Export is
 * clicked, the scenes it shows are usually there already. A drawing is kept for its scene's revision. */
type Source={config:Record<string,unknown>;version:number;bundlePath:string;files:Record<string,string>;media:Record<string,string>};
export type CloudScene={fps:number;chunks:{start:number;end:number;video:Blob}[]};
type Answer=CloudScene|{unavailable:string};
export type SceneRequest={assetId:string;revision?:string;width:number;height:number;fps:number;frames:number;signal?:AbortSignal};
// The cloud browsers open the scene page on the live site.
const PAGE='https://usegumbo.app/app/engine/app/scene/cloud/index.html',MAX_UPLOAD=60*1024*1024,MAX_FRAMES=36_000;
async function base64(blob:Blob){const bytes=new Uint8Array(await blob.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=0x8000)text+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(text);}
const encoded=async(paths:Record<string,string>)=>Object.fromEntries((await Promise.all(Object.entries(paths).map(async([key,path])=>{try{return[[key,await base64(await fileAt(path))]];}catch{return[];}}))).flat());
const unbase64=(text:string)=>new Blob([Uint8Array.from(atob(text),c=>c.charCodeAt(0))],{type:'video/webm'});

/** What a scene page loads, for a scene asset, as base64. */
export async function sceneJob(service:()=>ProjectClient,assetId:string){
 const source=await service().host<Source>('sceneSource',{kind:'scene',id:assetId});
 return{config:source.config,version:source.version,bundle:await base64(await fileAt(source.bundlePath)),files:await encoded(source.files),media:await encoded(source.media)};
}
// An account without quick render is asked again after ten minutes, not on every edit.
let unavailableUntil=0,unavailableReason='';
async function render(account:Account,service:()=>ProjectClient,request:SceneRequest,signal?:AbortSignal):Promise<Answer>{
 if(Date.now()<unavailableUntil)return{unavailable:unavailableReason};
 const pass=await account.scenePass().catch(()=>null) as {available?:boolean;url?:string;token?:string;reason?:string}|null;
 if(!pass?.available||!pass.url||!pass.token){unavailableReason=pass?.reason??'Quick render is unavailable.';unavailableUntil=Date.now()+10*60_000;return{unavailable:unavailableReason};}
 const payload=await sceneJob(service,request.assetId),body=JSON.stringify({token:pass.token,job:{page:PAGE,width:request.width,height:request.height,fps:request.fps,frames:request.frames,payload}});
 if(body.length>MAX_UPLOAD)return{unavailable:'This scene’s files are too big for quick render.'};
 const response=await fetch(pass.url,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10*60_000)]):AbortSignal.timeout(10*60_000)});
 if(!response.ok){const reason=await response.json().catch(()=>({})) as {detail?:string};throw new Error(reason.detail??`Quick render failed (${response.status}).`);}
 const answer=await response.json() as {fps:number;chunks:{start:number;end:number;webm:string}[]};
 return{fps:answer.fps,chunks:answer.chunks.map(c=>({start:c.start,end:c.end,video:unbase64(c.webm)}))};
}
/** Drawings by scene revision and size, finished or under way; one revision is kept per scene. */
const drawn=new Map<string,Promise<Answer>>();
const keyOf=(r:SceneRequest)=>`${r.assetId}|${r.revision}|${r.width}x${r.height}@${r.fps}/${r.frames}`;
function shared(account:Account,service:()=>ProjectClient,request:SceneRequest){
 const key=keyOf(request);let drawing=drawn.get(key);
 if(!drawing){
  for(const old of drawn.keys())if(old.startsWith(request.assetId+'|'))drawn.delete(old);
  drawing=render(account,service,request);drawn.set(key,drawing);
  // A failure, or no quick render, is not kept: the next export or settled edit asks again.
  drawing.then(answer=>{if('unavailable' in answer)drawn.delete(key);},()=>drawn.delete(key));
 }
 return drawing;
}
export function cloudScene(account:Account,service:()=>ProjectClient,request:SceneRequest):Promise<Answer>{
 if(!request.revision)return render(account,service,request,request.signal);
 // An export stops waiting when it is cancelled; the drawing carries on for the next one.
 const drawing=shared(account,service,request),signal=request.signal;
 return signal?Promise.race([drawing,new Promise<never>((_,reject)=>{if(signal.aborted)reject(signal.reason);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})]):drawing;
}

/** Draws ahead: once the project has been quiet for a few seconds and Gumbo is not editing, every engine scene on the
 * timeline without a drawing of its current revision is sent to quick render. */
export function prerenderScenes(account:Account,service:()=>ProjectClient,quietMs=6000){
 let timer:ReturnType<typeof setTimeout>|undefined,editing=false;
 const settle=async()=>{
  if(editing||!account.signedIn()||Date.now()<unavailableUntil)return;
  const state=await service().command({type:'state'}).catch(()=>null) as any;if(!state?.timeline||!state?.footage)return;
  let r;try{r=resolve(state.timeline,state.footage);}catch{return;}
  const used=new Set([...r.clips.map(c=>c.assetId),...r.items.flatMap(i=>i.source?[i.source.assetId]:[])]);
  for(const asset of state.footage.assets as any[]){
   if(!used.has(asset.id)||asset.scene?.format!=='engine')continue;
   const fps=asset.fps||30,frames=Math.max(1,Math.round(asset.durationSec*fps));if(frames>MAX_FRAMES)continue;
   void shared(account,service,{assetId:asset.id,revision:asset.scene.revisionId,width:asset.width,height:asset.height,fps,frames}).catch(error=>console.warn('[quick render] drawing ahead failed:',(error as Error).message));
  }
 };
 const later=()=>{clearTimeout(timer);timer=setTimeout(()=>void settle(),quietMs);};
 return onEvent((event:any)=>{
  if(event?.type==='ai.status'){editing=event.payload?.status==='running';if(!editing)later();}
  else if(event?.type==='state.delta')later();
 });
}
