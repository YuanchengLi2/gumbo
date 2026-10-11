import {expect,_electron as electron,type Page} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import Database from 'better-sqlite3';
import {sessionReport,formatReport,type RequestReport} from '../../scripts/session-report';

export type Step={name:string;request:string;status:string;problem?:string;targets:Record<string,boolean>;seconds:number;reply?:string;numbers?:RequestReport;[key:string]:unknown};
export type Ask=(name:string,text:string,check:(before:any,after:any,numbers:RequestReport|undefined)=>string|undefined,targets?:(before:any,after:any,numbers:RequestReport|undefined)=>Record<string,boolean>)=>Promise<any>;

/** A real editing session in the packaged app against the deployed gateway, on a temporary account whose daily allowance
 * is capped at DREAM_LIVE_BUDGET_USD (default 3). Each step records its numbers from the project's own database; checks are
 * problems, targets are the cost and speed goals; both are soft so the whole session always runs. */
export async function liveSession(prefix:string,run:(session:{page:Page;app:any;folder:string;ask:Ask;meta:(key:string)=>string|undefined})=>Promise<void>){
 const ref='qewguvfkkwvdoqptiljd',url=`https://${ref}.supabase.co`,keyCommand=spawnSync('powershell.exe',['-NoProfile','-Command',`supabase projects api-keys --project-ref ${ref} --output json`],{encoding:'utf8',windowsHide:true});if(keyCommand.status)throw new Error('Live configuration unavailable.');
 const keys=JSON.parse(keyCommand.stdout),service=keys.find((k:any)=>k.name==='service_role')?.api_key,anon=keys.find((k:any)=>k.name==='anon')?.api_key;
 const email=`dream-workflow-${crypto.randomUUID()}@example.invalid`,password=crypto.randomUUID()+crypto.randomUUID();let userId:string|undefined;
 async function api(path:string,body?:unknown,method=body?'POST':'GET'){const r=await fetch(url+path,{method,headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();if(!r.ok)throw new Error('Live setup failed: '+r.status+' '+text.slice(0,200));return text?JSON.parse(text):null;}
 const profile=mkdtempSync(join(tmpdir(),'dream-workflow-profile-')),folder=resolve(`artifacts/${prefix}-${Date.now()}`);mkdirSync(folder,{recursive:true});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url,anonKey:anon}));
 let app:Awaited<ReturnType<typeof electron.launch>>|undefined;const steps:Step[]=[];
 const meta=(key:string)=>{try{const db=new Database(join(folder,'.dream','project.sqlite'),{readonly:true,fileMustExist:true});try{return(db.prepare('SELECT value FROM meta WHERE key=?').get(key) as {value:string}|undefined)?.value;}finally{db.close();}}catch{return undefined;}};
 try{
  userId=(await api('/auth/v1/admin/users',{email,password,email_confirm:true})).id;await api('/rest/v1/dream_invites',{email});
  app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1'}});
  const page=await app.firstWindow();await page.evaluate(async({email,password})=>window.dream.command({type:'account',action:'signin',email,password}),{email,password});
  await api(`/rest/v1/dream_accounts?id=eq.${userId}`,{daily_budget_usd:Number(process.env.DREAM_LIVE_BUDGET_USD??3)},'PATCH');
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);await page.evaluate(()=>window.dream.pickProject(true));
  await page.evaluate(async folder=>window.dream.command({type:'create',folder,name:'Live editing session'}),folder);
  // The user turns on "Search this computer"; from then on the agent finds and imports footage itself.
  await page.evaluate(()=>window.dream.grantComputer());
  const state=()=>page.evaluate(()=>window.dream.command({type:'state'})) as Promise<any>;
  const ask:Ask=async(name,text,check,targets)=>{
   const before=await state(),started=Date.now();await page.evaluate(text=>window.dream.command({type:'message',text}),text);
   let after:any;await expect.poll(async()=>{after=await state();return['complete','interrupted','awaiting_file_permission','failed'].includes(after.aiStatus)&&after.experience?.turnId!==before.experience?.turnId?after.aiStatus:'running';},{timeout:1_200_000,intervals:[3000]}).not.toBe('running');
   const numbers=(()=>{try{return sessionReport(folder).find(r=>r.turnId===after.experience?.turnId);}catch{return undefined;}})();
   const problem=after.aiStatus!=='complete'?`status ${after.aiStatus}`:check(before,after,numbers),reply=after.messages.filter((m:any)=>m.role==='assistant').at(-1);
   const goals=targets?.(before,after,numbers)??{};
   const step:Step={name,request:text,status:after.aiStatus,problem,targets:goals,seconds:Math.round((Date.now()-started)/1000),reply:reply?.report?.summary??reply?.text,numbers,spine:after.timeline.spine.map((c:any)=>({id:c.id,assetId:c.assetId,filename:after.footage.assets.find((a:any)=>a.id===c.assetId)?.filename,srcIn:c.srcIn,srcOut:c.srcOut,speed:c.speed,framing:c.framing,transitionIn:c.transitionIn})),attached:after.timeline.attached.length,music:after.timeline.music.length,captions:after.timeline.captions?.style};
   steps.push(step);writeFileSync(join(folder,'session.json'),JSON.stringify(steps,null,2));
   const missed=Object.entries(goals).filter(([,met])=>!met).map(([goal])=>goal);
   console.log(`${problem?'FAILED':'passed'} ${name} in ${step.seconds}s${numbers?` for $${numbers.costUsd.toFixed(3)} (${numbers.calls} calls)`:''}${problem?': '+problem:''}${missed.length?` — missed: ${missed.join(', ')}`:''}`);
   expect.soft(problem,name).toBeUndefined();for(const goal of missed)expect.soft(goal,`${name}: target`).toBe('met');
   return after;
  };
  await run({page,app,folder,ask,meta});
  const report=formatReport(sessionReport(folder),process.env.DREAM_LIVE_COMPARE?sessionReport(resolve(process.env.DREAM_LIVE_COMPARE)):undefined);writeFileSync(join(folder,'session-report.txt'),report);console.log(report);
  console.log('Live editing session evidence:',folder);
 }finally{await app?.close();if(userId)await api('/auth/v1/admin/users/'+userId,undefined,'DELETE').catch(()=>{});await api('/rest/v1/dream_invites?email=eq.'+encodeURIComponent(email),undefined,'DELETE').catch(()=>{});}
}

/** Footage clips on the spine (not scenes or audio), each clip's length on the timeline, and whether every range fits its source. */
export const footageClips=(s:any)=>s.timeline.spine.filter((c:any)=>{const a=s.footage.assets.find((x:any)=>x.id===c.assetId);return a&&!a.scene&&a.kind!=='audio';});
export const clipLength=(c:any)=>c.holdSec??(c.srcOut-c.srcIn)/(c.speed||1);
export const videoLength=(s:any)=>s.timeline.spine.reduce((n:number,c:any)=>n+clipLength(c),0);
export const outOfRange=(s:any)=>s.timeline.spine.filter((c:any)=>{const a=s.footage.assets.find((x:any)=>x.id===c.assetId);return a&&a.kind!=='image'&&a.durationSec>0&&(c.srcOut>a.durationSec+.05||c.srcIn<0||c.srcOut<=c.srcIn);}).map((c:any)=>c.id);
