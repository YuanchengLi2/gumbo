import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';import {Director} from '@dream/orchestrator';
import {infer} from '../packages/orchestrator/src/inference';
const ref='qewguvfkkwvdoqptiljd',root='https://'+ref+'.supabase.co';
const keysResult=spawnSync('powershell.exe',['-NoProfile','-Command','supabase projects api-keys --project-ref '+ref+' --output json'],{encoding:'utf8',windowsHide:true});
if(keysResult.status)throw new Error('Could not load test configuration.');
const keys=JSON.parse(keysResult.stdout),service=keys.find((k:any)=>k.name==='service_role').api_key,anon=keys.find((k:any)=>k.name==='anon').api_key;
const email='dream-reliability-'+randomUUID()+'@example.invalid',password=randomUUID()+randomUUID();let userId:string|undefined;
async function call(path:string,body?:any,token=service,method=body?'POST':'GET'){const response=await fetch(root+path,{method,headers:{apikey:service,Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined});const value=await response.json().catch(()=>null);if(!response.ok)throw new Error('Acceptance request failed '+response.status+': '+JSON.stringify(value));return value;}
const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-live-reliability-')),'Live recovery');const started=Date.now();
try{
 userId=(await call('/auth/v1/admin/users',{email,password,email_confirm:true})).id;await call('/rest/v1/dream_invites',{email});const auth=await call('/auth/v1/token?grant_type=password',{email,password},anon);await call('/functions/v1/dream-gateway/account',undefined,auth.access_token);await call('/rest/v1/dream_accounts?id=eq.'+userId,{daily_budget_usd:1},service,'PATCH');
 const config={url:root+'/functions/v1/dream-gateway',token:auth.access_token,accountId:userId};let dropped=false,generations=0,recoveries=0;const requests:any[]=[];
 const transport:typeof fetch=async(url,init)=>{const response=await fetch(url,init);if(String(url).endsWith('/ai')){generations++;requests.push(JSON.parse(String(init?.body)));if(!dropped&&response.ok){dropped=true;await response.arrayBuffer();throw new TypeError('Acceptance: completed connection lost');}}if(String(url).endsWith('/ai-status'))recoveries++;return response;};
 const director=new Director(db,async()=>config,()=>{});
 director.inference=(model,system,messages,tools=[],turnId,forceTool,purpose='routine')=>infer({db,config,input:{model,system,messages,tools,turnId,purpose,max_tokens:2048,tool_choice:forceTool?{type:'tool',name:forceTool}:undefined},resume:0},{fetch:transport});
 await director.message('Set the project frame rate to 24 fps and its canvas to 1080 by 1080. Finish after saving these settings.');
 if(db.state().aiStatus!=='complete'||db.timeline().settings.fps!==24||db.timeline().settings.width!==1080)throw new Error('Recovered edit did not complete.');
 const versionCount=db.state().versions.length;
 const first={model:'claude-sonnet-5-5',system:'You are a concise test assistant. Use read_value when asked for the stored value.',messages:[{role:'user',content:'Read the stored value with read_value now.'}],tools:[{name:'read_value',description:'Read the saved value.',input_schema:{type:'object',properties:{}}}],turnId:'binding-test',purpose:'routine',max_tokens:1024};
 const response=await infer({db,config,input:first,resume:0});const tool=response.content.find((c:any)=>c.type==='tool_use');if(!tool)throw new Error('Live binding fixture did not call its read tool.');
 const history=[...first.messages,{role:'assistant',content:response.content},{role:'user',content:[{type:'tool_result',tool_use_id:tool.id,content:'The stored value is 24.'}]}];
 const second=await infer({db,config,input:{...first,system:first.system+' Explain the result briefly.',tools:[...first.tools,{name:'read_format',description:'Read the canvas.',input_schema:{type:'object',properties:{}}}],messages:history},resume:0});
 const switched=await infer({db,config,input:{...first,model:'claude-opus-5-5',system:'Reply in one sentence with the supplied stored value. Do not call tools.',messages:history},resume:0});
 if(!second.content.length||!switched.content.length)throw new Error('Changed prefix or model failed.');
 const wire=requests.find(request=>request.requestId);const replay=await fetch(config.url+'/ai',{method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:JSON.stringify(wire)});const replayBody=await replay.json();if(!replay.ok||!replayBody.content)throw new Error('Same-request replay failed.');
 const usage=await call('/rest/v1/dream_usage?user_id=eq.'+userId+'&select=model,status,cost_usd,cache_read_tokens');
 const report={passed:true,elapsedMs:Date.now()-started,lostResponseRecovered:dropped&&recoveries>0,editGenerations:generations,editedSettings:db.timeline().settings,versionCount,originalRequestReplay:replay.status,thinkingBlocks:response.content.filter((c:any)=>c.type==='thinking').length,changedSystemAndTools:true,modelSwitch:true,usage};writeFileSync('artifacts/reliability-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{db.close();await call('/rest/v1/dream_invites?email=eq.'+encodeURIComponent(email),undefined,service,'DELETE');if(userId)await call('/auth/v1/admin/users/'+userId,undefined,service,'DELETE');}
