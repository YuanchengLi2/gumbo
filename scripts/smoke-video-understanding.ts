import {Director} from '@dream/orchestrator';
import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import ffmpeg from 'ffmpeg-static';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {VideoUnderstanding} from '../apps/project-service/src/video-understanding';
import {sourceInspector} from '../apps/project-service/src/source-frames';
import {executeFootageTool} from '../packages/orchestrator/src/footage-tools';

const projectRef='qewguvfkkwvdoqptiljd',url=`https://${projectRef}.supabase.co`;
const configured=process.platform==='win32'?spawnSync('powershell.exe',['-NoProfile','-Command','supabase projects api-keys --project-ref qewguvfkkwvdoqptiljd --output json'],{encoding:'utf8',windowsHide:true}):spawnSync('supabase',['projects','api-keys','--project-ref',projectRef,'--output','json'],{encoding:'utf8',windowsHide:true});
if(configured.status!==0)throw new Error('Dedicated test configuration is unavailable.');
const keys=JSON.parse(configured.stdout),serviceKey=keys.find((k:any)=>k.name==='service_role')?.api_key,anonKey=keys.find((k:any)=>k.name==='anon')?.api_key;
if(!serviceKey||!anonKey)throw new Error('Missing test credentials.');
async function request(path:string,body?:unknown,token=serviceKey,method=body?'POST':'GET'){const response=await fetch(url+path,{method,headers:{apikey:serviceKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json().catch(()=>null);if(!response.ok)throw new Error(`Test service request failed (${response.status}): ${data?.message??data?.error??'unknown error'}`);return data;}
const email=`dream-observation-${randomUUID()}@example.invalid`,password=randomUUID()+randomUUID();let userId:string|undefined,db:ProjectDB|undefined,observer:VideoUnderstanding|undefined;
try{
 const folder=resolve('artifacts','Video Understanding '+Date.now());mkdirSync(folder,{recursive:true});const source=join(folder,'motion-source.mp4');
 const rendered=spawnSync(ffmpeg!,['-y','-v','error','-f','lavfi','-i','color=c=0x202030:s=640x360:r=30:d=9','-f','lavfi','-i','color=c=0xff3030:s=48x48:r=30:d=9','-filter_complex',"[0:v]drawbox=x=280:y=230:w=60:h=60:color=blue:t=fill[bg];[bg][1:v]overlay=x='20+150*mod(t,3)':y=80:enable='lt(t,3)+gte(t,6)'[out]",'-map','[out]','-t','9','-c:v','libx264','-pix_fmt','yuv420p',source],{windowsHide:true});if(rendered.status)throw new Error(rendered.stderr.toString());
 const user=await request('/auth/v1/admin/users',{email,password,email_confirm:true});userId=user.id;await request('/rest/v1/dream_invites',{email});const session=await request('/auth/v1/token?grant_type=password',{email,password},anonKey);await request('/functions/v1/dream-gateway/account',undefined,session.access_token);await request(`/rest/v1/dream_accounts?id=eq.${userId}`,{daily_budget_usd:2},serviceKey,'PATCH');
 db=new ProjectDB(join(folder,'project'),'Video understanding acceptance');const asset=AssetSchema.parse({id:'source',filename:'motion-source.mp4',kind:'video',durationSec:9,fps:30,width:640,height:360,hasAudio:false,originalPath:source,fingerprint:createHash('sha256').update(readFileSync(source)).digest('hex'),status:'ready'});db.saveAsset(asset);db.inspectSource=sourceInspector(db,ffmpeg!);
 observer=new VideoUnderstanding(db,{connect:async()=>({url:url+'/functions/v1/dream-gateway',token:session.access_token}),inspect:db.inspectSource,publish:()=>{}});
 const started=Date.now();observer.enqueue(asset);await observer.drain();const state=db.footage().assets[0].understanding,observations=(executeFootageTool(db,'read_footage',{assetId:'source',startSec:0,endSec:9}) as any).observations;
 const descriptions=observations.flatMap((o:any)=>[o.report.summary,...o.report.events.map((e:any)=>e.description),...o.refinements.flatMap((r:any)=>[r.report.summary,...r.report.events.map((e:any)=>e.description)])]).join('\n');
 const initialUsage=await request(`/rest/v1/dream_usage?user_id=eq.${userId}&select=model,status,input_tokens,output_tokens,cache_read_tokens,cost_usd`);
 const before=initialUsage.length;observer.enqueue(db.footage().assets[0],true);await observer.drain();const after=await request(`/rest/v1/dream_usage?user_id=eq.${userId}&select=id`);
 const head=db.head(),director=new Director(db,async()=>({url:url+'/functions/v1/dream-gateway',token:session.access_token}),()=>{});
 await director.message('Inspect source asset source from 2.5 to 3.5 seconds with inspect_footage using motion detail. Describe the visual change you can actually see. Do not edit anything.');
 const checkpointRows=db.db.prepare("SELECT key FROM meta WHERE key LIKE 'answer_checkpoint:%'").all() as {key:string}[];
 const inspected=checkpointRows.some(row=>db!.loadState<any>(row.key)?.messages?.some((m:any)=>Array.isArray(m.content)&&m.content.some((b:any)=>b.type==='tool_use'&&b.name==='inspect_footage')));
 const directInspection={usedSourceFrames:inspected,noTimelineMutation:db.head()===head,status:db.state().aiStatus,answer:db.state().messages.at(-1)?.text};
 const usage=await request(`/rest/v1/dream_usage?user_id=eq.${userId}&select=model,status,input_tokens,output_tokens,cache_read_tokens,cost_usd`);
 const passed=inspected&&directInspection.noTimelineMutation&&directInspection.status==='complete'&&state?.status==='complete'&&state.observedThroughSec===9&&/red/i.test(descriptions)&&/right|left|mov|travel|shift/i.test(descriptions)&&/disappear|vanish|absen|no longer|reappear|only.*blue/i.test(descriptions)&&before===after.length;
 const report={passed,directInspection,fixture:'Synthetic nine-second motion sequence with no audio, transcript or descriptive filename; not a real-world quality benchmark.',expected:'A red square moves right during 0–3s, disappears during 3–6s, and reappears/moves right during 6–9s. A blue square remains stationary.',elapsedMs:Date.now()-started,state,observations,usage,cacheReplayWithoutNewInference:before===after.length,errors:db.state().jobs.filter(j=>j.step==='visual_understanding'&&j.error)};
 writeFileSync(resolve('artifacts/video-understanding-acceptance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed,directInspection,elapsedMs:report.elapsedMs,state,descriptions,usage,cacheReplayWithoutNewInference:report.cacheReplayWithoutNewInference,errors:report.errors},null,2));if(!passed)process.exitCode=1;
}finally{await observer?.close();db?.close();await request(`/rest/v1/dream_invites?email=eq.${encodeURIComponent(email)}`,undefined,serviceKey,'DELETE');if(userId)await request(`/auth/v1/admin/users/${userId}`,undefined,serviceKey,'DELETE');}
