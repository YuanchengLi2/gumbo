import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {models} from '@dream/config';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';
import {codeAgent} from '../../packages/orchestrator/src/code-agent';
import {Director} from '../../packages/orchestrator/src/code-director';
import {validateDelegation} from '../../packages/orchestrator/src/code-tools';
import {budgetRequest} from '../../packages/orchestrator/src/context-budget';
import {infer} from '../../packages/orchestrator/src/inference';
import {assertToolExchanges} from '../../packages/orchestrator/src/tool-exchanges';

const fixture=()=>new ProjectDB(mkdtempSync(join(tmpdir(),'dream-engine-')));
const workspaceFor=(db:ProjectDB)=>new CodeWorkspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg:'unavailable',ffprobe:'unavailable'},()=>{});
const scene=(label:string)=>`<div id="t">${label}</div><script>window.renderFrame=(frame,fps)=>{document.getElementById('t').style.opacity=String(Math.min(1,frame/fps));};</script>`;
const toolUse=(id:string,name:string,input:any)=>({content:[{type:'tool_use',id,name,input}],stop_reason:'tool_use',usage:{}});
const resultOf=(messages:any[],id:string)=>{for(const m of messages)if(Array.isArray(m.content))for(const b of m.content)if(b.type==='tool_result'&&b.tool_use_id===id)return b;};

