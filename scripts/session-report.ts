/** Per-request numbers for an editing session, read from a project's own database: time, cost, model calls, the largest
 * context sent, moves to a stronger model and compactions. Usage: tsx scripts/session-report.ts <project folder> [--compare <older folder>]
 * The live session test writes the same report after each step. Opens the database read-only, so it works on a copy or
 * on a project the app has open. */
import Database from 'better-sqlite3';
import {join} from 'node:path';

export type RequestReport={request:string;turnId:string;status:string;seconds:number;costUsd:number;calls:number;byModel:Record<string,{calls:number;costUsd:number}>;maxContextTokens:number;outputTokens:number;cacheReadShare:number;escalations:{kind:string;model:string;reason:string}[];compactions:number;budgetStops:number;routed:boolean;looks:number};
const short=(model:string)=>model.replace(/^claude-/,'').replace(/-\d.*$/,'');

export function sessionReport(folder:string):RequestReport[]{
 const db=new Database(join(folder,'.dream','project.sqlite'),{readonly:true,fileMustExist:true});
 try{
  const turns=db.prepare("SELECT turn_id AS turnId,MIN(created_at) AS started,MIN(CASE WHEN role='user' THEN text END) AS request FROM messages WHERE turn_id IS NOT NULL GROUP BY turn_id ORDER BY MIN(rowid)").all() as {turnId:string;started:string;request:string}[];
  const events=(type:string,turnId:string)=>(db.prepare("SELECT json FROM events WHERE type=? AND json_extract(json,'$.turnId')=?").all(type,turnId) as {json:string}[]).map(e=>JSON.parse(e.json));
  return turns.filter(t=>t.request).map(turn=>{
   const usage=db.prepare('SELECT model,purpose,cost_usd AS cost,input_tokens+cache_read+cache_write AS prompt,cache_read AS cached,output_tokens AS output,created_at AS at FROM ai_usage WHERE turn_id=?').all(turn.turnId) as {model:string;purpose:string|null;cost:number;prompt:number;cached:number;output:number;at:string}[];
   // Looks at footage: view_media calls the agent made in this request.
   const looks=(db.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE turn_id=? AND json_extract(json,'$.tool')='view_media'").get(turn.turnId) as {n:number}).n;
   const reply=db.prepare("SELECT MAX(created_at) AS at FROM messages WHERE turn_id=? AND role='assistant'").get(turn.turnId) as {at:string|null};
   const end=[reply.at,...usage.map(u=>u.at)].filter(Boolean).sort().at(-1)??turn.started,byModel:RequestReport['byModel']={};
   for(const u of usage){const m=byModel[short(u.model)]??={calls:0,costUsd:0};m.calls++;m.costUsd+=u.cost;}
   const prompt=usage.reduce((n,u)=>n+u.prompt,0),status=(db.prepare("SELECT json_extract(report,'$.status') AS status FROM messages WHERE turn_id=? AND role='assistant' ORDER BY rowid DESC LIMIT 1").get(turn.turnId) as {status:string|null}|undefined)?.status;
   // Older sessions predate escalation events; their Opus calls still show in byModel.
   return{request:turn.request.slice(0,120),turnId:turn.turnId,status:status??(reply.at?'answered':'unfinished'),seconds:Math.round((Date.parse(end)-Date.parse(turn.started))/1000),costUsd:usage.reduce((n,u)=>n+u.cost,0),calls:usage.length,byModel,maxContextTokens:Math.max(0,...usage.map(u=>u.prompt)),outputTokens:usage.reduce((n,u)=>n+u.output,0),cacheReadShare:prompt?usage.reduce((n,u)=>n+u.cached,0)/prompt:0,escalations:events('ai.escalation',turn.turnId).map(e=>({kind:e.kind,model:short(e.model),reason:e.reason})),compactions:events('ai.context_compacted',turn.turnId).length,budgetStops:events('ai.request_budget',turn.turnId).length,routed:usage.some(u=>u.purpose==='routing'),looks};
  });
 }finally{db.close();}
}

const money=(n:number)=>'$'+n.toFixed(3);
export function formatReport(rows:RequestReport[],older?:RequestReport[]){
 const lines=rows.map((r,i)=>{const o=older?.[i],delta=(now:number,before:number|undefined,format:(n:number)=>string)=>before===undefined?'':` (${now<=before?'':'+'}${format(now-before)})`;
  return[`${String(i+1).padStart(2)}. ${r.request.slice(0,60)}`,`    ${r.status}, ${r.seconds}s${delta(r.seconds,o?.seconds,n=>Math.round(n)+'s')}, ${money(r.costUsd)}${delta(r.costUsd,o?.costUsd,money)}, ${r.calls} calls${delta(r.calls,o?.calls,String)} [${Object.entries(r.byModel).map(([m,v])=>`${m} ${v.calls}`).join(', ')}], largest context ${Math.round(r.maxContextTokens/1000)}K${delta(r.maxContextTokens,o?.maxContextTokens,n=>Math.round(n/1000)+'K')}, ${Math.round(r.cacheReadShare*100)}% cached, ${r.looks} looks at footage${r.routed?'':', no router call'}`,...r.escalations.map(e=>`    ${e.model} (${e.kind}): ${e.reason}`),...(r.compactions?[`    ${r.compactions} compaction${r.compactions>1?'s':''}`]:[]),...(r.budgetStops?['    stopped at the request spending limit']:[])].join('\n');});
 const total=(list:RequestReport[])=>({cost:list.reduce((n,r)=>n+r.costUsd,0),seconds:list.reduce((n,r)=>n+r.seconds,0),opus:list.reduce((n,r)=>n+(r.byModel.opus?.costUsd??0),0)});
 const now=total(rows),before=older?total(older.slice(0,rows.length)):undefined;
 lines.push(`Total: ${money(now.cost)} (Opus ${money(now.opus)}), ${now.seconds}s`+(before?` — before: ${money(before.cost)} (Opus ${money(before.opus)}), ${before.seconds}s`:''));
 return lines.join('\n');
}

if(process.argv[1]?.endsWith('session-report.ts')){
 const [folder,flag,previous]=process.argv.slice(2);if(!folder)throw new Error('Usage: tsx scripts/session-report.ts <project folder> [--compare <older folder>]');
 console.log(formatReport(sessionReport(folder),flag==='--compare'&&previous?sessionReport(previous):undefined));
}
