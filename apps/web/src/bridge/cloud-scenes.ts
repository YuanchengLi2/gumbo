import {fileAt} from '../project/media/paths';
import type {ProjectClient} from './project';
import type {Account} from './account';

/** Quick render (services/scene-render): an export's coded scene drawn in the cloud, many frames at once. The gateway
 * says whether this account has it and gives a pass; the scene goes to the render service as its scene page would get
 * it here (engine.ts): configuration, compiled bundle, resources and the project media it uses. The answer is the
 * scene's frames as transparent WebM pieces. Anything short of that, and the export draws the scene itself. */
type Source={config:Record<string,unknown>;version:number;bundlePath:string;files:Record<string,string>;media:Record<string,string>};
export type CloudScene={fps:number;chunks:{start:number;end:number;video:Blob}[]};
// The cloud browsers open the scene page on the live site.
const PAGE='https://usegumbo.app/app/engine/app/scene/cloud/index.html',MAX_UPLOAD=60*1024*1024;
async function base64(blob:Blob){const bytes=new Uint8Array(await blob.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=0x8000)text+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(text);}
const encoded=async(paths:Record<string,string>)=>Object.fromEntries((await Promise.all(Object.entries(paths).map(async([key,path])=>{try{return[[key,await base64(await fileAt(path))]];}catch{return[];}}))).flat());
const unbase64=(text:string)=>new Blob([Uint8Array.from(atob(text),c=>c.charCodeAt(0))],{type:'video/webm'});

/** What a scene page loads, for a scene asset, as base64. */
export async function sceneJob(service:()=>ProjectClient,assetId:string){
 const source=await service().host<Source>('sceneSource',{kind:'scene',id:assetId});
 return{config:source.config,version:source.version,bundle:await base64(await fileAt(source.bundlePath)),files:await encoded(source.files),media:await encoded(source.media)};
}
export async function cloudScene(account:Account,service:()=>ProjectClient,request:{assetId:string;width:number;height:number;fps:number;frames:number;signal?:AbortSignal}):Promise<CloudScene|{unavailable:string}>{
 const pass=await account.scenePass().catch(()=>null) as {available?:boolean;url?:string;token?:string;reason?:string}|null;
 if(!pass?.available||!pass.url||!pass.token)return{unavailable:pass?.reason??'Quick render is unavailable.'};
 const payload=await sceneJob(service,request.assetId),body=JSON.stringify({token:pass.token,job:{page:PAGE,width:request.width,height:request.height,fps:request.fps,frames:request.frames,payload}});
 if(body.length>MAX_UPLOAD)return{unavailable:'This scene’s files are too big for quick render.'};
 const response=await fetch(pass.url,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:request.signal?AbortSignal.any([request.signal,AbortSignal.timeout(10*60_000)]):AbortSignal.timeout(10*60_000)});
 if(!response.ok){const reason=await response.json().catch(()=>({})) as {detail?:string};throw new Error(reason.detail??`Quick render failed (${response.status}).`);}
 const answer=await response.json() as {fps:number;chunks:{start:number;end:number;webm:string}[]};
 return{fps:answer.fps,chunks:answer.chunks.map(c=>({start:c.start,end:c.end,video:unbase64(c.webm)}))};
}
