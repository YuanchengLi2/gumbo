// Live evaluation of Roux on real footage: the real agent, workspace, import, transcription, shot index and footage
// overviews, against the real models. It SPENDS MONEY: agree the budget first. Spending stops at --budget=<usd> (default 2).
// By default it goes through the deployed gateway, which holds the model keys, so Auto is Roux 1 as users get it. It signs
// in as a temporary test account, given the budget in credits and exempt from the daily limits, and deletes it afterwards.
// That needs the Supabase CLI logged in, and DREAM_DB_PASSWORD in .env.local with the pooler address `supabase link`
// saved (as scripts/gift-credits.ts does).
// --local serves this repository's gateway code on localhost instead, with keys from the environment, .env.local or
// .secrets/<name>.env: ANTHROPIC_API_KEY (required), DEEPSEEK_API_KEY (Roux 1), OPENAI_API_KEY, GOOGLE_API_KEY (hearing),
// GROQ_API_KEY (transcription; without it footage has no transcript).
// Usage:
//   pnpm exec tsx scripts/eval-roux.ts --footage=<file>[,<file>...] --request="..." [--request="..."] [--model=auto|sonnet|haiku|deepseek-flash] [--budget=2] [--local]
//   pnpm exec tsx scripts/eval-roux.ts --suite --footage=<talking head or episode> [--budget=2]
// Each request is measured: model calls, seconds, cost, how it ended, the reply, the tools used, whether it reviewed its
// cut, and the main track (clips, length, and whether a source plays in story order). The report is saved as JSON next
// to the project in artifacts/eval-<time>/. Requests in one run share one project and one conversation, as a user's do.
import {createServer} from 'node:http';
import {execSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
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
import {SoundIndexer} from '../apps/project-service/src/sound-index';
import {soundAnalyser} from '../apps/project-service/src/sound-runtime';
import {sourceInspector} from '../apps/project-service/src/source-frames';
import {contactSheet} from '../apps/project-service/src/contact-sheet';
import {listenSystem} from '../apps/project-service/src/edit-audio';
import {handleAI} from '../supabase/functions/dream-gateway/ai';
import {handleTranscription} from '../supabase/functions/dream-gateway/transcribe';
import {requestStatus,type RequestStore,type RequestRecord} from '../supabase/functions/dream-gateway/inference-requests';

const readEnv=(path:string)=>existsSync(path)?Object.fromEntries(readFileSync(path,'utf8').split(/\r?\n/).map(line=>/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)).filter(Boolean).map(m=>[m![1],m![2].replace(/^["']|["']$/g,'')])):{};
const secret=(name:string,file:string)=>process.env[name]||readEnv('.env.local')[name]||readEnv(`.secrets/${file}.env`)[name]||undefined;
const arg=(name:string)=>process.argv.filter(a=>a.startsWith(`--${name}=`)).map(a=>a.slice(name.length+3));
const local=process.argv.includes('--local'),budget=Number(arg('budget')[0]??2),model=(arg('model')[0]??'auto') as ModelChoice,footage=arg('footage').flatMap(f=>f.split(',')).filter(Boolean).map(f=>resolve(f));
if(!footage.length)throw new Error('Give the footage: --footage=<file>[,<file>...]');
for(const file of footage)if(!existsSync(file))throw new Error(`No such file: ${file}`);
// The suite: everyday requests of every size, in one conversation, as one user would ask them.
const suite=['Cut out the pauses and add captions.','Make the captions yellow.','Make it 9:16 for a Short, keeping the speaker in frame.','What is this about? Answer in two sentences.','Make a 40-second Short of the best part that someone who never saw it would follow.'];
const requests=process.argv.includes('--suite')?suite:arg('request');
if(!requests.length)throw new Error('Give a request (--request="...") or --suite.');

type Gateway={connection:()=>Promise<{url:string;token:string;accountId:string}>;providers:Record<string,boolean>;close:()=>Promise<void>};

// This repository's gateway code, served on localhost with in-memory usage and request records.
async function localGateway():Promise<Gateway>{
 const key=secret('ANTHROPIC_API_KEY','anthropic');if(!key)throw new Error('ANTHROPIC_API_KEY is not available.');
 const providerKeys=Object.fromEntries(Object.entries({deepseek:secret('DEEPSEEK_API_KEY','deepseek'),openai:secret('OPENAI_API_KEY','openai'),google:secret('GOOGLE_API_KEY','google')}).filter(([,v])=>v)) as Record<string,string>;
 const groq=secret('GROQ_API_KEY','groq');let reservations=0;
 const gatewayDb={rpc:async(name:string)=>({data:name==='dream_reserve_usage'?String(++reservations):true,error:null}),from:()=>({update:()=>({eq:async()=>({error:null})})})};
 const records=new Map<string,RequestRecord>();
 const store:RequestStore={
  async claim(body,_user,wallMs){const existing=records.get(body.requestId);if(existing)return{owner:false,record:existing};const record={status:'running',body_hash:'',lease_until:new Date(Date.now()+wallMs).toISOString(),expires_at:new Date(Date.now()+86_400_000).toISOString()} as RequestRecord;records.set(body.requestId,record);return{owner:true,record};},
  async read(_user,id){return records.get(id)??null;},
  async finish(_user,id,status,response,error){const record=records.get(id);if(record?.status==='running')Object.assign(record,{status,response,error});},
  async cancel(user,id){await this.finish(user,id,'cancelled',undefined,'Stopped by you.');}
 };
 const providers={anthropic:true,groq:!!groq,...Object.fromEntries(Object.keys(providerKeys).map(k=>[k,true]))};
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk as Buffer);const action=req.url!.split('?')[0].split('/').filter(Boolean).at(-1);
  const json=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  try{
   if(action==='transcribe'){if(!groq)return json(503,{error:'Transcription needs GROQ_API_KEY.'});const result:any=await handleTranscription(new Request('http://local'+req.url,{method:'POST',headers:{'content-type':'audio/wav'},body:Buffer.concat(chunks)}),'local',{db:gatewayDb,key:groq});return json(result.status,result.body);}
   const raw=Buffer.concat(chunks),body=raw.length?JSON.parse((req.headers['content-type']==='application/x-dream-json-gzip'?(await import('node:zlib')).gunzipSync(raw):raw).toString('utf8')):{};
   if(action==='providers')return json(200,providers);
   if(action==='ai'){const result=await handleAI(body,'local',{db:gatewayDb,key,providerKeys,requests:store});if(!result.stream)return json(result.status,result.body);res.writeHead(200,{'Content-Type':'text/event-stream'});const reader=result.stream.getReader();for(;;){const {done,value}=await reader.read();if(done)break;res.write(value);}return res.end();}
   if(action==='ai-status'||action==='ai-cancel'){if(action==='ai-cancel')await store.cancel('local',body.requestId);const result=requestStatus(await store.read('local',body.requestId));return json(result.status,result.body);}
   json(404,{error:'Unknown command'});
  }catch(error){json(500,{error:(error as Error).message});}
 });
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 return{connection:async()=>({url:`http://127.0.0.1:${(server.address() as {port:number}).port}`,token:'local',accountId:'local'}),providers,close:async()=>{server.close();}};
}

// The deployed gateway, as a temporary test account with the budget in credits. The account is exempt from the daily
// limits (an administrator), so the budget alone caps it, and is deleted when the run ends.
async function cloudGateway():Promise<Gateway>{
 const ref=readFileSync('supabase/.temp/project-ref','utf8').trim(),base=`https://${ref}.supabase.co`,gateway=`${base}/functions/v1/dream-gateway`;
 const keys=JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${ref} --output json`,{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 const service=keys.find((k:any)=>k.name==='service_role')?.api_key;if(!service)throw new Error('Could not read the project keys; is the Supabase CLI logged in?');
 const api=async(path:string,body?:unknown,token=service,method=body?'POST':'GET')=>{const response=await fetch(base+path,{method,headers:{apikey:service,Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const text=await response.text();if(!response.ok)throw new Error(`${path.split('?')[0]} failed (${response.status}): ${text.slice(0,200)}`);return text?JSON.parse(text):null;};
 const env=readEnv('.env.local'),pooler=new URL(readFileSync('supabase/.temp/pooler-url','utf8').trim());pooler.password=encodeURIComponent(env.DREAM_DB_PASSWORD??'');
 const sql=postgres(pooler.toString(),{ssl:'require',max:1,idle_timeout:5,connect_timeout:15,connection:{application_name:'gumbo-roux-eval'}});
 // Gumbo's spending today, so the run never takes the day's capacity from real users.
 const [{spent:today,limit}]=await sql`select coalesce((select sum(cost_usd) from public.dream_usage where created_at>=date_trunc('day',now() at time zone 'utc') at time zone 'utc'),0)::float as spent,(select global_daily_usd from public.dream_limits where id)::float as limit`;
 if(today+budget>limit*.8){await sql.end();throw new Error(`Gumbo has spent $${today.toFixed(2)} of its $${limit} daily limit today; a $${budget} run would leave too little for users.`);}
 // A run that was stopped leaves its test account behind; it goes now.
 for(const {id} of await sql`select id from auth.users where email like 'roux-eval-%@example.invalid'`)await api(`/auth/v1/admin/users/${id}`,undefined,service,'DELETE');
 const email=`roux-eval-${randomUUID()}@example.invalid`,password=randomUUID()+randomUUID(),user=await api('/auth/v1/admin/users',{email,password,email_confirm:true});
 let session:any,signedAt=0;const signIn=async()=>{session=await api('/auth/v1/token?grant_type=password',{email,password});signedAt=Date.now();};
 const remove=async()=>{await sql.end().catch(()=>{});await api(`/auth/v1/admin/users/${user.id}`,undefined,service,'DELETE').catch(error=>console.log(`Could not delete the test account ${email}: ${(error as Error).message}`));};
 try{
  await signIn();
  // The first call to the gateway makes the account; then it gets the credits and the exemption.
  const providers=await (await fetch(`${gateway}/account`,{headers:{Authorization:'Bearer '+session.access_token}})).json().then(()=>fetch(`${gateway}/providers`,{headers:{Authorization:'Bearer '+session.access_token}})).then(r=>r.json());
  await sql`update public.dream_accounts set is_admin=true where id=${user.id}`;
  await sql`select public.dream_grant_credits(${user.id},'gift',null,${Math.ceil(budget*100)},${'eval:'+email},now(),null)`;
  console.log(`Signed in to the deployed gateway as a test account with $${budget} of credits (Gumbo has spent $${today.toFixed(2)} of $${limit} today).`);
  return{connection:async()=>{if(Date.now()-signedAt>40*60_000)await signIn();return{url:gateway,token:session.access_token,accountId:user.id};},providers,close:remove};
 }catch(error){await remove();throw error;}
}

const service=local?await localGateway():await cloudGateway(),connection=service.connection;let agent:Agent|undefined;
console.log(`Models available: ${Object.entries(service.providers).filter(([,on])=>on).map(([id])=>id).join(', ')}.`);
// Whatever happens, the test account goes.
try{

// The project, wired as the app wires it (apps/project-service/src/main.ts).
const staged=resolve('apps/desktop/resources/staged'),paths={creation:join(staged,'creation'),ffmpeg:join(staged,'media-runtime/ffmpeg.exe'),ffprobe:join(staged,'media-runtime/ffprobe.exe'),browser:join(staged,'render-browser/chrome-headless-shell.exe')};
process.env.DREAM_SHARED_LIBRARIES??=join(staged,'libraries');
const out=resolve(`artifacts/eval-${new Date().toISOString().replace(/[:.]/g,'-')}`);mkdirSync(out,{recursive:true});
const db=new ProjectDB(join(out,'project'),'Roux eval'),runtime=new CodeRuntime(paths);
const spent=()=>Number((db.db.prepare('SELECT SUM(cost_usd) AS cost FROM ai_usage').get() as {cost:number|null}).cost??0);
const publish=(type:string,payload:any)=>{
 if(type==='ai.usage'&&spent()>budget){console.log(`Budget of $${budget} reached; stopping.`);agent?.cancel();}
 if(type==='ai.activity'&&payload.event&&!['streaming','drafting','ready','running'].includes(payload.event.status))console.log(`  ${payload.event.status==='failed'?'x':'-'} ${payload.event.text}${payload.event.status==='failed'?`: ${String(payload.event.detail??'').slice(0,160)}`:''}`);
 if(type==='ai.error')console.log(`  error: ${payload.message}`);
};
db.inspectSource=sourceInspector(db,paths.ffmpeg);db.contactSheet=(images,options,signal)=>contactSheet(db,paths.ffmpeg,images,options,signal);
const text=(response:any)=>(response.content??[]).filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('').trim();
const shots=new ShotIndexer(db,paths.ffmpeg,(system,content,signal)=>agent!.inference(agentModels.haiku,system,[{role:'user',content}],[],undefined,'shot_index','index',signal),(images,signal)=>contactSheet(db,paths.ffmpeg,images,{columns:3,rows:4,width:1536},signal));
// The sound analysis's models live in artifacts/models (downloaded there once, as the desktop does into its data folder).
const sounds=new SoundIndexer(db,paths.ffmpeg,soundAnalyser(resolve('artifacts/models')));
const workspace=new Workspace(db,{run:runtime.run.bind(runtime),ffmpeg:paths.ffmpeg,ffprobe:paths.ffprobe,shots,sounds,
 summarize:async(system,content,signal)=>text(await agent!.inference(agentModels.haiku,system,[{role:'user',content}],[],undefined,'footage_overview','overview',signal)),
 ...(service.providers.google?{listen:async(clip,turnId,signal)=>text(await agent!.inference(agentModels['gemini-flash'],listenSystem,[{role:'user',content:[{type:'text',text:`Audio: ${clip.what}.${clip.question?` Question: ${clip.question}`:''}`},{type:'audio',source:{type:'base64',media_type:'audio/mpeg',data:clip.audio},durationSec:clip.durationSec}]}],[],turnId,'listening','main',signal))}:{})},publish);
agent=new Agent(db,connection,publish,workspace);
const speech=new CloudSpeech(db,paths.ffmpeg,connection,publish);
const ingest=new Ingest(db,paths.ffmpeg,paths.ffprobe,publish,undefined,undefined,(asset,signal)=>speech.transcribe(asset,signal),asset=>{shots.queue([asset.id]);sounds.queue([asset.id]);});

// Import, then wait until every source's transcript, shots and overview are in (at most 30 minutes), as a user would
// wait for the footage to be ready before asking.
console.log(`Importing ${footage.length} file(s)…`);
const started=Date.now(),assets=[];for(const file of footage)assets.push(await ingest.register(file,true,'eval:'+basename(file)));
await ingest.waitUntilUsable(assets.map(a=>a.id),new AbortController().signal);await workspace.initialize();
const ready=()=>{const index=readFileSync(join(db.folder,'Workspace','footage','INDEX.md'),'utf8');return!/being heard|not started|indexing|not indexed|described \(|waits for the analysis|being written|being analysed|sound: waiting/.test(index);};
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
workspace.close();shots.close();sounds.close();runtime.stop();db.close();
}finally{await service.close();}
process.exit(0);
