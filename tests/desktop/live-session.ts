import {expect,_electron as electron,type Page} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,mkdirSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import Database from 'better-sqlite3';
import {sessionReport,formatReport,type RequestReport} from '../../scripts/session-report';

export type Step={name:string;request:string;status:string;problem?:string;targets:Record<string,boolean>;seconds:number;reply?:string;numbers?:RequestReport;[key:string]:unknown};
/** intent: the composer's mode (plan first, ask only); selection: timeline clip IDs the user selected; assetIds: media
 * attached to the message; expect: the status the request should end in (complete unless planning). */
export type AskOptions={intent?:'auto'|'plan'|'ask';selection?:string[];assetIds?:string[];expect?:string};
export type Ask=(name:string,text:string,check:(before:any,after:any,numbers:RequestReport|undefined)=>string|undefined,targets?:(before:any,after:any,numbers:RequestReport|undefined)=>Record<string,boolean>,options?:AskOptions)=>Promise<any>;
export type Session={page:Page;app:any;folder:string;ask:Ask;meta:(key:string)=>string|undefined;state:()=>Promise<any>;send:(text:string,options?:AskOptions)=>Promise<void>;settled:(before:any)=>Promise<any>;importFiles:(paths:string[])=>Promise<any>;record:(step:Step)=>void;words:(assetId:string)=>{start:number;end:number;text:string}[]};

/** Refuses to spend money on a stale build: the packaged app must be newer than every change to the app's code (committed
 * or not), and the deployed gateway newer than every change to the gateway's code. A live run on October 11 went to the
 * wrong model because the gateway had never been deployed after its routing schema changed. */
export function assertCurrent(executable:string,ref:string){
 const git=(...args:string[])=>spawnSync('git',args,{encoding:'utf8',windowsHide:true}).stdout.trim();
 const newest=(paths:string[])=>{const committed=Number(git('log','-1','--format=%ct','--',...paths)||0)*1000;
  const changed=git('status','--porcelain','--',...paths).split('\n').filter(Boolean).map(line=>line.slice(3).split(' -> ').pop()!.trim().replace(/^"|"$/g,'')).filter(path=>existsSync(path)).map(path=>statSync(path).mtimeMs);
  return Math.max(committed,...changed);};
 const asar=join(dirname(executable),'resources','app.asar'),code=newest(['apps','packages']);
 if(!existsSync(asar)||statSync(asar).mtimeMs<code)throw new Error(`The packaged app is older than its code (changed ${new Date(code).toISOString()}). Run pnpm package first.`);
 const listed=spawnSync('powershell.exe',['-NoProfile','-Command',`supabase functions list --project-ref ${ref}`],{encoding:'utf8',windowsHide:true});
 const deployed=Number(JSON.parse(listed.stdout.slice(listed.stdout.indexOf('{'))).functions?.find((f:any)=>f.slug==='dream-gateway')?.updated_at??0),gateway=newest(['supabase/functions']);
 if(deployed<gateway)throw new Error(`The deployed dream-gateway (${new Date(deployed).toISOString()}) is older than its code (changed ${new Date(gateway).toISOString()}). Run supabase functions deploy dream-gateway first.`);
}

/** A real editing session in the packaged app against the deployed gateway, on a temporary account whose daily allowance
 * is capped at DREAM_LIVE_BUDGET_USD (default 3). Each step records its numbers from the project's own database; checks are
 * problems, targets are the cost and speed goals; both are soft so the whole session always runs. */