it('lets the editing agent run helpers in parallel within disjoint write scopes, then place their scenes and publish itself',async()=>{
 const db=fixture(),ws=workspaceFor(db);let arrived=0,release!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve);
 const seen:Record<string,any[]>={};let agentCalls=0;const helperCalls:Record<string,number>={};
 try{
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,ws);
  director.inference=async(_model,_system,messages:any,_tools,_turn,_force,purpose='execution')=>{
   if(purpose==='routing')return{content:[{type:'text',text:JSON.stringify({route:'local',intelligence:'sonnet',complexity:'normal',reason:'Two new scenes',approvalQuote:null})}],stop_reason:'end_turn',usage:{}};
   if(purpose==='execution'){agentCalls++;
    if(agentCalls===1)return toolUse('parallel','delegate',{tasks:[{id:'title',title:'Build the title card',brief:'Write src/title/scene.html.',writes:['src/title']},{id:'outro',title:'Build the outro',brief:'Write src/outro/scene.html.',writes:['src/outro']}]});
    if(agentCalls===2){expect(JSON.stringify(resultOf(messages,'parallel'))).toContain('Wrote the title');const doc=JSON.parse(readFileSync(join(ws.root,'project.json'),'utf8'));doc.outputs=['title','outro'].map(id=>({id,path:`src/${id}/scene.html`,kind:'scene',width:640,height:360,fps:30,durationInFrames:60}));doc.timeline.spine=['title','outro'].map(id=>({id,assetId:'output:'+id,srcIn:0,srcOut:2,speed:1,audio:{mute:true},reason:'Scene'}));return{content:[{type:'tool_use',id:'doc',name:'write_file',input:{path:'project.json',content:JSON.stringify(doc)}},{type:'tool_use',id:'pub',name:'publish_project',input:{}}],stop_reason:'tool_use',usage:{}};}
    return{content:[{type:'tool_use',id:'done',name:'finish',input:{status:'complete',summary:'Added the title and outro.'}}],stop_reason:'tool_use',usage:{}};}
   const head=messages[0].content,brief=(typeof head==='string'?head:head.filter((b:any)=>b.type==='text').at(-1).text).split('\n')[0],task=brief.includes('title card')?'title':'outro',n=helperCalls[task]=(helperCalls[task]??0)+1;seen[task]=messages;
   if(n===1){arrived++;if(arrived===2)release();await barrier;return{content:[{type:'tool_use',id:task+'-json',name:'write_file',input:{path:'project.json',content:'{}'}},{type:'tool_use',id:task+'-stray',name:'write_file',input:{path:'src/shared.js',content:'x'}},{type:'tool_use',id:task+'-write',name:'write_file',input:{path:`src/${task}/scene.html`,content:scene(task)}}],stop_reason:'tool_use',usage:{}};}
   return{content:[{type:'tool_use',id:task+'-finish',name:'finish',input:{status:'complete',summary:`Wrote the ${task} scene at src/${task}/scene.html.`}}],stop_reason:'tool_use',usage:{}};
  };
  await director.message('Add a title card and an outro');
  expect(db.getMeta('ai_status')).toBe('complete');expect(arrived).toBe(2);
  for(const task of ['title','outro']){expect(resultOf(seen[task],task+'-json').content).toContain('Helpers do not edit project.json');expect(resultOf(seen[task],task+'-stray').content).toContain(`only write under src/${task}`);expect(readFileSync(join(ws.root,`src/${task}/scene.html`),'utf8')).toBe(scene(task));}
  expect(db.timeline().spine.map(c=>c.id)).toEqual(['title','outro']);expect(db.footage().assets.filter(a=>a.scene)).toHaveLength(2);
 }finally{db.close();}
});
it('rejects unsafe parallel delegations before any helper starts',()=>{
 const task=(id:string,writes:string[])=>({id,title:id,brief:'b',writes});
 expect(()=>validateDelegation([task('a',['src/a']),task('b',['src/a/inner'])])).toThrow('overlapping');
 expect(()=>validateDelegation([task('a',['project.json']),task('b',['src/b'])])).toThrow('project.json');
 expect(()=>validateDelegation([task('a',['.'])])).toThrow('whole workspace');
 expect(()=>validateDelegation([task('a',['src/a']),task('b',['src/ab'])])).not.toThrow();
});
it('inlines local script and stylesheet references at publication and rejects external ones',async()=>{
 const db=fixture(),ws=workspaceFor(db);try{
  await ws.initialize();mkdirSync(join(ws.root,'src/intro'),{recursive:true});
  writeFileSync(join(ws.root,'output/intro.js'),'window.lib={version:1};/* </script> */');writeFileSync(join(ws.root,'src/intro/style.css'),'body{background:#123}');
  writeFileSync(join(ws.root,'src/intro/scene.html'),'<link rel="stylesheet" href="style.css"><script src="../../output/intro.js"></script><script>window.renderFrame=()=>{document.body.dataset.v=String(window.lib.version);};</script>');
  const path=join(ws.root,'project.json'),doc=JSON.parse(readFileSync(path,'utf8'));doc.outputs=[{id:'intro',path:'src/intro/scene.html',kind:'scene',width:640,height:360,fps:30,durationInFrames:30}];doc.timeline.spine=[{id:'intro',assetId:'output:intro',srcIn:0,srcOut:1,speed:1,audio:{mute:true},reason:'Scene'}];writeFileSync(path,JSON.stringify(doc));
  const published=await ws.execute('publish_project',{},'inline','turn',new AbortController().signal),html=readFileSync(db.footage().assets.find(a=>a.scene)!.originalPath,'utf8');
  expect(published.publication.versionId).toBe(db.head());expect(html).toContain('window.lib={version:1}');expect(html).toContain('<\\/script>');expect(html).toContain('<style>body{background:#123}</style>');expect(html).not.toMatch(/src=|<link/);
  expect(published.projectJson.hash).toBe((await ws.execute('read_file',{path:'project.json'},'read','turn',new AbortController().signal)).hash);
  const next=JSON.parse(readFileSync(path,'utf8'));next.outputs=[{id:'cdn',path:'src/intro/cdn.html',kind:'scene',width:640,height:360,fps:30,durationInFrames:30}];next.timeline.spine[0].assetId='output:cdn';writeFileSync(path,JSON.stringify(next));
  writeFileSync(join(ws.root,'src/intro/cdn.html'),'<script src="https://cdn.example.com/lib.js"></script><script>window.renderFrame=()=>{};</script>');
  await expect(ws.execute('publish_project',{},'cdn','turn',new AbortController().signal)).rejects.toThrow('external');
 }finally{db.close();}
});

