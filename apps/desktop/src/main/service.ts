import {CodeRuntime} from './code-runtime';
import {runtimePaths} from './resources';
import type {ProcessRequest} from '@dream/contracts';
import type {FileRequest,FileResponse} from '@dream/contracts';
import {AIConnectionSchema,type AIConnection} from '@dream/contracts';
import {utilityProcess,type UtilityProcess} from 'electron';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {ReviewRenderRequestSchema,ReviewImagesSchema,type ReviewRenderer,VisualRenderRequestSchema,VisualRenderResultSchema,type VisualRenderer} from '@dream/contracts';
export class ProjectService {
 private child:UtilityProcess;private stopped=false;private pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
 private creation=new CodeRuntime(runtimePaths());private codeRuns=new Map<string,AbortController>();private currentProject?:{id:string;folder:string};
 private reviews=new Map<string,AbortController>();private visuals=new Map<string,AbortController>();private fileRequests=new Map<string,AbortController>();
 constructor(env:Record<string,string>,private onEvent:(event:any)=>void,private reviewRenderer:ReviewRenderer,private visualRenderer?:VisualRenderer,private connectionProvider?:()=>Promise<AIConnection>,private fileProvider?:(request:FileRequest,context:any,signal:AbortSignal)=>Promise<FileResponse>){this.child=utilityProcess.fork(join(__dirname,'service.js'),[],{serviceName:'Dream project service',env:{...process.env,...env,DREAM_SHARED_LIBRARIES:join(runtimePaths().creation,'..','libraries')},stdio:'pipe'});this.child.on('message',(data:any)=>{if(data.codeCancel){this.codeRuns.get(data.codeCancel)?.abort();return;}if(data.codeRun){void this.code(data.codeRun);return;}if(data.fileCancel){this.fileRequests.get(data.fileCancel)?.abort();return;}if(data.file){void this.file(data.file);return;}if(data.connection){void this.connection(data.connection);return;}if(data.visualCancel){this.visuals.get(data.visualCancel)?.abort();return;}if(data.visual){void this.visual(data.visual);return;}if(data.reviewCancel){this.reviews.get(data.reviewCancel)?.abort();return;}if(data.review){void this.review(data.review);return;}if(data.event){if(data.event.type==='state')this.currentProject=data.event.payload.meta;onEvent(data.event);return;}const p=this.pending.get(data.id);if(p){this.pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data.result);}});this.child.on('exit',()=>{this.stopped=true;this.creation.stop();for(const controller of [...this.reviews.values(),...this.visuals.values(),...this.fileRequests.values()])controller.abort();for(const p of this.pending.values())p.reject(new Error('The project service stopped. Reopen your project to recover saved changes.'));this.pending.clear();});this.child.stderr?.on('data',d=>console.error('Project service:',d.toString()));}
 private async code(request:ProcessRequest){const controller=new AbortController();this.codeRuns.set(request.id,controller);try{if(!this.currentProject||request.projectId!==this.currentProject.id||request.workspace!==join(this.currentProject.folder,'Workspace'))throw new Error('Creation request belongs to another project.');const result=await this.creation.run(request,controller.signal,text=>{if(!this.stopped)this.child.postMessage({codeResult:{id:request.id,text}});});if(!this.stopped)this.child.postMessage({codeResult:{id:request.id,result}});}catch(error){if(!this.stopped)this.child.postMessage({codeResult:{id:request.id,error:(error as Error).message}});}finally{this.codeRuns.delete(request.id);}}
 private async file(data:{id:string;request:FileRequest;context:any}){const controller=new AbortController();this.fileRequests.set(data.id,controller);try{if(!this.fileProvider)throw new Error('Computer file access is unavailable.');const result=await this.fileProvider(data.request,data.context,controller.signal);if(!this.stopped)this.child.postMessage({fileResult:{id:data.id,result}});}catch(error){if(!this.stopped)this.child.postMessage({fileResult:{id:data.id,error:(error as Error).message}});}finally{this.fileRequests.delete(data.id);}}
 private async connection(data:{id:string}){
  try{if(!this.connectionProvider)throw new Error('Account connection is unavailable.');const result=AIConnectionSchema.parse(await this.connectionProvider());if(!this.stopped)this.child.postMessage({connectionResult:{id:data.id,result}});}
  catch(error){if(!this.stopped)this.child.postMessage({connectionResult:{id:data.id,error:(error as Error).message}});}
 }
 private async visual(data:{id:string;request:unknown}){
  const controller=new AbortController();this.visuals.set(data.id,controller);
  try{if(!this.visualRenderer)throw new Error('The visual renderer is unavailable.');const request=VisualRenderRequestSchema.parse(data.request);const result=VisualRenderResultSchema.parse(await this.visualRenderer(request,controller.signal,progress=>{if(!controller.signal.aborted)this.child.postMessage({visualProgress:{id:data.id,progress}});}));this.child.postMessage({visualResult:{id:data.id,result}});}
  catch(error){if(!controller.signal.aborted)this.child.postMessage({visualResult:{id:data.id,error:(error as Error).message}});}
  finally{this.visuals.delete(data.id);}
 }
 private async review(data:{id:string;request:unknown}){
  const controller=new AbortController();this.reviews.set(data.id,controller);
  try{const request=ReviewRenderRequestSchema.parse(data.request);const result=ReviewImagesSchema.parse(await this.reviewRenderer(request,controller.signal));this.child.postMessage({reviewResult:{id:data.id,result}});}
  catch(error){if(!controller.signal.aborted)this.child.postMessage({reviewResult:{id:data.id,error:(error as Error).message}});}
  finally{this.reviews.delete(data.id);}
 }
 command(command:unknown):Promise<any>{return new Promise((resolve,reject)=>{const id=randomUUID();this.pending.set(id,{resolve,reject});this.child.postMessage({id,command});});}
 config(config:{whisperModel?:string;analysisConnectionChanged?:boolean;analysisEnabled?:boolean}){this.child.postMessage({config});}
 /** Commands run on the user's computer whenever this says so (computer access allowed). */
 allowLocalCommands(check:()=>boolean){this.creation.local=check;}
 close(){this.creation.stop();return new Promise<void>(resolve=>{const timer=setTimeout(()=>{this.child.kill();resolve();},10000);this.child.once('exit',()=>{clearTimeout(timer);resolve();});this.child.postMessage({close:true});});}
}