export async function liveSession(prefix:string,run:(session:Session)=>Promise<void>,options:{computer?:boolean}={}){
 const ref='qewguvfkkwvdoqptiljd',executable=resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe');assertCurrent(executable,ref);
 const url=`https://${ref}.supabase.co`,keyCommand=spawnSync('powershell.exe',['-NoProfile','-Command',`supabase projects api-keys --project-ref ${ref} --output json`],{encoding:'utf8',windowsHide:true});if(keyCommand.status)throw new Error('Live configuration unavailable.');
 const keys=JSON.parse(keyCommand.stdout),service=keys.find((k:any)=>k.name==='service_role')?.api_key,anon=keys.find((k:any)=>k.name==='anon')?.api_key;
 const email=`dream-workflow-${crypto.randomUUID()}@example.invalid`,password=crypto.randomUUID()+crypto.randomUUID();let userId:string|undefined;
 async function api(path:string,body?:unknown,method=body?'POST':'GET'){const r=await fetch(url+path,{method,headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();if(!r.ok)throw new Error('Live setup failed: '+r.status+' '+text.slice(0,200));return text?JSON.parse(text):null;}
 const profile=mkdtempSync(join(tmpdir(),'dream-workflow-profile-')),folder=resolve(`artifacts/${prefix}-${Date.now()}`);mkdirSync(folder,{recursive:true});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url,anonKey:anon}));
 let app:Awaited<ReturnType<typeof electron.launch>>|undefined;const steps:Step[]=[];
 // Transcript words of a source, read from the project's database.
 const words=(assetId:string)=>{try{const db=new Database(join(folder,'.dream','project.sqlite'),{readonly:true,fileMustExist:true});try{return(db.prepare("SELECT json FROM index_records WHERE kind='words' AND json_extract(json,'$.assetId')=? ORDER BY json_extract(json,'$.start')").all(assetId) as {json:string}[]).map(r=>JSON.parse(r.json));}finally{db.close();}}catch{return[];}};
 const meta=(key:string)=>{try{const db=new Database(join(folder,'.dream','project.sqlite'),{readonly:true,fileMustExist:true});try{return(db.prepare('SELECT value FROM meta WHERE key=?').get(key) as {value:string}|undefined)?.value;}finally{db.close();}}catch{return undefined;}};
 try{
  userId=(await api('/auth/v1/admin/users',{email,password,email_confirm:true})).id;await api('/rest/v1/dream_invites',{email});
  app=await electron.launch({executablePath:executable,args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1'}});
  const page=await app.firstWindow();await page.evaluate(async({email,password})=>window.dream.command({type:'account',action:'signin',email,password}),{email,password});
  await api(`/rest/v1/dream_accounts?id=eq.${userId}`,{daily_budget_usd:Number(process.env.DREAM_LIVE_BUDGET_USD??3)},'PATCH');
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);await page.evaluate(()=>window.dream.pickProject(true));
  await page.evaluate(async folder=>window.dream.command({type:'create',folder,name:'Live editing session'}),folder);
  // The user turns on "Search this computer"; from then on the agent finds and imports footage itself.
  if(options.computer!==false)await page.evaluate(()=>window.dream.grantComputer());
  const state=()=>page.evaluate(()=>window.dream.command({type:'state'})) as Promise<any>;
  // A message starts a request without waiting for it, so a test can stop it part way.
  const send=async(text:string,o:AskOptions={})=>{void page.evaluate(command=>window.dream.command(command),{type:'message' as const,text,selection:o.selection??[],assetIds:o.assetIds??[],...(o.intent?{intent:o.intent}:{})}).catch(()=>{});};
  const settled=async(before:any)=>{let after:any;await expect.poll(async()=>{after=await state();return['complete','interrupted','awaiting_file_permission','awaiting_approval','failed'].includes(after.aiStatus)&&after.experience?.turnId!==before.experience?.turnId?after.aiStatus:'running';},{timeout:2_700_000,intervals:[3000]}).not.toBe('running');return after;};
  // Files the user brings in through the app's own picker, as from the Media tab, ready once every one is analyzed.
  const importFiles=async(paths:string[])=>{await app!.evaluate(({dialog}:any,paths:string[])=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});},paths);await page.evaluate(()=>window.dream.pickMedia());await page.evaluate(async paths=>window.dream.command({type:'import',paths,copy:true}),paths);
   let after:any;await expect.poll(async()=>{after=await state();return paths.every(path=>after.footage.assets.some((a:any)=>a.filename===path.split(/[\\/]/).pop()&&a.status==='ready'));},{timeout:300_000,intervals:[2000]}).toBe(true);return after;};
  const record=(step:Step)=>{steps.push(step);writeFileSync(join(folder,'session.json'),JSON.stringify(steps,null,2));};
  const ask:Ask=async(name,text,check,targets,o={})=>{
   const before=await state(),started=Date.now();await send(text,o);
   const after=await settled(before);
   const numbers=(()=>{try{return sessionReport(folder).find(r=>r.turnId===after.experience?.turnId);}catch{return undefined;}})();
   const problem=after.aiStatus!==(o.expect??'complete')?`status ${after.aiStatus}`:check(before,after,numbers),reply=after.messages.filter((m:any)=>m.role==='assistant').at(-1);
   const goals=targets?.(before,after,numbers)??{};
   const step:Step={name,request:text,status:after.aiStatus,problem,targets:goals,seconds:Math.round((Date.now()-started)/1000),reply:reply?.report?.summary??reply?.text,numbers,spine:after.timeline.spine.map((c:any)=>({id:c.id,assetId:c.assetId,filename:after.footage.assets.find((a:any)=>a.id===c.assetId)?.filename,srcIn:c.srcIn,srcOut:c.srcOut,speed:c.speed,framing:c.framing,transitionIn:c.transitionIn})),attached:after.timeline.attached.length,music:after.timeline.music.length,captions:after.timeline.captions?.style};
   record(step);
   const missed=Object.entries(goals).filter(([,met])=>!met).map(([goal])=>goal);
   console.log(`${problem?'FAILED':'passed'} ${name} in ${step.seconds}s${numbers?` for $${numbers.costUsd.toFixed(3)} (${numbers.calls} calls)`:''}${problem?': '+problem:''}${missed.length?` — missed: ${missed.join(', ')}`:''}`);
   expect.soft(problem,name).toBeUndefined();for(const goal of missed)expect.soft(goal,`${name}: target`).toBe('met');
   return after;
  };
  await run({page,app,folder,ask,meta,state,send,settled,importFiles,record,words});
  const report=formatReport(sessionReport(folder),process.env.DREAM_LIVE_COMPARE?sessionReport(resolve(process.env.DREAM_LIVE_COMPARE)):undefined);writeFileSync(join(folder,'session-report.txt'),report);console.log(report);
  console.log('Live editing session evidence:',folder);
 }finally{await app?.close();if(userId)await api('/auth/v1/admin/users/'+userId,undefined,'DELETE').catch(()=>{});await api('/rest/v1/dream_invites?email=eq.'+encodeURIComponent(email),undefined,'DELETE').catch(()=>{});}
}