it('edits without a hash, explains failed matches, and never publishes from a command',async()=>{
 const db=fixture();let ran=0;const ws=new CodeWorkspace(db,{run:async request=>{ran++;return{id:request.id,status:'complete',exitCode:0,output:'ok',startedAt:'',finishedAt:'',logPath:'',isolation:'windows-appcontainer',commandHash:''};},ffmpeg:'',ffprobe:''},()=>{});
 try{await ws.initialize();const signal=new AbortController().signal,before=db.head();
  await ws.execute('write_file',{path:'src/a.js',content:'const a=1;\nconst a2=1;'},'w','turn',signal);
  await expect(ws.execute('edit_file',{path:'src/a.js',oldText:'const a',newText:'let a'},'e1','turn',signal)).rejects.toThrow('matches 2 places');
  await expect(ws.execute('edit_file',{path:'src/a.js',oldText:'missing',newText:'x'},'e2','turn',signal)).rejects.toThrow('not found');
  await ws.execute('edit_file',{path:'src/a.js',oldText:'const a=1;',newText:'let a=1;'},'e3','turn',signal);expect(readFileSync(join(ws.root,'src/a.js'),'utf8')).toBe('let a=1;\nconst a2=1;');
  const command=await ws.execute('run_command',{command:'node --check src/a.js'},'check','turn',signal);expect(ran).toBe(1);expect(command.publication).toBeUndefined();expect(db.head()).toBe(before);
 }finally{db.close();}
});

it('stops at the step limit and after bounded nudges instead of looping',async()=>{
 const db=fixture();try{
  const base={db,turnId:'turn',model:models.agent,text:'Edit the opening',signal:new AbortController().signal,publish:()=>{},workspace:{initialize:async()=>{},context:()=>({}),execute:async()=>({files:[]})}};
  let reads=0;const capped=await codeAgent({...base,phase:'loop',infer:async()=>toolUse('read'+reads++,'list_files',{path:'.'})});
  expect(capped.outcome.status).toBe('blocked');expect(capped.outcome.summary).toContain('step limit');expect(reads).toBe(80);
  let texts=0;const talker=await codeAgent({...base,phase:'talk',infer:async()=>{texts++;return{content:[{type:'text',text:'I would change the opening.'}],stop_reason:'end_turn',usage:{}};}});
  expect(texts).toBe(3);expect(talker.outcome.status).toBe('blocked');expect(talker.outcome.summary).toContain('I would change the opening.');expect(talker.outcome.summary).toContain('Publish the current revision');
  let worker=0;const report=await codeAgent({...base,phase:'worker',role:'worker',infer:async()=>{worker++;return{content:[{type:'text',text:'Wrote src/intro/scene.html.'}],stop_reason:'end_turn',usage:{}};}});
  expect(worker).toBe(1);expect(report.outcome).toMatchObject({status:'complete',summary:'Wrote src/intro/scene.html.'});
 }finally{db.close();}
});

it('accepts completion once published, auto-completing the task list instead of rejecting finish',async()=>{
 const db=fixture();try{db.setMeta('pending_request',JSON.stringify({turnId:'turn'}));db.setMeta('turn_activity:turn',JSON.stringify({turnId:'turn',events:[],tasks:[]}));
  let n=0;const result=await codeAgent({db,turnId:'turn',model:models.agent,text:'Fix the caption',signal:new AbortController().signal,publish:()=>{},workspace:{initialize:async()=>{},context:()=>({}),execute:async()=>({publication:{versionId:db.head(),assets:[]}})},
   infer:async()=>[toolUse('tasks','update_tasks',{tasks:[{id:'a',title:'Fix the caption',status:'running'}]}),toolUse('pub','publish_project',{}),toolUse('done','finish',{status:'complete',summary:'Fixed the caption.',evidence:[{toolCallId:'invented',finding:'x'}]})][n++]});
  expect(result.outcome.status).toBe('complete');expect(result.outcome.evidence.map(e=>e.toolCallId)).toEqual(['pub']);expect(db.turnActivity('turn')!.tasks!.every(t=>t.status==='complete')).toBe(true);
 }finally{db.close();}
});

