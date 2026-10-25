import {basename} from 'node:path';
import type {ProjectDB} from '@dream/project-db';
import type {InitialRequest} from '@dream/contracts';
import type {Ingest} from './media';
import type {Agent} from '@dream/agent';
export type BootstrapState=InitialRequest&{assetIds:string[];status:'preparing'|'interrupted'|'dispatched';error?:string};
export class ProjectBootstrap {
 private controller:AbortController|null=null;private task:Promise<void>|null=null;
 constructor(private db:ProjectDB,private ingest:Ingest,private agent:Agent,private publish:(type:string,payload:unknown)=>void,private preparePackages?:(signal:AbortSignal)=>Promise<void>){}
 prepare(request:InitialRequest){const existing=this.db.getMeta('bootstrap');if(!existing)this.db.db.transaction(()=>{this.db.setMeta('bootstrap',JSON.stringify({...request,assetIds:[],status:'preparing'}));if(request.text.trim()){this.db.setMeta('pending_request',JSON.stringify({turnId:request.requestId,text:request.text,selection:[],assetIds:[]}));this.db.userMessage(request.text,request.requestId);}})();else if(JSON.parse(existing).requestId!==request.requestId)throw new Error('This project already has an initial request.');}
 abandon(){const saved=this.db.getMeta('bootstrap');if(saved){const value=JSON.parse(saved);value.status='dispatched';this.db.setMeta('bootstrap',JSON.stringify(value));}}
 get pending(){const saved=this.db.getMeta('bootstrap');return !!saved&&JSON.parse(saved).status!=='dispatched';}
 start(feedback?:string){if(feedback?.trim()){const saved=this.db.getMeta('bootstrap');if(saved){const value=JSON.parse(saved);value.text+='\nAdditional direction: '+feedback.trim();this.db.setMeta('bootstrap',JSON.stringify(value));}}if(this.task)return this.task;this.controller=new AbortController();const signal=this.controller.signal;this.task=this.run(signal).finally(()=>{this.controller=null;this.task=null;});return this.task;}
 async cancel(){this.controller?.abort();await this.task;}
 private async run(signal:AbortSignal){const saved=this.db.getMeta('bootstrap');if(!saved)return;const value:BootstrapState=JSON.parse(saved);if(value.status==='dispatched')return;const save=()=>{this.db.setMeta('bootstrap',JSON.stringify(value));this.publish('state',this.db.state({bounded:true}));};
  try{value.status='preparing';delete value.error;this.db.setMeta('ai_status','running');save();
   for(let i=value.assetIds.length;i<value.paths.length;i++){signal.throwIfAborted();this.publish('ai.step',{id:`import:${i}`,label:`Importing ${basename(value.paths[i])}`,status:'running'});const asset=await this.ingest.register(value.paths[i],true,`${value.requestId}:${i}`,signal);value.assetIds.push(asset.id);this.publish('ai.step',{id:`import:${i}`,label:`Importing ${basename(value.paths[i])}`,status:'complete'});save();}
   if(value.assetIds.length)this.publish('ai.step',{label:'Preparing media for playback',status:'running'});await this.ingest.waitUntilUsable(value.assetIds,signal);signal.throwIfAborted();if(value.assetIds.length)this.publish('ai.step',{label:'Preparing media for playback',status:'complete'});const failed=this.db.footage().assets.filter(a=>value.assetIds.includes(a.id)&&a.status==='failed');if(failed.length)throw new Error(`Could not prepare ${failed.map(a=>a.filename).join(', ')}. Retry the import.`);
   await this.preparePackages?.(signal);signal.throwIfAborted();
   if(value.text.trim()){const task=this.agent.message(value.text,[],value.intent??'auto',value.assetIds,value.requestId,undefined,value.model);value.status='dispatched';save();await task;}else{value.status='dispatched';this.db.setMeta('ai_status','idle');save();}
  }catch(error){value.status='interrupted';value.error=signal.aborted?'Preparation paused. Your imported files are saved.':(error as Error).message;this.db.setMeta('ai_status','interrupted');save();}
 }
}
