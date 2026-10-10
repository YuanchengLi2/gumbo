import type {ProjectDB} from '@dream/project-db';
import {CreationCommandSchema,type CreationCommand,type CreationResult,type CreationKind} from '@dream/contracts';

type Pending={command:CreationCommand;turnId?:string;status:'queued'|'running'|'complete'|'interrupted'|'failed';result?:CreationResult};
type Executor=(command:CreationCommand,turnId:string|undefined,signal:AbortSignal)=>Promise<CreationResult>;
const kindOf=(command:CreationCommand):CreationKind=>command.type==='create_visual'?'visual':'audio';

/** One durable queue owns all creative worker lifetimes for an open project. */
export class CreationJobs{
 private tail=Promise.resolve();
 private active=new Map<string,Promise<CreationResult>>();
 private controllers=new Map<string,AbortController>();
 private executors=new Map<CreationKind,Executor>();
 private stopped=false;
 private lastProgress=new Map<string,number>();
 constructor(private db:ProjectDB,private publish:(type:string,payload:unknown)=>void){}
 get busy(){return this.active.size>0;}
 register(kind:CreationKind,executor:Executor){if(this.executors.has(kind))throw new Error(`The ${kind} creation backend is already registered.`);this.executors.set(kind,executor);}
 private read(requestId:string):Pending|undefined{
  const key=`creation:${requestId}`,current=this.db.loadState<Pending>(key);if(current)return current;
  // Existing projects retain their completed receipts and interrupted requests.
  const legacy=this.db.getMeta(`generation:${requestId}`)??this.db.getMeta(`visual:${requestId}`);
  if(!legacy)return;const pending=JSON.parse(legacy) as Pending;pending.command=CreationCommandSchema.parse(pending.command);this.db.saveState(key,pending);return pending;
 }
 recover(){
  const keys=this.db.db.prepare("SELECT key FROM meta WHERE key LIKE 'creation:%' OR key LIKE 'generation:%' OR key LIKE 'visual:%'").all() as {key:string}[];
  for(const id of new Set(keys.map(row=>row.key.slice(row.key.indexOf(':')+1)))){const pending=this.read(id);if(pending&&['queued','running'].includes(pending.status)){pending.status='interrupted';this.db.saveState(`creation:${id}`,pending);this.db.job(id,'creation','interrupted',0,'Resume the saved creative request.');}}
 }
 resume(requestId:string){const pending=this.read(requestId);if(!pending)throw new Error('Creative request not found.');return this.run(pending.command,pending.turnId);}
 cancel(requestId:string){this.controllers.get(requestId)?.abort();}
 async close(){this.stopped=true;for(const controller of this.controllers.values())controller.abort();await this.tail;}
 progress(command:CreationCommand,progress:number,detail?:string){const percent=Math.max(0,Math.min(100,Math.floor(progress*100)));if(this.lastProgress.get(command.requestId)===percent)return;this.lastProgress.set(command.requestId,percent);this.db.job(command.requestId,'creation','running',percent,detail);this.publish('creation.progress',{requestId:command.requestId,kind:kindOf(command),progress:percent/100,detail});}
 /** Called inside the backend's asset + timeline transaction. */
 commit(command:CreationCommand,turnId:string|undefined,result:CreationResult){this.db.saveState(`creation:${command.requestId}`,{command,turnId,status:'complete',result} satisfies Pending);}
 run(raw:CreationCommand,turnId?:string,signal?:AbortSignal):Promise<CreationResult>{
  signal?.throwIfAborted();const command=CreationCommandSchema.parse(raw),saved=this.read(command.requestId);
  if(saved){if(JSON.stringify(saved.command)!==JSON.stringify(command)||saved.turnId!==turnId)return Promise.reject(new Error('A creative request ID cannot be reused for different content or actions.'));if(saved.result)return Promise.resolve(saved.result);}
  const running=this.active.get(command.requestId);if(running)return running;
  if(this.stopped)return Promise.reject(new Error('The project is closing.'));
  const execute=this.executors.get(kindOf(command));if(!execute)return Promise.reject(new Error('This creative renderer is unavailable.'));
  const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();this.controllers.set(command.requestId,controller);
  const pending:Pending={command,turnId,status:'queued'};this.db.saveState(`creation:${command.requestId}`,pending);this.db.job(command.requestId,'creation','queued');
  const result=this.tail.then(async()=>{
   try{
    controller.signal.throwIfAborted();pending.status='running';this.db.saveState(`creation:${command.requestId}`,pending);this.progress(command,0,'Creating media');
    const result=await execute(command,turnId,controller.signal);this.commit(command,turnId,result);this.db.job(command.requestId,'creation','complete',100);this.publish('creation.completed',{requestId:command.requestId,kind:kindOf(command),result});return result;
   }catch(error){pending.status=controller.signal.aborted?'interrupted':'failed';this.db.saveState(`creation:${command.requestId}`,pending);this.db.job(command.requestId,'creation',pending.status,0,(error as Error).message);throw error;}
   finally{signal?.removeEventListener('abort',abort);this.controllers.delete(command.requestId);this.active.delete(command.requestId);this.lastProgress.delete(command.requestId);this.publish('state',this.db.state({bounded:true}));}
  });
  this.active.set(command.requestId,result);this.tail=result.then(()=>{},()=>{});this.publish('state',this.db.state({bounded:true}));return result;
 }
}
