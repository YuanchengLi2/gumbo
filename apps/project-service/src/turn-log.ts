import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {join,basename} from 'node:path';
import type {ProjectDB} from '@dream/project-db';

/** One edit's log, for Send log: what a request did and what it cost, so a slow or expensive edit can be traced (which
 * models, how many calls, which tools, what the agent said it was doing, scene errors, the edit document it left). It
 * holds no footage: media appear as names and lengths, and folder paths are cut to the file's name. Long fields are
 * shortened so the log stays small enough to send. */
const LIMIT=4000,TOTAL=1_500_000;
const cut=(value:unknown,limit=LIMIT)=>typeof value==='string'&&value.length>limit?value.slice(0,limit)+`… [${value.length-limit} more characters]`:value;
const trim=(record:Record<string,unknown>):Record<string,unknown>=>Object.fromEntries(Object.entries(record).map(([k,v])=>[k,typeof v==='string'?cut(v):Array.isArray(v)?v.slice(0,40).map((x):unknown=>typeof x==='object'&&x?trim(x as Record<string,unknown>):cut(x)):v&&typeof v==='object'?trim(v as Record<string,unknown>):v]));
const rows=(db:ProjectDB,sql:string,...args:unknown[])=>{try{return db.db.prepare(sql).all(...args) as Record<string,unknown>[];}catch{return [];}};

export function turnLog(db:ProjectDB,turnId:string){
 const usage=rows(db,'SELECT * FROM ai_usage WHERE turn_id=? ORDER BY created_at',turnId);
 const activity=rows(db,'SELECT sequence,json FROM activity_events WHERE turn_id=? ORDER BY sequence',turnId).map(r=>{try{return trim(JSON.parse(String(r.json)));}catch{return {raw:cut(String(r.json))};}});
 const messages=rows(db,'SELECT role,text,created_at FROM messages WHERE turn_id=? ORDER BY created_at',turnId).map(trim);
 // The conversation just before, since a request like "next" or "continue" carries on from it.
 const first=String(messages[0]?.created_at??usage[0]?.created_at??new Date().toISOString());
 const before=rows(db,'SELECT role,text,created_at,turn_id FROM messages WHERE created_at<? ORDER BY created_at DESC LIMIT 6',first).reverse().map(trim);
 const sceneErrors=rows(db,'SELECT * FROM scene_errors WHERE turn_id=? ORDER BY rowid',turnId).map(trim);
 const totals=usage.reduce<Record<string,{calls:number;costUsd:number}>>((acc,u)=>{const m=String(u.model);acc[m]??={calls:0,costUsd:0};acc[m].calls++;acc[m].costUsd+=Number(u.cost_usd)||0;return acc;},{});
 const footage=db.footage().assets.map(a=>({id:a.id,file:basename(a.filename),kind:a.kind,durationSec:a.durationSec,width:a.width,height:a.height,scene:!!a.scene}));
 // The edit document and the workspace's files (names and sizes; scripts the agent wrote are small and say what it did).
 const workspace=join(db.meta.folder,'Workspace'),files:{path:string;bytes:number;text?:string}[]=[];
 const walk=(folder:string,prefix=''):void=>{if(!existsSync(folder))return;for(const name of readdirSync(folder)){if(name.startsWith('.')||name==='node_modules'||name==='output')continue;const full=join(folder,name),stat=statSync(full);
  if(stat.isDirectory()){if(prefix.split('/').length<3)walk(full,prefix+name+'/');continue;}
  const text=/\.(json|tsx?|jsx?|py|md|txt|css)$/i.test(name)&&stat.size<120_000?String(cut(readFileSync(full,'utf8'),60_000)):undefined;
  files.push({path:prefix+name,bytes:stat.size,...(text!==undefined?{text}:{})});}};
 walk(workspace);
 const log={version:1,turnId,project:{name:db.meta.name},
  totals:Object.entries(totals).map(([model,t])=>({model,...t,costUsd:Math.round(t.costUsd*10000)/10000})),
  usage,messages,before,activity,sceneErrors,footage,files,rating:db.getMeta('turn-feedback:'+turnId)||null};
 // Kept under the size the gateway takes: the biggest workspace files go first.
 let text=JSON.stringify(log);
 while(text.length>TOTAL&&files.some(f=>f.text)){const biggest=files.filter(f=>f.text).sort((a,b)=>b.text!.length-a.text!.length)[0];delete biggest.text;text=JSON.stringify(log);}
 return log;
}