it('keeps the compacted provider prefix byte-identical as the conversation grows',()=>{
 const db=fixture();try{
  const messages:any[]=[{role:'user',content:'Build the scene'}];const exchange=(i:number)=>[{role:'assistant',content:[{type:'tool_use',id:'r'+i,name:'read_file',input:{path:'src/f'+i}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'r'+i,content:'abcdefghijklmn'[i].repeat(40000)}]}];
  for(let i=0;i<12;i++)messages.push(...exchange(i));
  const input={model:models.agent,purpose:'execution',system:'Work',tools:[],turnId:'turn',max_tokens:16384};
  const first=budgetRequest(db,{...input,messages},.5).messages;expect(first.length).toBeLessThan(messages.length);assertToolExchanges(first);
  messages.push(...exchange(12),...exchange(13));
  const second=budgetRequest(db,{...input,messages}).messages;
  expect(JSON.stringify(second.slice(0,first.length))).toBe(JSON.stringify(first));expect(second.length).toBe(first.length+4);assertToolExchanges(second);
 }finally{db.close();}
});

it('gives a truncated execution response more output room before involving the agent',async()=>{
 const db=fixture();try{const sizes:number[]=[];
  const response=await infer({db,config:{url:'https://fixture.invalid',token:'fixture'},resume:0,input:{model:models.agent,system:'Write',messages:[{role:'user',content:'Write the scene'}],tools:[],purpose:'execution',max_tokens:16384,turnId:'turn'}},{fetch:async(_url,init)=>{sizes.push(JSON.parse(String(init?.body)).max_tokens);return Response.json(sizes.length===1?{content:[{type:'text',text:'partial'}],stop_reason:'max_tokens',usage:{}}:{content:[{type:'text',text:'complete'}],stop_reason:'end_turn',usage:{}});}});
  expect(response.content[0].text).toBe('complete');expect(sizes).toEqual([16384,32768]);
 }finally{db.close();}
});

it('routes a question from its words without a model call, and resumes interrupted work in the same conversation',async()=>{
 const db=fixture();try{
  const workspace={initialize:async()=>{},context:()=>({}),execute:async()=>({ok:true})};
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace);
  director.inference=async(_m,_s,_msgs,_t,_turn,_f,purpose='execution')=>{if(purpose==='routing')throw new SyntaxError('Unexpected token < in JSON');return{content:[{type:'text',text:'The video opens on a beach.'}],stop_reason:'end_turn',usage:{}};};
  await director.message('What happens in my video?');expect(db.getMeta('ai_status')).toBe('complete');expect(db.db.prepare("SELECT COUNT(*) AS n FROM ai_usage WHERE purpose='routing'").get()).toMatchObject({n:0});
  let fail=true;const seen:string[]=[];director.inference=async(_m,_s,messages:any,_t,_turn,_f,purpose='execution')=>{seen.push(JSON.stringify(messages));if(fail){fail=false;throw new Error('Network unavailable');}return{content:[{type:'tool_use',id:'pub',name:'publish_project',input:{}}],stop_reason:'tool_use',usage:{}};};
  (workspace as any).execute=async()=>({publication:{versionId:db.head(),assets:[]}});
  await director.message('Trim the first clip to 2 seconds');expect(db.getMeta('ai_status')).toBe('interrupted');
  const turn=JSON.parse(db.getMeta('pending_request')!).turnId;let finishNext=false;director.inference=async(_m,_s,messages:any)=>{seen.push(JSON.stringify(messages));if(finishNext)return toolUse('done','finish',{status:'complete',summary:'Trimmed.'});finishNext=true;return toolUse('pub','publish_project',{});};
  await director.resume('Keep the fade');expect(db.getMeta('ai_status')).toBe('complete');expect(JSON.parse(db.getMeta('pending_request')!).turnId).toBe(turn);
  expect(seen.at(-1)).toContain('Trim the first clip to 2 seconds');expect(seen.at(-1)).toContain('Keep the fade');
 }finally{db.close();}
});

