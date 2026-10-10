import {mkdtempSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {tmpdir,cpus,totalmem} from 'node:os';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {ClipSchema} from '@dream/timeline';
import {ProjectContext} from '../packages/orchestrator/src/context';
import cases from '../tests/fixtures/engine-retrieval-cases.json';

export function benchmarkEngine(large=true){
 const folder=mkdtempSync(join(tmpdir(),'dream-engine-benchmark-')),items=large?10000:200,assets=large?1000:20,turns=large?500:20;
 let db=new ProjectDB(folder,'Engine benchmark');const started=performance.now();
 try{
  db.db.transaction(()=>{for(let n=0;n<assets;n++)db.saveAsset(AssetSchema.parse({id:'asset-'+n,filename:'Source '+n,originalPath:join(folder,'source-'+n+'.mp4'),fingerprint:'fixture-'+n,kind:'video',durationSec:7200,status:'ready'}));})();
  const sourceWords=Array.from({length:large?20000:400},(_,n)=>({id:'word-'+n,assetId:'asset-'+n%assets,text:n%7?'spoken':'Amethyst',start:Math.floor(n/assets),end:Math.floor(n/assets)+.2,confidence:1,speaker:'unknown',pauseBefore:0}));db.saveRecords('words',sourceWords);
  const timeline=db.timeline();timeline.spine=Array.from({length:items},(_,n)=>ClipSchema.parse({id:'clip-'+n,assetId:'asset-'+n%assets,srcIn:0,srcOut:7200/items,reason:n===0?'cobalt opening introduction':n===items-1?'Amethyst closing ceremony':n===Math.floor(items/2)?'amber workshop demonstration':'Recorded project sequence'}));
  const version=db.writeVersion(timeline,db.head(),'Large fixture',null);db.db.prepare("UPDATE branches SET head_id=? WHERE id='main'").run(version);
  db.db.prepare('INSERT INTO messages(id,role,text,created_at,turn_id,report) VALUES(?,?,?,?,?,?)').run('direction','user','Preserve violet titles, never orange.','2026-10-06T00:00:00Z','initial',null);
  db.db.prepare('INSERT INTO messages(id,role,text,created_at,turn_id,report) VALUES(?,?,?,?,?,?)').run('voice','user','Keep the original voice narration.','2026-10-06T00:00:01Z','initial',null);
  const checkpointMs:number[]=[],state={turnId:'long',messages:[{role:'user',content:'Preserve the original voice and violet titles.'}] as any[],processed:0};
  for(let n=0;n<turns;n++){db.message('user','Refine sequence '+n,'turn-'+n);state.messages.push({role:'assistant',content:[{type:'tool_use',id:'read-'+n,name:'get_project',input:{section:'overview'}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'read-'+n,content:JSON.stringify({versionId:version,completed:n})}]});state.processed=n;const t=performance.now();db.saveState('benchmark-checkpoint',state);checkpointMs.push(performance.now()-t);}
  const context=new ProjectContext(db),indexStart=performance.now();context.search('Amethyst');const initialIndexMs=performance.now()-indexStart;
  const queries=large?cases:cases.filter(c=>!['clip-9999','clip-5000','asset-999'].includes(c.owner));const results=queries.map(c=>({...c,found:context.search(c.query,12).some(hit=>hit.owner===c.owner)}));
  const retrievalMs:number[]=[];for(let n=0;n<50;n++){const t=performance.now();context.search(queries[n%queries.length].query,12);retrievalMs.push(performance.now()-t);}
  const mutationStart=performance.now();db.apply([{type:'set_project_settings',settings:{fps:25},reason:'Scale validation'}],'Format','scale-change',db.head());const mutationMs=performance.now()-mutationStart;
  const p95=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*.95)-1)];
  const rows=(sql:string)=>db.db.prepare(sql).get();const storage={blobs:rows('SELECT COUNT(*) AS count,SUM(length(bytes)) AS compressedBytes,SUM(raw_size) AS rawBytes FROM content_blobs'),journal:rows('SELECT COUNT(*) AS count FROM execution_journal'),checkpointReferenceBytes:(db.db.prepare("SELECT length(value) AS n FROM meta WHERE key='benchmark-checkpoint'").get() as any).n};
  const closeAt=performance.now();db.close();db=new ProjectDB(folder);const reopenMs=performance.now()-closeAt;const report={passed:results.every(r=>r.found)&&p95(retrievalMs)<=250&&p95(checkpointMs)<=100,fixture:{items,assets,turns,sourceWords:sourceWords.length,timelineSeconds:7200,provider:'deterministic local fixture; no model-quality claim'},machine:{platform:process.platform,node:process.version,cpu:cpus()[0]?.model,memoryGiB:totalmem()/1024**3},initialIndexMs,reopenMs,mutationMs,retrievalP95Ms:p95(retrievalMs),checkpointP95Ms:p95(checkpointMs),recall:results.filter(r=>r.found).length/results.length,cases:results,storage,databaseBytes:statSync(join(folder,'.dream/project.sqlite')).size,elapsedMs:performance.now()-started};return report;
 }finally{db.close();}
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/benchmark-engine.ts')){const report=benchmarkEngine(!process.argv.includes('--small'));mkdirSync(resolve('artifacts'),{recursive:true});writeFileSync(resolve('artifacts/engine-benchmark.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;}
