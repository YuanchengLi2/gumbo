import type {ProjectDB} from '@dream/project-db';
import type {CreationCommand,CreationResult,CreationKind,EditingEnginePort,GenerationCommand,GenerationResult,LibraryRevision,VisualCommand,VisualResult,VisualRevision,VisualRenderer} from '@dream/contracts';
import {CreationJobs} from './creation-jobs';
import {MediaLibrary} from './library';
import {VisualLibrary} from './visual-library';

/** One execution owner per project. Creative media types are internal adapters. */
export class EditingEngine implements EditingEnginePort{
 readonly capabilities:CreationKind[];
 private jobs:CreationJobs;
 private audio:MediaLibrary;
 private visual?:VisualLibrary;
 constructor(private db:ProjectDB,options:{audioWorker:string;renderVisual?:VisualRenderer},publish:(type:string,payload:unknown)=>void){
  this.jobs=new CreationJobs(db,(type,payload)=>{publish(type,payload);if(type==='state')this.audio.scheduleBindings();});
  this.audio=new MediaLibrary(db,options.audioWorker,publish,this.jobs);
  if(options.renderVisual)this.visual=new VisualLibrary(db,options.renderVisual,publish,this.jobs);
  this.capabilities=this.visual?['audio','visual']:['audio'];
 }
 visualSource(name:string,input:any){if(!this.visual)throw new Error('Visual creation is unavailable.');const source=this.visual.sources;
  if(name==='create_visual_draft')return source.create(input.baseRevisionId?this.visual.get(input.baseRevisionId).definition:JSON.parse(input.definition));
  if(name==='get_visual_draft')return source.get(input.draftId);
  if(name==='write_visual_module')return source.write(input.draftId,input.expectedRevision,input.path,input.code,input.reuseHash);
  if(name==='patch_visual_module')return source.patch(input.draftId,input.expectedRevision,input.path,input.expectedHash,input.oldText,input.newText);
  if(name==='set_visual_parameters')return source.parameters(input.draftId,input.expectedRevision,input.parameters);
  if(name==='read_visual_module')return source.read(input.hash,input.offset,input.limit);
  if(name==='commit_visual_draft')return source.get(input.draftId,input.expectedRevision).definition;
  throw new Error('Unknown visual source operation.');
 }
 apply=(...args:Parameters<ProjectDB['apply']>)=>{const result=this.db.apply(...args);this.audio.scheduleBindings();return result;};
 generate(command:GenerationCommand,turnId?:string,signal?:AbortSignal):Promise<GenerationResult>;
 generate(command:VisualCommand,turnId?:string,signal?:AbortSignal):Promise<VisualResult>;
 generate(command:CreationCommand,turnId?:string,signal?:AbortSignal):Promise<CreationResult>{return this.jobs.run(command,turnId,signal);}
 list(kind:'audio'):LibraryRevision[];
 list(kind:'visual'):VisualRevision[];
 list(kind:CreationKind):LibraryRevision[]|VisualRevision[]{return kind==='audio'?this.audio.list():this.visual?.list()??[];}
 get(revisionId:string){const visual=this.visual?.list().find(revision=>revision.revisionId===revisionId);return visual??this.audio.get(revisionId);}
 resume(requestId:string){return this.jobs.resume(requestId);}
 cancel(requestId:string){this.jobs.cancel(requestId);}
 recover(){this.jobs.recover();}
 reconcile(){this.audio.scheduleBindings();}
 undo(redo=false){const state=this.db.undo(redo);this.db.workspace.restorePending();this.reconcile();return state;}
 restore(versionId:string){const state=this.db.restore(versionId);this.db.workspace.restorePending();this.reconcile();return state;}
 branch(versionId:string,name:string){const state=this.db.branch(versionId,name);this.db.workspace.restorePending();this.reconcile();return state;}
 async close(){this.audio.stopBindings();await this.jobs.close();}
}