it('enables the server-side refusal fallback for Opus, heals if the provider rejects it, and bills each attempt',async()=>{
 const {handleAI,resetFallbackSupport}=await import('../../supabase/functions/dream-gateway/ai');const {usageCost}=await import('../../supabase/functions/dream-gateway/inference-policy');
 const db={rpc:async()=>({data:'usage',error:null}),from:()=>({update:()=>({eq:async()=>({error:null})})})};
 const sent:{beta:string;fallbacks?:string}[]=[];let reject=false;
 const fetcher:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));sent.push({beta:new Headers(init?.headers).get('anthropic-beta')!,fallbacks:body.fallbacks});return reject&&body.fallbacks?Response.json({error:{type:'invalid_request_error',message:'fallbacks: not supported'}},{status:400}):Response.json({content:[{type:'text',text:'ok'}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}});};
 resetFallbackSupport();
 const request=(model:string,id:string)=>handleAI({model,messages:[{role:'user',content:'hi'}],requestId:id,max_tokens:1024},'user',{db,key:'fixture',fetcher});
 await request('claude-opus-5-5','a');await request('claude-haiku-5-5','b');
 expect(sent[0]).toMatchObject({fallbacks:'default'});expect(sent[0].beta).toContain('server-side-fallback-2026-07-01');expect(sent[1].fallbacks).toBeUndefined();expect(sent[1].beta).not.toContain('server-side-fallback');
 reject=true;sent.length=0;const healed=await request('claude-opus-5-5','c');expect(healed.status).toBe(200);expect(sent.map(s=>s.fallbacks)).toEqual(['default',undefined]);
 sent.length=0;await request('claude-opus-5-5','d');expect(sent.map(s=>s.fallbacks)).toEqual([undefined]);resetFallbackSupport();
 expect(usageCost('claude-opus-5-5',{iterations:[{type:'message',model:'claude-opus-5-5',input_tokens:1_000_000,output_tokens:0},{type:'fallback_message',model:'claude-opus-4-8',input_tokens:1_000_000,output_tokens:0}]},[4,20])).toBeCloseTo(9);
});

it('never executes or echoes the declined part of a response that fell back mid-stream',async()=>{
 const db=fixture();try{let calls=0;const executed:string[]=[],histories:any[]=[];
  const result=await codeAgent({db,turnId:'turn',model:models.agent,text:'Make the edit',signal:new AbortController().signal,publish:()=>{},workspace:{initialize:async()=>{},context:()=>({}),execute:async(name:string)=>{executed.push(name);return name==='publish_project'?{publication:{versionId:db.head(),assets:[],unchanged:true}}:{ok:true};}},
   infer:async(_m,_s,messages)=>{histories.push(JSON.parse(JSON.stringify(messages)));return infer({db,config:{url:'https://fixture.invalid',token:'fixture'},resume:0,input:{model:models.agent,system:'Edit',messages,tools:[],purpose:'execution',max_tokens:16384,turnId:'turn',phase:'fallback-'+calls}},{fetch:async()=>Response.json(calls++===0?{content:[{type:'thinking',thinking:'',signature:'declined'},{type:'tool_use',id:'declined-read',name:'list_files',input:{path:'.'}},{type:'text',text:'Looking at the project.'},{type:'fallback',from:{model:'claude-opus-5-5'},to:{model:'claude-opus-4-8'}},{type:'tool_use',id:'served-publish',name:'publish_project',input:{}}],stop_reason:'tool_use',usage:{}}:{content:[{type:'tool_use',id:'done',name:'finish',input:{status:'complete',summary:'Confirmed.'}}],stop_reason:'tool_use',usage:{}})});}});
  expect(result.outcome.status).toBe('complete');expect(executed).toEqual(['publish_project']);
  const replayed=JSON.stringify(histories.at(-1));expect(replayed).not.toContain('declined-read');expect(replayed).not.toContain('"signature":"declined"');expect(replayed).toContain('Looking at the project.');
 }finally{db.close();}
});

