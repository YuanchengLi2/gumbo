// Live evaluation of Roux on real footage, through this repository's gateway code served on localhost: the real agent,
// workspace, import, transcription, shot index and footage overviews, against the real model APIs. It SPENDS MONEY:
// agree the budget first. Spending stops at --budget=<usd> (default 3).
// Keys come from the environment, .env.local or .secrets/<name>.env: ANTHROPIC_API_KEY (required), DEEPSEEK_API_KEY
// (Roux 1), OPENAI_API_KEY, GOOGLE_API_KEY (hearing), GROQ_API_KEY (transcription; without it footage has no transcript).
// Usage:
//   pnpm exec tsx scripts/eval-roux.ts --footage=<file>[,<file>...] --request="..." [--request="..."] [--model=auto|sonnet|haiku|deepseek-flash] [--budget=3]
//   pnpm exec tsx scripts/eval-roux.ts --suite --footage=<talking head or episode> [--budget=3]
// Each request is measured: model calls, seconds, cost, how it ended, the reply, the tools used, whether it reviewed its
// cut, and the main track (clips, length, and whether a source plays in story order). The report is saved as JSON next
// to the project in artifacts/eval-<time>/. Requests in one run share one project and one conversation, as a user's do.
import {createServer} from 'node:http';
import {readFileSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {agentModels,type ModelChoice} from '@dream/config';
import {resolve as resolveTimeline} from '@dream/timeline';
import {Agent} from '../packages/agent/src/index';
import {Workspace} from '../apps/project-service/src/workspace';
import {CodeRuntime} from '../apps/desktop/src/main/code-runtime';
import {Ingest} from '../apps/project-service/src/media';
import {CloudSpeech} from '../apps/project-service/src/speech';
import {ShotIndexer} from '../apps/project-service/src/shot-index';
import {sourceInspector} from '../apps/project-service/src/source-frames';
import {contactSheet} from '../apps/project-service/src/contact-sheet';
import {listenSystem} from '../apps/project-service/src/edit-audio';
import {handleAI} from '../supabase/functions/dream-gateway/ai';
import {handleTranscription} from '../supabase/functions/dream-gateway/transcribe';
import {requestStatus,type RequestStore,type RequestRecord} from '../supabase/functions/dream-gateway/inference-requests';

const readEnv=(path:string)=>existsSync(path)?Object.fromEntries(readFileSync(path,'utf8').split(/\r?\n/).map(line=>/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)).filter(Boolean).map(m=>[m![1],m![2].replace(/^["']|["']$/g,'')])):{};
const secret=(name:string,file:string)=>process.env[name]||readEnv('.env.local')[name]||readEnv(`.secrets/${file}.env`)[name]||undefined;
const key=secret('ANTHROPIC_API_KEY','anthropic');if(!key)throw new Error('ANTHROPIC_API_KEY is not available.');
const providerKeys=Object.fromEntries(Object.entries({deepseek:secret('DEEPSEEK_API_KEY','deepseek'),openai:secret('OPENAI_API_KEY','openai'),google:secret('GOOGLE_API_KEY','google')}).filter(([,v])=>v)) as Record<string,string>;
const groq=secret('GROQ_API_KEY','groq');
const arg=(name:string)=>process.argv.filter(a=>a.startsWith(`--${name}=`)).map(a=>a.slice(name.length+3));
const budget=Number(arg('budget')[0]??3),model=(arg('model')[0]??'auto') as ModelChoice,footage=arg('footage').flatMap(f=>f.split(',')).filter(Boolean).map(f=>resolve(f));
if(!footage.length)throw new Error('Give the footage: --footage=<file>[,<file>...]');
for(const file of footage)if(!existsSync(file))throw new Error(`No such file: ${file}`);
// The suite: everyday requests of every size, in one conversation, as one user would ask them.
const suite=['Make the captions yellow.','Cut out the pauses and add captions.','Make it 9:16 for a Short, keeping the speaker in frame.','Make a 40-second Short of the whole thing that someone who never saw it would follow.','What happens in the footage? Answer in two sentences.'];
const requests=process.argv.includes('--suite')?suite:arg('request');
if(!requests.length)throw new Error('Give a request (--request="...") or --suite.');

// The gateway, in memory: usage reservations and request records; spending past the budget stops the run.
const usage:{model:string;reserved:number;cost_usd?:number}[]=[];let agent:Agent|undefined;
const spent=()=>usage.reduce((sum,row)=>sum+Number(row.cost_usd??0),0);
const gatewayDb={rpc:async(name:string,args:any)=>name==='dream_reserve_usage'?{data:String(usage.push({model:args.p_model,reserved:args.p_reserved})-1),error:null}:{data:true,error:null},
 from:()=>({update:(value:any)=>({eq:async(_column:string,id:string)=>{Object.assign(usage[Number(id)]??{},value);if(spent()>budget){console.log(`Budget of $${budget} reached; stopping.`);agent?.cancel();}return{error:null};}})})};
const records=new Map<string,RequestRecord>();
const store:RequestStore={
 async claim(body,_user,wallMs){const existing=records.get(body.requestId);if(existing)return{owner:false,record:existing};const record={status:'running',body_hash:'',lease_until:new Date(Date.now()+wallMs).toISOString(),expires_at:new Date(Date.now()+86_400_000).toISOString()} as RequestRecord;records.set(body.requestId,record);return{owner:true,record};},
 async read(_user,id){return records.get(id)??null;},
 async finish(_user,id,status,response,error){const record=records.get(id);if(record?.status==='running')Object.assign(record,{status,response,error});},
 async cancel(user,id){await this.finish(user,id,'cancelled',undefined,'Stopped by you.');}
};
const server=createServer(async(req,res)=>{
 const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk as Buffer);const action=req.url!.split('?')[0].split('/').filter(Boolean).at(-1);
 const json=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 try{
  if(action==='transcribe'){if(!groq)return json(503,{error:'Transcription needs GROQ_API_KEY.'});const result:any=await handleTranscription(new Request('http://local'+req.url,{method:'POST',headers:{'content-type':'audio/wav'},body:Buffer.concat(chunks)}),'local',{db:gatewayDb,key:groq});return json(result.status,result.body);}
  const raw=Buffer.concat(chunks),body=raw.length?JSON.parse((req.headers['content-type']==='application/x-dream-json-gzip'?(await import('node:zlib')).gunzipSync(raw):raw).toString('utf8')):{};
  if(action==='providers')return json(200,{anthropic:true,...Object.fromEntries(Object.keys(providerKeys).map(k=>[k,true]))});
  if(action==='ai'){const result=await handleAI(body,'local',{db:gatewayDb,key,providerKeys,requests:store});if(!result.stream)return json(result.status,result.body);res.writeHead(200,{'Content-Type':'text/event-stream'});const reader=result.stream.getReader();for(;;){const {done,value}=await reader.read();if(done)break;res.write(value);}return res.end();}
  if(action==='ai-status'||action==='ai-cancel'){if(action==='ai-cancel')await store.cancel('local',body.requestId);const result=requestStatus(await store.read('local',body.requestId));return json(result.status,result.body);}
  json(404,{error:'Unknown command'});
 }catch(error){json(500,{error:(error as Error).message});}
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const connection=async()=>({url:`http://127.0.0.1:${(server.address() as {port:number}).port}`,token:'local',accountId:'local'});

// The project, wired as the app wires it (apps/project-service/src/main.ts).
const staged=resolve('apps/desktop/resources/staged'),paths={creation:join(staged,'creation'),ffmpeg:join(staged,'media-runtime/ffmpeg.exe'),ffprobe:join(staged,'media-runtime/ffprobe.exe'),browser:join(staged,'render-browser/chrome-headless-shell.exe')};
process.env.DREAM_SHARED_LIBRARIES??=join(staged,'libraries');
const out=resolve(`artifacts/eval-${new Date().toISOString().replace(/[:.]/g,'-')}`);mkdirSync(out,{recursive:true});
const db=new ProjectDB(join(out,'project'),'Roux eval'),runtime=new CodeRuntime(paths);
const publish=(type:string,payload:any)=>{
 if(type==='ai.activity'&&payload.event&&!['streaming','drafting','running'].includes(payload.event.status))console.log(`  ${payload.event.status==='failed'?'x':'-'} ${payload.event.text}${payload.event.status==='failed'?`: ${String(payload.event.detail??'').slice(0,160)}`:''}`);
 if(type==='ai.error')console.log(`  error: ${payload.message}`);
};
db.inspectSource=sourceInspector(db,paths.ffmpeg);db.contactSheet=(images,options,signal)=>contactSheet(db,paths.ffmpeg,images,options,signal);
const text=(response:any)=>(response.content??[]).filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('').trim();
const shots=new ShotIndexer(db,paths.ffmpeg,(system,content,signal)=>agent!.inference(agentModels.haiku,system,[{role:'user',content}],[],undefined,'shot_index','index',signal),(images,signal)=>contactSheet(db,paths.ffmpeg,images,{columns:4,rows:3,width:1536},signal));
const workspace=new Workspace(db,{run:runtime.run.bind(runtime),ffmpeg:paths.ffmpeg,ffprobe:paths.ffprobe,shots,
 summarize:async(system,content,signal)=>text(await agent!.inference(agentModels.haiku,system,[{role:'user',content}],[],undefined,'footage_overview','overview',signal)),
 ...(providerKeys.google?{listen:async(clip,turnId,signal)=>text(await agent!.inference(agentModels['gemini-flash'],listenSystem,[{role:'user',content:[{type:'text',text:`Audio: ${clip.what}.${clip.question?` Question: ${clip.question}`:''}`},{type:'audio',source:{type:'base64',media_type:'audio/mpeg',data:clip.audio},durationSec:clip.durationSec}]}],[],turnId,'listening','main',signal))}:{})},publish);
agent=new Agent(db,connection,publish,workspace);
const speech=new CloudSpeech(db,paths.ffmpeg,connection,publish);
const ingest=new Ingest(db,paths.ffmpeg,paths.ffprobe,publish,undefined,undefined,(asset,signal)=>speech.transcribe(asset,signal),asset=>shots.queue([asset.id]));

// Import, then wait until every source's transcript, shots and overview are in (at most 30 minutes), as a user would
// wait for the footage to be ready before asking.
console.log(`Importing ${footage.length} file(s)…`);
const started=Date.now(),assets=[];for(const file of footage)assets.push(await ingest.register(file,true,'eval:'+basename(file)));
await ingest.waitUntilUsable(assets.map(a=>a.id),new AbortController().signal);await workspace.initialize();
const ready=()=>{const index=readFileSync(join(db.folder,'Workspace','footage','INDEX.md'),'utf8');return!/being heard|not started|indexing|not indexed|described \(|waits for the analysis|being written/.test(index);};
for(;;){workspace.footage.refresh();await workspace.footage.writeOverviews();if(ready()||Date.now()-started>30*60_000)break;await new Promise(r=>setTimeout(r,5000));}
const preparation={seconds:Math.round((Date.now()-started)/1000),costUsd:+spent().toFixed(4)};
console.log(`Footage ready in ${preparation.seconds} s for $${preparation.costUsd}.`);

const report:any[]=[];
for(const [n,request] of requests.entries()){
 const turnId=`eval-${n+1}`,before=spent(),t0=Date.now();console.log(`\n${n+1}. ${request}`);
 await agent.message(request,[],'auto',[],turnId,undefined,model).catch(error=>console.log('  failed: '+(error as Error).message));
 const usageRows=db.turnUsage(turnId),session=db.loadState<any>('agent-session'),from=session?.turns?.[turnId]??0;
 const calls=(session?.messages??[]).slice(from).flatMap((m:any)=>m.role==='assistant'&&Array.isArray(m.content)?m.content.filter((b:any)=>b.type==='tool_use').map((b:any)=>b.name):[]);
 const timeline=db.timeline();let duration=0;try{duration=resolveTimeline(timeline,db.playbackFootage()).durationSec;}catch{}
 // Story order: each source's clips should play its moments in the order they happen (a cold open aside).
 const bySource=new Map<string,number[]>();for(const c of timeline.spine)(bySource.get(c.assetId)??bySource.set(c.assetId,[]).get(c.assetId)!).push(c.srcIn);
 const outOfOrder=[...bySource.values()].reduce((count,starts)=>count+starts.slice(1).filter((s,i)=>s<starts[i]).length,0);
 const reply=db.state().messages.filter(m=>m.role==='assistant'&&m.turnId===turnId).at(-1)?.text??'';
 const result={request,status:db.getMeta('ai_status'),seconds:Math.round((Date.now()-t0)/1000),costUsd:+(spent()-before).toFixed(4),modelCalls:usageRows.calls,byModel:usageRows.rows.map(r=>({owner:r.owner,model:r.model,calls:r.calls,costUsd:+(r.cost??0).toFixed(4)})),
  tools:Object.fromEntries([...new Set(calls)].map(name=>[name,calls.filter((c:string)=>c===name).length])),reviewed:calls.includes('review'),
  edit:{clips:timeline.spine.length,seconds:Math.round(duration*10)/10,size:`${timeline.settings.width}x${timeline.settings.height}`,captions:!!timeline.captions,outOfOrder},reply:reply.slice(0,600)};
 report.push(result);console.log(`  → ${result.status} in ${result.seconds} s, ${result.modelCalls} calls, $${result.costUsd}; ${result.edit.clips} clips, ${result.edit.seconds} s${result.reviewed?', reviewed':''}${outOfOrder?`, ${outOfOrder} out of order`:''}`);
 if(spent()>budget)break;
}
writeFileSync(join(out,'report.json'),JSON.stringify({model,footage:footage.map(f=>basename(f)),preparation,totalUsd:+spent().toFixed(4),requests:report},null,2));
console.log(`\nSpent $${spent().toFixed(3)} in all. Report: ${join(out,'report.json')}`);
workspace.close();shots.close();runtime.stop();db.close();server.close();process.exit(0);
