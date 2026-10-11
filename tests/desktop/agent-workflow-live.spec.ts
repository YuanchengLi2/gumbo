import {test,expect,_electron as electron} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

/** A real editing session in the packaged app against the deployed gateway: the agent finds the user's own footage on
 * this computer, cuts it, reorders, grades, adds motion graphics, music, captions and transitions, swaps a clip, answers
 * a question and exports. Every request is a follow-up in one project, as a person would work. Spends real money:
 * runs only with DREAM_LIVE_WORKFLOW=1, on a temporary account capped at DREAM_LIVE_BUDGET_USD (default 3). */
test('live agentic editing session on footage found on this computer',async()=>{
 test.skip(process.env.DREAM_LIVE_WORKFLOW!=='1','Explicit, budgeted live-provider session.');test.setTimeout(3_600_000);
 const ref='qewguvfkkwvdoqptiljd',url=`https://${ref}.supabase.co`,keyCommand=spawnSync('powershell.exe',['-NoProfile','-Command',`supabase projects api-keys --project-ref ${ref} --output json`],{encoding:'utf8',windowsHide:true});if(keyCommand.status)throw new Error('Live configuration unavailable.');
 const keys=JSON.parse(keyCommand.stdout),service=keys.find((k:any)=>k.name==='service_role')?.api_key,anon=keys.find((k:any)=>k.name==='anon')?.api_key;
 const email=`dream-workflow-${crypto.randomUUID()}@example.invalid`,password=crypto.randomUUID()+crypto.randomUUID();let userId:string|undefined;
 async function api(path:string,body?:unknown,method=body?'POST':'GET'){const r=await fetch(url+path,{method,headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();if(!r.ok)throw new Error('Live setup failed: '+r.status+' '+text.slice(0,200));return text?JSON.parse(text):null;}
 const profile=mkdtempSync(join(tmpdir(),'dream-workflow-profile-')),folder=resolve('artifacts/live-workflow-'+Date.now());mkdirSync(folder,{recursive:true});writeFileSync(join(profile,'cloud.json'),JSON.stringify({url,anonKey:anon}));
 let app:Awaited<ReturnType<typeof electron.launch>>|undefined;const steps:any[]=[];
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
  const ask=async(name:string,text:string,check:(before:any,after:any)=>string|undefined)=>{
   const before=await state(),started=Date.now();await page.evaluate(text=>window.dream.command({type:'message',text}),text);
   let after:any;await expect.poll(async()=>{after=await state();return['complete','interrupted','awaiting_file_permission','failed'].includes(after.aiStatus)&&after.experience?.turnId!==before.experience?.turnId?after.aiStatus:'running';},{timeout:1_200_000,intervals:[3000]}).not.toBe('running');
   const problem=after.aiStatus!=='complete'?`status ${after.aiStatus}`:check(before,after),reply=after.messages.filter((m:any)=>m.role==='assistant').at(-1);
   const step={name,request:text,status:after.aiStatus,problem,seconds:Math.round((Date.now()-started)/1000),versionChanged:after.versionId!==before.versionId,reply:reply?.report?.summary??reply?.text,spine:after.timeline.spine.map((c:any)=>({assetId:c.assetId,filename:after.footage.assets.find((a:any)=>a.id===c.assetId)?.filename,srcIn:c.srcIn,srcOut:c.srcOut,speed:c.speed,framing:c.framing,transitionIn:c.transitionIn})),attached:after.timeline.attached.length,music:after.timeline.music.length,captions:after.timeline.captions?.style};
   steps.push(step);writeFileSync(join(folder,'session.json'),JSON.stringify(steps,null,2));console.log(`${problem?'FAILED':'passed'} ${name} in ${step.seconds}s${problem?': '+problem:''}`);
   expect.soft(problem,name).toBeUndefined();return after;
  };
  const footageClips=(s:any)=>s.timeline.spine.filter((c:any)=>{const a=s.footage.assets.find((x:any)=>x.id===c.assetId);return a&&!a.scene&&a.kind!=='audio';});
  await ask('find and cut','Find my most recent videos on this computer and make a 30-second edit from their best moments, in the order they were recorded.',(_b,a)=>footageClips(a).length>=2?undefined:`only ${footageClips(a).length} footage clips on the timeline`);
  await ask('reorder and trim','Open with the most striking shot instead, and cut anything shaky, dark or boring.',(b,a)=>JSON.stringify(b.timeline.spine)!==JSON.stringify(a.timeline.spine)?undefined:'the timeline did not change');
  await ask('gloomy grade','Make it feel more gloomy and cinematic.',(b,a)=>a.versionId!==b.versionId&&a.timeline.spine.some((c:any)=>c.framing&&((c.framing.saturation??1)<1||(c.framing.exposure??0)<0||(c.framing.temperature??0)<0||(c.framing.contrast??1)>1))||a.timeline.attached.length>b.timeline.attached.length?undefined:'no grade on the clips and no grading layer');
  await ask('motion graphics',"Add a title card at the start that says 'Late October', and a lower third on the second clip with today's date.",(b,a)=>a.footage.assets.filter((x:any)=>x.scene).length>b.footage.assets.filter((x:any)=>x.scene).length?undefined:'no new scene was published');
  await ask('music','Put quiet, moody instrumental music under the whole video, ducking whenever anyone speaks.',(_b,a)=>a.timeline.music.length?undefined:'no music on the timeline');
  await ask('captions','Add captions for anything that is said.',(_b,a)=>a.timeline.captions||/no (speech|one speaks|dialogue|spoken)|nothing (is )?(said|spoken)/i.test(JSON.stringify(a.messages.at(-1)))?undefined:'no captions and no explanation');
  await ask('transitions and speed','Add short crossfades between the clips and speed up the middle clip a little.',(_b,a)=>a.timeline.spine.some((c:any)=>c.transitionIn&&c.transitionIn.type!=='cut')&&a.timeline.spine.some((c:any)=>c.speed>1)?undefined:'missing crossfades or speed change');
  await ask('swap a clip','Swap the last clip for a different video from my computer that fits the mood better.',(b,a)=>{const last=(s:any)=>footageClips(s).at(-1)?.assetId;return last(a)&&last(a)!==last(b)?undefined:'the last clip is unchanged';});
  await ask('question','How long is the video now, and what is in it, in order?',(b,a)=>a.versionId===b.versionId?undefined:'answering changed the project');
  const exported=join(folder,'session-export.mp4');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},exported);
  const exportStarted=Date.now();await page.evaluate(()=>window.dream.exportVideo('video'));expect.soft(existsSync(exported),'export').toBe(true);
  steps.push({name:'export',seconds:Math.round((Date.now()-exportStarted)/1000),file:exported,exists:existsSync(exported)});writeFileSync(join(folder,'session.json'),JSON.stringify(steps,null,2));
  console.log('Live editing session evidence:',folder);
 }finally{await app?.close();if(userId)await api('/auth/v1/admin/users/'+userId,undefined,'DELETE').catch(()=>{});await api('/rest/v1/dream_invites?email=eq.'+encodeURIComponent(email),undefined,'DELETE').catch(()=>{});}
});
