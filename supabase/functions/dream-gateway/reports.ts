/** Send log (see migrations/202610180001_reports.sql): a signed-in user sends one edit's log with a note; it is kept for
 * whoever looks into the edit and answered with a short reference the user can quote. A log is at most 2 MB, and a user
 * can send at most 20 a day, so the table can't be flooded. */
export const MAX_REPORT_BYTES=2_000_000,REPORTS_PER_DAY=20;
const ALPHABET='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const reference=(random:(n:number)=>Uint8Array=n=>crypto.getRandomValues(new Uint8Array(n)))=>'GL-'+[...random(6)].map(b=>ALPHABET[b%ALPHABET.length]).join('');
export type ReportPorts={sentToday(user:string):Promise<number>;insert(row:Record<string,unknown>):Promise<void>};

export async function handleReport(body:any,user:string,ports:ReportPorts):Promise<{status:number;body:unknown}>{
 const log=body?.log,turnId=typeof body?.turnId==='string'?body.turnId.slice(0,200):'';
 if(!turnId||!log||typeof log!=='object')return{status:400,body:{error:'There is no log to send.'}};
 const text=JSON.stringify(log);if(text.length>MAX_REPORT_BYTES)return{status:413,body:{error:'This log is too large to send.'}};
 if(await ports.sentToday(user)>=REPORTS_PER_DAY)return{status:429,body:{error:'You have sent the most logs for today. Try again tomorrow.'}};
 const totals:any[]=Array.isArray(log.totals)?log.totals:[];
 const ref=reference();
 await ports.insert({reference:ref,user_id:user,turn_id:turnId,project:String(log.project?.name??'').slice(0,200),note:String(body.note??'').slice(0,2000),
  app_version:String(body.appVersion??'').slice(0,40),platform:String(body.platform??'').slice(0,60),
  cost_usd:totals.reduce((n,t)=>n+(Number(t.costUsd)||0),0),calls:totals.reduce((n,t)=>n+(Number(t.calls)||0),0),size_bytes:text.length,log});
 return{status:200,body:{reference:ref}};
}
export function supabaseReportPorts(db:any):ReportPorts{
 return{
  sentToday:async user=>{const {count,error}=await db.from('dream_reports').select('id',{count:'exact',head:true}).eq('user_id',user).gte('created_at',new Date(Date.now()-86_400_000).toISOString());if(error)throw new Error(error.message);return count??0;},
  insert:async row=>{const {error}=await db.from('dream_reports').insert(row);if(error)throw new Error(error.message);}
 };
}
