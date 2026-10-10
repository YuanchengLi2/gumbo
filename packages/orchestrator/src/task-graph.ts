import type {WorkerReport} from './code-agent';

type GraphTask={id:string;title:string;after?:string[]};

/** Runs a validated task graph: a task starts once everything in its after list completed, at most `concurrency` at a
 * time. When a task is blocked, everything that depends on it is skipped with that reason. Reports already in `done`
 * (a resumed request) are returned without running again. A thrown error (stop, permission) ends the whole graph. */
export async function runTaskGraph<T extends GraphTask>(tasks:T[],run:(task:T)=>Promise<WorkerReport>,options:{concurrency:number;done?:Record<string,WorkerReport>;onDone?:(report:WorkerReport)=>void}):Promise<WorkerReport[]>{
 const reports=new Map<string,WorkerReport>(Object.entries(options.done??{})),running=new Map<string,Promise<void>>();
 const finish=(report:WorkerReport)=>{reports.set(report.taskId,report);options.onDone?.(report);};
 let failure:unknown;
 while(reports.size<tasks.length&&failure===undefined){
  for(const task of tasks){
   if(reports.has(task.id)||running.has(task.id))continue;
   const blocker=(task.after??[]).find(id=>reports.has(id)&&reports.get(id)!.status!=='complete');
   if(blocker)finish({taskId:task.id,title:task.title,status:'blocked',skipped:true,summary:`Skipped: it depends on ${blocker}, which did not complete.`,nextAction:`Resolve ${blocker}, then delegate ${task.id} again.`});
  }
  for(const task of tasks){
   if(running.size>=options.concurrency)break;
   if(reports.has(task.id)||running.has(task.id)||!(task.after??[]).every(id=>reports.get(id)?.status==='complete'))continue;
   running.set(task.id,run(task).then(finish,error=>{failure??=error;}).finally(()=>running.delete(task.id)));
  }
  if(!running.size)break;
  await Promise.race(running.values());
 }
 if(failure!==undefined){await Promise.allSettled(running.values());throw failure;}
 return tasks.map(task=>reports.get(task.id)??{taskId:task.id,title:task.title,status:'blocked' as const,skipped:true,summary:'Skipped: its dependencies could not run.',nextAction:'Check the task order and delegate again.'});
}

/** Blocked workers are retried once, unless the block needs the user (a decision, a permission, an account). */
export const retryable=(report:WorkerReport)=>report.status==='blocked'&&!report.skipped&&!/permission|approv|declin|decid|choose|confirm|credential|sign in|quota|account|the user/i.test(`${report.summary} ${report.nextAction??''}`);
