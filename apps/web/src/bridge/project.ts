import {ReviewRenderRequestSchema,ReviewImagesSchema} from '@dream/contracts';
import {PlayerFrames} from '../../../desktop/src/main/player-frames';
import type {Account} from './account';
import {publish} from './events';
import {busy} from './awake';

/** The page's side of the project worker (src/project/project.worker.ts): what the desktop's main process does with
 * its project service (main/service.ts, main/index.ts route): sends commands and the project list's requests, passes
 * the service's events to the editor, and answers what the service asks of its host: the account's connection and the
 * edit's frames now; coded visuals as their phase arrives. Its questions about the computer's files and its commands
 * are answered in the worker (project/files.ts, project/commands.ts). */
type Pending={resolve:(value:any)=>void;reject:(error:Error)=>void};
export class ProjectClient{
 private worker:Worker;private pending=new Map<string,Pending>();private hosted=new Map<string,Pending>();readonly ready:Promise<void>;
 constructor(private account:Account,env:Record<string,string>){
  this.worker=new Worker(new URL('../project/project.worker.ts',import.meta.url),{type:'module',name:'gumbo-project'});
  this.ready=new Promise((resolve,reject)=>{const first=(event:MessageEvent)=>{if(event.data?.booted){this.worker.removeEventListener('message',first);resolve();}else if(event.data?.bootError){this.worker.removeEventListener('message',first);reject(new Error('Gumbo could not start its project service: '+event.data.bootError));}};this.worker.addEventListener('message',first);});
  this.worker.addEventListener('message',event=>void this.receive(event.data));
  this.worker.addEventListener('error',event=>console.error('[project worker]',event.message));
  this.worker.postMessage({boot:{env}});
 }
 private post(message:unknown){this.worker.postMessage(message);}
 async command<T=any>(command:unknown):Promise<T>{await this.ready;const id=crypto.randomUUID();return new Promise<T>((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.post({id,command});});}
 async host<T=any>(action:string,args:unknown={}):Promise<T>{await this.ready;const id=crypto.randomUUID();return new Promise<T>((resolve,reject)=>{this.hosted.set(id,{resolve,reject});this.post({host:{id,action,args}});});}
 config(config:unknown){void this.ready.then(()=>this.post({config}));}
 /** Frames of the edit for Roux, drawn by the editor's own engine (main/player-frames.ts): the request reaches the editor
  * as the event the desktop's window gets, and the editor answers through framesResult. */
 private frames=new PlayerFrames(()=>({isDestroyed:()=>false,webContents:{send:(_channel:string,event:{type:string;payload:unknown})=>publish(event.type,event.payload)}}) as any);
 private reviews=new Map<string,AbortController>();
 framesResult(id:string,result:unknown){this.frames.settle(id,result);}
 private async review(data:{id:string;request:unknown}){
  const controller=new AbortController();this.reviews.set(data.id,controller);
  try{const request=ReviewRenderRequestSchema.parse(data.request);this.post({reviewResult:{id:data.id,result:ReviewImagesSchema.parse(await this.frames.request(request,controller.signal))}});}
  catch(error){if(!controller.signal.aborted)this.post({reviewResult:{id:data.id,error:(error as Error).message}});}
  finally{this.reviews.delete(data.id);}
 }
 private async receive(data:any){
  if(!data||data.booted||data.bootError)return;
  if(data.waiting){console.info('[project worker] waiting for Gumbo in another tab to close');return;}
  if(data.hostResult){const p=this.hosted.get(data.hostResult.id);this.hosted.delete(data.hostResult.id);if(p)data.hostResult.error?p.reject(new Error(data.hostResult.error)):p.resolve(data.hostResult.result);return;}
  if(data.id&&this.pending.has(data.id)&&('result' in data||'error' in data)){const p=this.pending.get(data.id)!;this.pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data.result);return;}
  if(data.event){const e=data.event;
   // A run's log is sent by itself (edit logs), as the desktop's route does, rather than reaching the editor.
   if(e.type==='ai.status')busy('roux',e.payload?.status==='running');
   if(e.type==='ai.turn_end'){if(e.payload?.log)void this.account.editLog({turnId:e.payload.turnId,log:e.payload.log}).catch(()=>{});return;}
   publish(e.type,e.payload,e.projectId,e.turnId);return;}
  if(data.connection){const id=data.connection.id;try{this.post({connectionResult:{id,result:{url:this.account.gateway(),token:await this.account.token(),accountId:this.account.accountId}}});}catch(error){this.post({connectionResult:{id,error:(error as Error).message}});}return;}
  if(data.visual){this.post({visualResult:{id:data.visual.id,error:'Coded visuals are not available on the web yet.'}});return;}
  if(data.reviewCancel){this.reviews.get(data.reviewCancel)?.abort();return;}
  if(data.review){void this.review(data.review);return;}
  if(data.exited!==undefined)console.warn('[project worker] exited',data.exited);
 }
}