/** Footage clips on the spine (not scenes or audio), each clip's length on the timeline, and whether every range fits its source. */
export const footageClips=(s:any)=>s.timeline.spine.filter((c:any)=>{const a=s.footage.assets.find((x:any)=>x.id===c.assetId);return a&&!a.scene&&a.kind!=='audio';});
export const clipLength=(c:any)=>c.holdSec??(c.srcOut-c.srcIn)/(c.speed||1);
export const videoLength=(s:any)=>s.timeline.spine.reduce((n:number,c:any)=>n+clipLength(c),0);
export const outOfRange=(s:any)=>s.timeline.spine.filter((c:any)=>{const a=s.footage.assets.find((x:any)=>x.id===c.assetId);return a&&a.kind!=='image'&&a.durationSec>0&&(c.srcOut>a.durationSec+.05||c.srcIn<0||c.srcOut<=c.srcIn);}).map((c:any)=>c.id);
export const clipIds=(s:any)=>s.timeline.spine.map((c:any)=>c.id);
/** Scenes on the timeline: spine clips and attached items that play a published scene. */
export const sceneUses=(s:any)=>{const scenes=new Set(s.footage.assets.filter((a:any)=>a.scene).map((a:any)=>a.id));return s.timeline.spine.filter((c:any)=>scenes.has(c.assetId)).length+s.timeline.attached.filter((i:any)=>i.source&&scenes.has(i.source.assetId)).length;};
/** Goals: a simple follow-up starts without a router call, runs on Sonnet only and finishes in under a minute for about ten cents. */
export const quick=(_b:any,_a:any,n:RequestReport|undefined)=>({'no router call':!!n&&!n.routed,'Sonnet only':!!n&&Object.keys(n.byModel).every(m=>m==='sonnet'),'under $0.15':!!n&&n.costUsd<.15,'under 60 s':!!n&&n.seconds<60});
export const noOpus=(_b:any,_a:any,n:RequestReport|undefined)=>({'no Opus':!!n&&!n.byModel.opus});
export const assetNamed=(s:any,filename:string)=>s.footage.assets.find((a:any)=>a.filename===filename)?.id as string|undefined;
