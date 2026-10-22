import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {join,basename} from 'node:path';
import {STOPPED_WHEN_CLOSED,type ProjectDB} from '@dream/project-db';

/** One edit's log, sent on its own when a run of the request ends (the desktop's edit-logs.ts) and with Send log: what a
 * request did and what it cost, so a slow, failed or expensive edit can be traced by its calls, tools and commentary
 * (the request, every model call, each tool's input and result, timings, credits, how it ended, scene errors, the edit
 * document it left). It holds no footage: media appear as names and lengths, pictures the agent looked at are left out,
 * and folder paths are cut to the file's name. Keys and tokens are blanked. Long fields are shortened so the log stays
 * small enough to send. */
const LIMIT=4000,TOTAL=1_500_000;
const cut=(value:unknown,limit=LIMIT)=>typeof value==='string'&&value.length>limit?value.slice(0,limit)+`… [${value.length-limit} more characters]`:value;
const trim=(record:Record<string,unknown>):Record<string,unknown>=>Object.fromEntries(Object.entries(record).map(([k,v])=>[k,typeof v==='string'?cut(v):Array.isArray(v)?v.slice(0,40).map((x):unknown=>typeof x==='object'&&x?trim(x as Record<string,unknown>):cut(x)):v&&typeof v==='object'?trim(v as Record<string,unknown>):v]));
const rows=(db:ProjectDB,sql:string,...args:unknown[])=>{try{return db.db.prepare(sql).all(...args) as Record<string,unknown>[];}catch{return [];}};
const parse=(text:unknown)=>{try{return typeof text==='string'&&text?JSON.parse(text):undefined;}catch{return undefined;}};
const binary=(text:string)=>/^data:[\w/+.-]+;base64,/.test(text)||text.length>2000&&/^[A-Za-z0-9+/=\r\n]+$/.test(text.slice(0,2000));
/** A model message's blocks, short: pictures (frames of the footage) and opaque signatures are left out. */
const clean=(value:unknown,limit:number,depth=0):unknown=>{
 if(typeof value==='string')return binary(value)?'[binary data left out]':cut(value,limit);
 if(!value||typeof value!=='object'||depth>8)return value;
 if(Array.isArray(value))return value.map(v=>clean(v,limit,depth+1));
 const o=value as Record<string,any>;if(o.type==='image'||o.type==='image_url'||o.source?.type==='base64')return{type:'image',leftOut:true};
 return Object.fromEntries(Object.entries(o).filter(([k])=>k!=='signature'&&k!=='cache_control').map(([k,v])=>[k,clean(v,limit,depth+1)]));
};
/** Keys, tokens and passwords that slipped into a command, a file or an error, blanked before the log leaves. */
const SECRETS:[RegExp,string][]=[
 [/\b(sk|rk|pk)[-_](?:ant-|live_|test_|proj-)?[A-Za-z0-9_-]{16,}/g,'[redacted]'],[/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,'[redacted]'],
 [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,'[redacted]'],[/\bAIza[0-9A-Za-z_-]{30,}/g,'[redacted]'],[/\bgh[pousr]_[A-Za-z0-9]{30,}/g,'[redacted]'],[/\bxox[abposr]-[A-Za-z0-9-]{10,}/g,'[redacted]'],
 [/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,'$1[redacted]'],[/([?&](?:key|api_key|apikey|token|access_token|secret|sig|signature)=)[^&\s"'\\]+/gi,'$1[redacted]'],
 [/("(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|password|authorization)"\s*:\s*")(?:[^"\\]|\\.)*(")/gi,'$1[redacted]$2'],
 [/\b([A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*[=:]\s*(?:\\?['"])?)(?=[^\s"'\\,;]*[A-Za-z])(?=[^\s"'\\,;]*\d)[^\s"'\\,;]{8,}/g,'$1[redacted]'],
];
export const redact=(text:string)=>SECRETS.reduce((t,[pattern,to])=>t.replace(pattern,to),text);

/** How the request ended, in one word: complete, failed (the agent gave up or an error ended it), stopped (by the user),
 * interrupted (the app closed mid-request) or waiting (on a plan's approval or a file permission). */
export function finalStatus(aiStatus:string|undefined,report:any,ending:string){
 if(/^awaiting/.test(aiStatus??''))return 'waiting';if(aiStatus==='running')return 'running';
 if(ending==='Stopped.')return 'stopped';if(ending===STOPPED_WHEN_CLOSED)return 'interrupted';
 return aiStatus==='complete'&&report?.kind!=='blocker'?'complete':'failed';
}

export function turnLog(db:ProjectDB,turnId:string){
 const usage=rows(db,'SELECT * FROM ai_usage WHERE turn_id=? ORDER BY created_at',turnId);
 const activity=rows(db,'SELECT sequence,json FROM activity_events WHERE turn_id=? ORDER BY sequence',turnId).map(r=>{try{return trim(JSON.parse(String(r.json)));}catch{return {raw:cut(String(r.json))};}});
 const said=rows(db,'SELECT role,text,created_at,report FROM messages WHERE turn_id=? ORDER BY created_at,rowid',turnId);
 const messages=said.map(({report:_r,...m})=>trim(m));
 // The conversation just before, since a request like "next" or "continue" carries on from it.
 const first=String(said[0]?.created_at??usage[0]?.created_at??new Date().toISOString());
 const before=rows(db,'SELECT role,text,created_at,turn_id FROM messages WHERE created_at<? ORDER BY created_at DESC LIMIT 6',first).reverse().map(trim);
 const sceneErrors=rows(db,'SELECT * FROM scene_errors WHERE turn_id=? ORDER BY rowid',turnId).map(trim);
 const totals=usage.reduce<Record<string,{calls:number;costUsd:number}>>((acc,u)=>{const m=String(u.model);acc[m]??={calls:0,costUsd:0};acc[m].calls++;acc[m].costUsd+=Number(u.cost_usd)||0;return acc;},{});
 const footage=db.footage().assets.map(a=>({id:a.id,file:basename(a.filename),kind:a.kind,durationSec:a.durationSec,width:a.width,height:a.height,scene:!!a.scene}));
 // How it ended: the turn's own status, its last reply and the outcome the agent reported.
 const activityStatus=parse(db.getMeta('turn_activity:'+turnId))?.status as string|undefined,pending=parse(db.getMeta('pending_request'));
 const current=pending?.turnId===turnId,aiStatus=current?db.getMeta('ai_status')??activityStatus:activityStatus;
 const replies=said.filter(m=>m.role==='assistant'),last=replies.at(-1),report=parse(replies.findLast(m=>m.report)?.report),ending=String(last?.text??'');
 const outcome={status:finalStatus(aiStatus,report,ending),aiStatus:aiStatus??null,ending:cut(ending),...(report?{kind:report.kind,result:report.status,summary:cut(report.summary),...(report.nextAction?{nextAction:cut(report.nextAction)}:{})}:{})};
 // Timings: when the request was asked, when this run started and ended, and time spent waiting on models.
 const times=[...said.map(m=>m.created_at),...usage.map(u=>u.created_at),...activity.flatMap(a=>[a.startedAt,a.updatedAt])].filter((t):t is string=>typeof t==='string').sort();
 const startedAt=times[0]??null,endedAt=times.at(-1)??null,runStartedAt=current?db.getMeta('run_started_at')??null:null;
 const timing={startedAt,runStartedAt,endedAt,durationMs:startedAt&&endedAt?Date.parse(endedAt)-Date.parse(startedAt):null,modelMs:usage.reduce((n,u)=>n+(Number(u.duration_ms)||0),0)};
 const costUsd=usage.reduce((n,u)=>n+(Number(u.cost_usd)||0),0);
 const cost={usd:Math.round(costUsd*10000)/10000,credits:Math.round(costUsd*1000)/10,calls:usage.length,inputTokens:usage.reduce((n,u)=>n+(Number(u.input_tokens)||0)+(Number(u.cache_read)||0)+(Number(u.cache_write)||0),0),outputTokens:usage.reduce((n,u)=>n+(Number(u.output_tokens)||0),0)};
 // Each tool the agent used, with its input from the model's conversation and its result or error from the receipt.
 const prefix=`code-agent:${turnId}:`,keys=rows(db,'SELECT key FROM meta WHERE key>=? AND key<?',prefix,prefix+'\uffff').map(r=>String(r.key));
 const phases=keys.filter(k=>!k.includes(':call:')).map(k=>({phase:k.slice(prefix.length),checkpoint:(()=>{try{return db.loadState<any>(k);}catch{return undefined;}})()})).filter(p=>p.checkpoint);
 const receipts=rows(db,'SELECT key,value FROM meta WHERE key>=? AND key<?','workspace-receipt-summary:'+prefix,'workspace-receipt-summary:'+prefix+'\uffff').map(r=>({...parse(r.value),phase:String(r.key).slice(26+prefix.length).split(':call:')[0],callId:String(r.key).split(':call:')[1]}));
 const inputs=new Map<string,unknown>();for(const {checkpoint} of phases)for(const m of checkpoint.messages??[])for(const b of Array.isArray(m?.content)?m.content:[])if(b?.type==='tool_use')inputs.set(b.id,b.input);
 const tools=(limit:number)=>receipts.map(r=>clean({phase:r.phase,callId:r.callId,tool:r.tool,status:r.status,input:inputs.get(r.callId),...(r.error?{error:r.error}:{}),...(r.process?{process:r.process}:{}),...(r.publication?{publication:r.publication}:{})},limit));
 const conversation=(limit:number)=>phases.map(({phase,checkpoint})=>({phase,model:checkpoint.model,...(checkpoint.outcome?{outcome:clean(checkpoint.outcome,limit)}:{}),messages:clean(checkpoint.messages??[],limit)}));
 // The edit document and the workspace's files (names and sizes; scripts the agent wrote are small and say what it did).
 const workspace=join(db.meta.folder,'Workspace'),files:{path:string;bytes:number;text?:string}[]=[];
 const walk=(folder:string,prefix=''):void=>{if(!existsSync(folder))return;for(const name of readdirSync(folder)){if(name.startsWith('.')||name==='node_modules'||name==='output')continue;const full=join(folder,name),stat=statSync(full);
  if(stat.isDirectory()){if(prefix.split('/').length<3)walk(full,prefix+name+'/');continue;}
  const text=/\.(json|tsx?|jsx?|py|md|txt|css)$/i.test(name)&&stat.size<120_000&&!/^\.?env/i.test(name)?String(cut(readFileSync(full,'utf8'),60_000)):undefined;
  files.push({path:prefix+name,bytes:stat.size,...(text!==undefined?{text}:{})});}};
 walk(workspace);
 const log:Record<string,any>={version:2,turnId,project:{name:db.meta.name},request:cut(String(said.find(m=>m.role==='user')?.text??pending?.text??''),20_000),
  outcome,timing,cost,totals:Object.entries(totals).map(([model,t])=>({model,...t,costUsd:Math.round(t.costUsd*10000)/10000})),
  usage,tools:tools(LIMIT),conversation:conversation(LIMIT),messages,before,activity,sceneErrors,footage,files,rating:db.getMeta('turn-feedback:'+turnId)||null};
 // Kept under the size the gateway takes: the biggest workspace files go first, then the conversation and tool results
 // are shortened, then the middle of a long conversation goes; how the request began and ended stays.
 const size=()=>redact(JSON.stringify(log)).length;
 let excess=size()-TOTAL;for(const f of files.filter(f=>f.text).sort((a,b)=>b.text!.length-a.text!.length)){if(excess<=0)break;excess-=JSON.stringify(f.text).length+8;delete f.text;}
 for(const limit of [1000,300])if(size()>TOTAL){log.tools=tools(limit);log.conversation=conversation(limit);log.shortened=true;}
 for(const keep of [60,20,4])if(size()>TOTAL){for(const p of log.conversation as {messages:unknown[];leftOut?:number}[])if(p.messages.length>keep){p.leftOut=(p.leftOut??0)+p.messages.length-keep;p.messages=[...p.messages.slice(0,keep/2),...p.messages.slice(-keep/2)];}log.activity=activity.length>keep*5?[...activity.slice(0,keep*2),...activity.slice(-keep*3)]:activity;}
 if(size()>TOTAL){log.conversation=[];log.tools=tools(120);log.usage=usage.slice(-500);log.files=files.map(({path,bytes})=>({path,bytes}));}
 return JSON.parse(redact(JSON.stringify(log)));
}
