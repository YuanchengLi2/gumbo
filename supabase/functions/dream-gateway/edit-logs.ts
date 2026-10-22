/** Edit logs (see migrations/202610210002_edit_logs.sql): every request's log, sent by the app on its own when a run of
 * it ends, kept one row per request with the account, the app's version and the request's id, and beside it what beta
 * usage is studied by (how it ended, what it cost, how many calls and tools, how long it took). A log is at most 2 MB,
 * and an account can send at most EDIT_LOGS_PER_DAY in a day, so the table can't be flooded. */
export const MAX_EDIT_LOG_BYTES=2_000_000,EDIT_LOGS_PER_DAY=1000;
export type EditLogPorts={record(row:Record<string,unknown>,dailyLimit:number):Promise<'stored'|'updated'|'duplicate'|'older'|'limit'>};
const text=(value:unknown,limit:number)=>typeof value==='string'?value.slice(0,limit):null;
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:null;
const time=(value:unknown)=>typeof value==='string'&&!Number.isNaN(Date.parse(value))?new Date(value).toISOString():null;

export async function handleEditLog(body:any,user:string,ports:EditLogPorts):Promise<{status:number;body:unknown}>{
 const log=body?.log,turnId=text(body?.turnId,200),key=text(body?.key,300);
 if(!turnId||!key||!log||typeof log!=='object'||Array.isArray(log))return{status:400,body:{error:'There is no log to keep.'}};
 const size=JSON.stringify(log).length;if(size>MAX_EDIT_LOG_BYTES)return{status:413,body:{error:'This log is too large to keep.'}};
 const totals:any[]=Array.isArray(log.totals)?log.totals:[],tools:any[]=Array.isArray(log.tools)?log.tools:[];
 const request=log.request??(Array.isArray(log.messages)?log.messages.find((m:any)=>m?.role==='user')?.text:undefined);
 const result=await ports.record({user_id:user,turn_id:turnId,run_key:key,run_started_at:time(log.timing?.runStartedAt),
  app_version:text(body.appVersion,40),platform:text(body.platform,60),project:text(log.project?.name,200),request:text(request,20_000),status:text(log.outcome?.status,20),
  cost_usd:number(log.cost?.usd)??totals.reduce((n,t)=>n+(Number(t.costUsd)||0),0),credits:number(log.cost?.credits),calls:number(log.cost?.calls)??totals.reduce((n,t)=>n+(Number(t.calls)||0),0),
  tool_calls:tools.length,tool_errors:tools.filter(t=>t?.status==='failed').length,duration_ms:number(log.timing?.durationMs),models:totals.map(t=>String(t.model)).slice(0,20),
  training:body.training===true,size_bytes:size,log,started_at:time(log.timing?.startedAt)},EDIT_LOGS_PER_DAY);
 if(result==='limit')return{status:429,body:{error:'This account has sent the most logs for today.'}};
 return{status:200,body:{kept:result}};
}
export function supabaseEditLogPorts(db:any):EditLogPorts{
 return{record:async(row,dailyLimit)=>{const {data,error}=await db.rpc('dream_record_edit_log',{p_row:row,p_daily_limit:dailyLimit});if(error)throw new Error(error.message);return data;}};
}