it('proposes computer file changes for approval, pauses, and resumes with the decision without proposing again',async()=>{
 const db=fixture();let proposals=0,status:'pending'|'complete'='pending';try{
  const ws=new CodeWorkspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg:'',ffprobe:'',files:async request=>{if(request.action!=='propose')return{entries:[]};proposals++;return{id:'proposal-1',title:request.title,changes:request.operations.map(operation=>({operation,exists:true,fingerprint:'f'})),status,completed:status==='complete'?1:0,createdAt:''};}},()=>{});
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,ws);let calls=0;
  director.inference=async(_m,_s,_msgs,_t,_turn,_f,purpose)=>purpose==='routing'?{content:[{type:'text',text:JSON.stringify({route:'local',intelligence:'haiku',complexity:'normal',reason:'File organization',approvalQuote:null})}],stop_reason:'end_turn',usage:{}}:[toolUse('files','propose_file_changes',{title:'Update notes',operations:[{kind:'write',path:'C:/notes.txt',text:'Edited notes'}]}),toolUse('pub','publish_project',{}),toolUse('done','finish',{status:'complete',summary:'Your notes are updated.'})][calls++] as any;
  await director.message('Organize notes');
  expect(db.getMeta('ai_status')).toBe('awaiting_file_permission');expect(JSON.parse(db.getMeta('file_wait')!)).toMatchObject({kind:'approval',proposal:{id:'proposal-1',status:'pending'}});
  status='complete';await director.resume();
  expect(db.getMeta('ai_status')).toBe('complete');expect(calls).toBe(3);expect(proposals).toBe(2);
 }finally{db.close();}
});

it('reverts files a scoped worker command changes outside its boundary and reports the command as failed',async()=>{
 const db=fixture();let root='';try{
  // The simulated command writes inside its scope, overwrites one worker's file, deletes another's folder, and rewrites project.json, which it does not own.
  const ws=new CodeWorkspace(db,{run:async request=>{mkdirSync(join(root,'src/title'),{recursive:true});writeFileSync(join(root,'src/title/scene.html'),'mine');writeFileSync(join(root,'src/outro/scene.html'),'clobbered');rmSync(join(root,'src/credits'),{recursive:true,force:true});writeFileSync(join(root,'project.json'),'{}');return{id:request.id,status:'complete',exitCode:0,output:'ok',startedAt:'',finishedAt:'',logPath:'',isolation:'windows-appcontainer',commandHash:''};},ffmpeg:'',ffprobe:''},()=>{});root=ws.root;
  await ws.initialize();mkdirSync(join(root,'src/outro'),{recursive:true});writeFileSync(join(root,'src/outro/scene.html'),'outro by another worker');mkdirSync(join(root,'src/credits'),{recursive:true});writeFileSync(join(root,'src/credits/scene.html'),'credits by another worker');const document=readFileSync(join(root,'project.json'),'utf8');
  await expect(ws.execute('run_command',{command:'node build.js'},'scoped','turn',new AbortController().signal,{writes:['src/title'],canPublish:false,taskId:'title'})).rejects.toThrow('outside the task scope');
  expect(readFileSync(join(root,'src/outro/scene.html'),'utf8')).toBe('outro by another worker');expect(readFileSync(join(root,'src/credits/scene.html'),'utf8')).toBe('credits by another worker');expect(readFileSync(join(root,'project.json'),'utf8')).toBe(document);expect(readFileSync(join(root,'src/title/scene.html'),'utf8')).toBe('mine');
 }finally{db.close();}
});

it('does not accept completion after a publication when later changes are unpublished, and never completes at the step limit',async()=>{
 const db=fixture(),ws=workspaceFor(db);let n=0,finishResult='';try{
  await ws.initialize();
  const result=await codeAgent({db,workspace:ws,turnId:'turn',model:models.agent,text:'Edit',signal:new AbortController().signal,publish:()=>{},infer:async(_m,_s,messages)=>{const step=n++;if(step===3)finishResult=JSON.stringify(messages.at(-1));return[toolUse('p1','publish_project',{}),toolUse('w','write_file',{path:'src/later.js',content:'const later=1;'}),toolUse('f1','finish',{status:'complete',summary:'Done.'}),toolUse('p2','publish_project',{}),toolUse('f2','finish',{status:'complete',summary:'Done.'})][step];}});
  expect(finishResult).toContain('unpublished changes');expect(finishResult).toContain('src/later.js');expect(result.outcome.status).toBe('complete');expect(ws.unpublishedChanges()).toEqual([]);
  let calls=0;const limited=await codeAgent({db,workspace:ws,turnId:'limit',model:models.agent,text:'Edit',signal:new AbortController().signal,publish:()=>{},infer:async()=>calls++===0?toolUse('p','publish_project',{}):toolUse('l'+calls,'list_files',{path:'.'})});
  expect(limited.outcome.status).toBe('blocked');expect(limited.outcome.summary).toContain('step limit');
 }finally{db.close();}
});

