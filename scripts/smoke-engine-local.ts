// Live check of the agent engine against the real Anthropic API, through this repository's gateway code served on
// localhost. No Supabase project, account or deployment is involved. Requires ANTHROPIC_API_KEY (environment,
// .env.local or .secrets/anthropic.env). Spending stops at --budget=<usd> (default 3).
// Usage: pnpm exec tsx scripts/smoke-engine-local.ts [--simple-only|--long|--suite] [--budget=3]
// --long runs a multi-scene build that is interrupted partway and resumed. Afterwards (outside the agent run) the script renders
// review frames of the result for inspection; the agent itself never renders.
import {createServer} from 'node:http';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {Director} from '@dream/orchestrator';
import {resolve as resolveTimeline} from '@dream/timeline';
import {CodeWorkspace} from '../apps/project-service/src/code-workspace';
import {CodeRuntime} from '../apps/desktop/src/main/code-runtime';
import {renderReview} from '../apps/desktop/src/main/review-rendering';
import {handleAI} from '../supabase/functions/dream-gateway/ai';
import {countTokens} from '../supabase/functions/dream-gateway/token-count';
import {requestStatus,type RequestStore,type RequestRecord} from '../supabase/functions/dream-gateway/inference-requests';

const readEnv=(path:string)=>existsSync(path)?Object.fromEntries(readFileSync(path,'utf8').split(/\r?\n/).map(line=>/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)).filter(Boolean).map(m=>[m![1],m![2].replace(/^["']|["']$/g,'')])):{};
const key=process.env.ANTHROPIC_API_KEY??readEnv('.env.local').ANTHROPIC_API_KEY??readEnv('.secrets/anthropic.env').ANTHROPIC_API_KEY;
if(!key)throw new Error('ANTHROPIC_API_KEY is not available.');
const budget=Number(process.argv.find(a=>a.startsWith('--budget='))?.slice(9)??3);

// Gateway storage, in memory: usage reservations and request records.
const usage:{model:string;reserved:number;cost_usd?:number;status?:string;input_tokens?:number;output_tokens?:number;cache_read_tokens?:number;cache_write_tokens?:number}[]=[];
let director:Director|undefined;const spent=()=>usage.reduce((sum,row)=>sum+Number(row.cost_usd??0),0);
const db={rpc:async(name:string,args:any)=>name==='dream_reserve_usage'?{data:String(usage.push({model:args.p_model,reserved:args.p_reserved})-1),error:null}:{data:true,error:null},
 from:()=>({update:(value:any)=>({eq:async(_column:string,id:string)=>{Object.assign(usage[Number(id)]??{},value);if(spent()>budget){console.log(`Budget of $${budget} reached; stopping.`);director?.cancel();}return{error:null};}})})};
const records=new Map<string,RequestRecord>();
const requests:RequestStore={
 async claim(body,_user,wallMs){const existing=records.get(body.requestId);if(existing)return{owner:false,record:existing};const record={status:'running',body_hash:'',lease_until:new Date(Date.now()+wallMs).toISOString(),expires_at:new Date(Date.now()+86_400_000).toISOString()} as RequestRecord;records.set(body.requestId,record);return{owner:true,record};},
 async read(_user,id){return records.get(id)??null;},
 async finish(_user,id,status,response,error){const record=records.get(id);if(record?.status==='running')Object.assign(record,{status,response,error});},
 async cancel(user,id){await this.finish(user,id,'cancelled',undefined,'Stopped by you.');}
};
const server=createServer(async(req,res)=>{
 const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk as Buffer);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{},action=req.url!.split('/').filter(Boolean).at(-1);
 const json=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 try{
  if(action==='ai'){const result=await handleAI(body,'local',{db,key,requests});if(!result.stream)return json(result.status,result.body);res.writeHead(200,{'Content-Type':'text/event-stream'});const reader=result.stream.getReader();for(;;){const {done,value}=await reader.read();if(done)break;res.write(value);}return res.end();}
  if(action==='ai-status'||action==='ai-cancel'){if(action==='ai-cancel')await requests.cancel('local',body.requestId);const result=requestStatus(await requests.read('local',body.requestId));return json(result.status,result.body);}
  if(action==='count-tokens'){const result=await countTokens(body,'local',db,key);return json(result.status,result.body);}
  json(404,{error:'Unknown command'});
 }catch(error){json(500,{error:(error as Error).message});}
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const port=(server.address() as {port:number}).port;

const staged=resolve('apps/desktop/resources/staged'),paths={creation:join(staged,'creation'),ffmpeg:join(staged,'media-runtime/ffmpeg.exe'),ffprobe:join(staged,'media-runtime/ffprobe.exe'),browser:join(staged,'render-browser/chrome-headless-shell.exe')};
process.env.DREAM_SHARED_LIBRARIES??=join(staged,'libraries');
const runtime=new CodeRuntime(paths),folder=resolve('artifacts/engine-local-'+Date.now()),project=new ProjectDB(folder,'Engine live check');
const log:{type:string;text:string}[]=[];let onActivity:((event:any)=>void)|undefined;
const publish=(type:string,payload:any)=>{
 if(type==='ai.activity'&&payload.event)onActivity?.(payload.event);
 if(type==='ai.activity'&&payload.event&&payload.event.status!=='streaming'&&payload.event.status!=='drafting'){const text=`${payload.event.kind}/${payload.event.status}: ${payload.event.text}`;if(log.at(-1)?.text!==text){log.push({type,text});console.log('  '+text);}}
 if(type==='ai.error'){log.push({type,text:payload.message});console.log('  error: '+payload.message);}
};
const workspace=new CodeWorkspace(project,{run:runtime.run.bind(runtime),ffmpeg:paths.ffmpeg,ffprobe:paths.ffprobe},publish);
director=new Director(project,async()=>({url:`http://127.0.0.1:${port}`,token:'local',accountId:'local'}),publish,undefined,undefined,undefined,undefined,workspace);

const inferences=(turn:string)=>(project.db.prepare("SELECT json FROM events WHERE type='ai.usage'").all() as {json:string}[]).map(row=>JSON.parse(row.json)).filter(e=>e.turnId===turn).map(e=>({model:e.model,stop:e.stopReason,input:e.usage?.input_tokens,cacheRead:e.usage?.cache_read_input_tokens,cacheWrite:e.usage?.cache_creation_input_tokens,output:e.usage?.output_tokens}));
const sceneClips=()=>project.timeline().spine.filter(c=>project.footage().assets.find(a=>a.id===c.assetId)?.scene).length;
// Renders evenly spaced frames of the saved version through the same composition Export uses.
async function frames(prefix:string){
 const timeline=project.timeline(),footage=project.footage(),total=resolveTimeline(timeline,footage).durationInFrames,count=Math.min(8,total);if(!count)return[];
 const picks=Array.from({length:count},(_,i)=>Math.min(total-1,Math.round((i+.5)*total/count)));
 const images=await renderReview({versionId:project.head(),timeline,footage,frames:picks.map(frame=>({frame,labels:[]}))},{renderBundle:join(staged,'remotion'),browser:paths.browser,binariesDirectory:join(staged,'compositor'),cacheDirectory:join(folder,'.dream/review-cache')},new AbortController().signal);
 return images.frames.map(image=>{const file=join(folder,`${prefix}-frame-${String(image.frame).padStart(5,'0')}.jpg`);writeFileSync(file,Buffer.from(image.data,'base64'));return file;});
}
async function scenario(name:string,request:string,check:(versionsBefore:number)=>string|undefined,options:{interrupt?:boolean;render?:string;plan?:boolean}={}){
 console.log(`\n${name}: ${request}`);const started=Date.now(),before=usage.length,versionsBefore=project.state().versions.length;let interrupted=false;
 // Interrupt shortly after the first file a worker writes, then resume the same request.
 if(options.interrupt)onActivity=event=>{if(!interrupted&&event.tool==='write_file'&&event.status==='complete'){interrupted=true;console.log('  >> interrupting the run');setTimeout(()=>director!.cancel(),1500);}};
 await director!.message(request,[],options.plan?'plan':'auto');onActivity=undefined;
 // A planned request waits for approval; approve the proposed plan as the user would, then let it execute.
 if(options.plan){const proposal=project.loadState<any>('task_plan');console.log(`  >> plan proposed (${project.getMeta('ai_status')}): ${proposal?.plan?.steps?.length??0} steps; approving`);if(proposal)await director!.approveTaskPlan(proposal.plan,proposal.versionId,'approve-'+Date.now(),proposal.revision);}
 let paused:string|undefined;
 if(interrupted){paused=project.getMeta('ai_status');console.log(`  >> status after interruption: ${paused}; resuming`);if(paused==='interrupted')await director!.resume();}
 const turn=JSON.parse(project.getMeta('pending_request')!).turnId,route=project.loadState<any>('routing:'+turn),status=project.getMeta('ai_status');
 const problem=interrupted&&paused!=='interrupted'?`interruption left status ${paused}`:status!=='complete'?`status ${status}`:check(versionsBefore);
 const rendered=!problem&&options.render?await frames(options.render).catch(error=>[`render failed: ${(error as Error).message}`]):[];
 const result={name,request,status,problem,interrupted,route:route&&{intelligence:route.intelligence,complexity:route.complexity},seconds:Math.round((Date.now()-started)/1000),costUsd:+usage.slice(before).reduce((s,r)=>s+Number(r.cost_usd??0),0).toFixed(4),inferences:inferences(turn),versions:project.state().versions.length,timeline:project.timeline().spine.map(c=>({id:c.id,assetId:c.assetId,seconds:+(c.srcOut-c.srcIn).toFixed(2)})),frames:rendered,summary:project.state().messages.filter(m=>m.role==='assistant').at(-1)?.report};
 console.log(`  -> ${problem?'FAILED: '+problem:'passed'} in ${result.seconds}s, $${result.costUsd}, ${result.inferences.length} inferences${interrupted?', resumed after interruption':''}${rendered.length?`, ${rendered.length} frames rendered`:''}`);return result;
}
const results=[];
try{
 if(process.argv.includes('--long'))results.push(await scenario('Long build (parallel Haiku workers, interrupted and resumed)',"Make a 15-second promo for a coffee brand called 'Morning Ritual': a 3-second intro title, then three 3-second feature cards ('Single origin', 'Roasted weekly', 'Delivered fresh'), each with its own animated illustration built from simple shapes, then a 3-second outro with the brand name. Use one consistent warm palette and put all five on the timeline in order.",()=>sceneClips()>=5?undefined:`timeline has ${sceneClips()} scene clips`,{interrupt:true,render:'long'}));
 else{
  results.push(await scenario('Simple edit (Haiku alone)','Change the project frame rate to 24 fps.',()=>project.timeline().settings.fps===24?undefined:'frame rate is '+project.timeline().settings.fps));
  if(!process.argv.includes('--simple-only'))results.push(await scenario('Creative build (Opus leads Haiku workers)',"Create a 4-second animated title card that says 'Dream Engine' over a slowly moving gradient, followed by a 3-second outro card that says 'Thanks for watching'. Put both on the timeline in that order.",()=>sceneClips()>=2?undefined:`timeline has ${sceneClips()} scene clips`,{render:'creative'}));
  // --suite chains the requests a real session sends: revise the build, ask about it, then plan and approve an addition.
  if(process.argv.includes('--suite')&&!results.some(r=>r.problem)){
   results.push(await scenario('Follow-up revision',"Make the 'Dream Engine' title text larger and change its gradient to sunset orange and pink.",before=>project.state().versions.length>before?undefined:'no new version was published',{render:'revision'}));
   results.push(await scenario('Question (read-only)','What is on the timeline right now, and how long is it in total?',before=>project.state().versions.length!==before?'a question changed the project':String((project.state().messages.filter(m=>m.role==='assistant').at(-1)?.report as any)?.summary??'').trim()?undefined:'no answer'));
   results.push(await scenario('Planned addition (plan, approve, execute)',"Plan a 3-second end card after the outro that says 'Subscribe for more' in the same style.",before=>project.state().versions.length>before&&sceneClips()>=3?undefined:`scene clips ${sceneClips()}, versions ${project.state().versions.length}`,{plan:true,render:'planned'}));
  }
 }
}finally{
 const report={folder,totalCostUsd:+spent().toFixed(4),results,usage,log};writeFileSync(join(folder,'engine-report.json'),JSON.stringify(report,null,2));
 console.log(`\nTotal $${report.totalCostUsd}. Report: ${join(folder,'engine-report.json')}`);
 project.close();server.close();runtime.stop?.();
 if(results.some(r=>r.problem))process.exitCode=1;
}