it('rebuilds a scene on the timeline when its source file is edited and published, without re-declaring it',async()=>{
 const db=fixture(),ws=workspaceFor(db);try{
  await ws.initialize();const path=join(ws.root,'project.json'),doc=JSON.parse(readFileSync(path,'utf8'));writeFileSync(join(ws.root,'src/title.html'),scene('blue title'));
  doc.outputs=[{id:'title',path:'src/title.html',kind:'scene',width:640,height:360,fps:30,durationInFrames:60}];doc.timeline.spine=[{id:'title',assetId:'output:title',srcIn:0,srcOut:2,speed:1,audio:{mute:true},reason:'Title'}];writeFileSync(path,JSON.stringify(doc));
  await ws.execute('publish_project',{},'first','turn',new AbortController().signal);const before=db.timeline().spine[0].assetId;
  // The revision only edits the scene file; project.json is untouched (outputs were emptied by the first publication).
  await ws.execute('edit_file',{path:'src/title.html',oldText:'blue title',newText:'sunset title'},'edit','turn',new AbortController().signal);
  const second=await ws.execute('publish_project',{},'second','turn',new AbortController().signal),after=db.timeline().spine[0].assetId;
  expect(after).not.toBe(before);expect(second.publication.versionId).toBe(db.head());expect(readFileSync(db.footage().assets.find(a=>a.id===after)!.originalPath,'utf8')).toContain('sunset title');expect(db.footage().assets.find(a=>a.id===after)!.durationSec).toBe(2);expect(ws.unpublishedChanges()).toEqual([]);
 }finally{db.close();}
});

it('plans with Opus and, when the user says "do it", runs the approved plan as one Sonnet agent',async()=>{
 const {approvesPlan}=await import('../../packages/orchestrator/src/code-director');
 for(const yes of ['do it','Edit','looks good, go ahead','ok','Apply the plan.'])expect(approvesPlan(yes)).toBe(true);
 for(const no of ['make the title red','looks good but make it shorter','edit the second step to use blue',''])expect(approvesPlan(no)).toBe(false);
 const db=fixture();try{
  const calls:{purpose:string;model:string}[]=[];let agent=0;
  const workspace={initialize:async()=>{},context:()=>({}),execute:async(name:string)=>name==='publish_project'?{publication:{versionId:db.head(),assets:[],unchanged:true}}:{ok:true}};
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace);
  director.inference=async(model,_s,_m,_t,_turn,_f,purpose='execution')=>{calls.push({purpose,model});
   if(purpose==='routing')return{content:[{type:'text',text:JSON.stringify({route:'plan',intelligence:'opus',complexity:'normal',reason:'Plan',approvalQuote:null})}],stop_reason:'end_turn',usage:{}};
   if(purpose==='planning')return toolUse('plan','finish',{status:'complete',summary:'Plan ready.',plan:{schemaVersion:1,title:'Title card',goal:'Add a title card',steps:[{id:'title',title:'Add the title card',instruction:'Create the title card',acceptance:'Title visible',review:false}],assumptions:[]}});
   return ++agent===1?toolUse('pub','publish_project',{}):toolUse('done','finish',{status:'complete',summary:'Added the title card.'});};
  await director.message('Plan a title card for the video',[],'plan');expect(db.getMeta('ai_status')).toBe('awaiting_approval');
  await director.message('do it');expect(db.getMeta('ai_status')).toBe('complete');
  expect(calls.find(c=>c.purpose==='planning')!.model).toBe(models.agent);
  const steps=calls.filter(c=>c.purpose==='execution');expect(steps.length).toBe(2);expect(steps.every(c=>c.model===models.agent)).toBe(true);
  expect([...new Set(calls.map(c=>c.purpose))].sort()).toEqual(['execution','planning']);
  expect(db.state().messages.some(m=>m.role==='user'&&m.text==='do it')).toBe(true);
 }finally{db.close();}
});
