import {it,expect,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {engineBudgets} from '@dream/config';
import {agentProject,addSource,use,say} from '../fixtures/agent-project';
import {turnLog} from '../../apps/project-service/src/turn-log';
import {SUMMARY_MARK} from '../../packages/agent/src/compact';

/** Roux 2: one conversation per project, one loop for every request, the tools on the project's files. These run the real
 * agent and workspace against a scripted gateway: no model is called. */

const clip=(assetId:string,srcIn=0,srcOut=4)=>`"spine": [{"id":"c1","assetId":"${assetId}","srcIn":${srcIn},"srcOut":${srcOut},"speed":1,"reason":"Opening"}],`;
const projectText=(folder:string)=>readFileSync(join(folder,'Workspace','project.json'),'utf8');
const textOf=(block:any)=>typeof block?.content==='string'?block.content:(block?.content??[]).filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n');
const saved=(db:any)=>db.loadState('agent-session');
const budgets={...engineBudgets};
afterEach(()=>{Object.assign(engineBudgets,budgets);});

it('does a simple edit in a few calls with no other call first, applies it as it is written, and replies in its own words',async()=>{
 const run=await agentProject((body,step)=>[
  [say('I\'ll put the clip in.'),use('e','edit',{path:'project.json',oldText:'"spine": [],',newText:clip('a_fixture000000000000000001')})],
  [say('The clip opens the video now.')]][step]??[],{name:'Untitled project'});
 try{
  addSource(run.db,{words:[[0,.5,'Hello'],[.6,1,'there.']]});
  await run.agent.message('Put the interview in',[],'auto',[],'turn-1');
  // Two calls, both the agent's: no triage, routing or planning call before it.
  expect(run.gateway.bodies.map(b=>b.purpose)).toEqual(['execution','execution']);
  expect(run.db.timeline().spine.map((c:any)=>c.assetId)).toEqual(['a_fixture000000000000000001']);
  expect(textOf(run.gateway.returned('e'))).toMatch(/Applied: /);
  expect(run.db.state().messages.at(-1)).toMatchObject({role:'assistant',text:'The clip opens the video now.',report:{kind:'completion',status:'complete'}});
  expect(run.db.getMeta('ai_status')).toBe('complete');
  // The opening holds the project memory and the footage; the request carries the edit as it is and a reminder to name it.
  const first=run.gateway.bodies[0].messages[0].content;
  expect(first[0].cache_control).toEqual({type:'ephemeral'});expect(first[0].text).toContain('<project-memory path="GUMBO.md">');expect(first[0].text).toContain('interview.mp4');
  expect(first[1].text).toContain('Put the interview in');expect(first[1].text).toContain('The edit is empty');expect(first[1].text).toContain('name it with title');
  // The same system prompt and tools on every call, in every mode, so the prefix stays cached.
  expect(new Set(run.gateway.bodies.map(b=>JSON.stringify([b.system,b.tools]))).size).toBe(1);
 }finally{run.close();}
});

it('keeps one conversation across requests: a follow-up reads the earlier exchange from the cache, opening unchanged',async()=>{
 const run=await agentProject((_body,step)=>step===0?[say('Done.')]:[]);
 try{
  await run.agent.message('Make it punchy',[],'auto',[],'turn-1');
  addSource(run.db,{id:'a_fixture000000000000000002',filename:'broll.mp4'});
  await run.agent.message('Now the other one',[],'auto',[],'turn-2');
  const [a,b]=run.gateway.bodies;
  expect(JSON.stringify(b.messages[0])).toBe(JSON.stringify(a.messages[0]));
  expect(b.messages.map((m:any)=>m.role)).toEqual(['user','assistant','user']);expect(b.messages[1].content).toEqual([{type:'text',text:'Done.'}]);
  // Footage that arrived after the opening is announced with the message that follows it, once.
  expect(b.messages.at(-1).content.at(-1).text).toContain('New footage since this conversation last heard about footage');
  expect(b.messages.at(-1).content.at(-1).text).toContain('broll.mp4');
  expect(saved(run.db).turns).toEqual({'turn-1':0,'turn-2':2});
 }finally{run.close();}
});

it('plans without changing anything, waits for approval, then carries the plan out in the same conversation',async()=>{
 const plan={schemaVersion:1,title:'Tighten',goal:'Tighten the opening',steps:[{id:'cut',title:'Cut the pause',instruction:'Remove the pause at 2 s',acceptance:'No pause',review:false}],assumptions:[]};
 const run=await agentProject((body,step)=>{
  if(body.purpose==='planning')return step===0?[use('w','write',{path:'notes.txt',content:'x'})]:[use('p','propose_plan',plan)];
  return step===0?[use('t','todo',{tasks:[{id:'cut',title:'Cut the pause',status:'running'}]})]:[say('Cut the pause.')];
 });
 try{
  await run.agent.message('Tighten the opening',[],'plan',[],'turn-1');
  // Plan mode refuses changes and ends on the proposal, waiting for the user.
  expect(textOf(run.gateway.returned('w'))).toMatch(/Plan mode changes nothing/);
  expect(run.db.getMeta('ai_status')).toBe('awaiting_approval');expect(JSON.parse(run.db.getMeta('task_plan')!).plan.goal).toBe('Tighten the opening');
  // "go ahead" approves it; the conversation carries on with the plan as approved.
  await run.agent.message('go ahead',[],'auto',[],'turn-2');
  const execution=run.gateway.bodies.filter(b=>b.purpose==='execution');
  if(!execution.length)throw new Error(JSON.stringify({status:run.db.getMeta('ai_status'),messages:run.db.state().messages.map((m:any)=>m.text),purposes:run.gateway.bodies.map(b=>b.purpose)}));
  expect(execution[0].messages.at(-1).content.map((b:any)=>b.text??'').join('')).toContain('I approve the plan. Carry it out now.');
  expect(execution[0].messages[0]).toEqual(run.gateway.bodies[0].messages[0]);
  expect(run.db.getMeta('ai_status')).toBe('complete');expect(run.db.getMeta('task_plan')).toBe('');
  expect(run.events.some(e=>e.type==='ai.tasks'&&e.payload.tasks[0].id==='cut')).toBe(true);
 }finally{run.close();}
});

it('answers without changing anything when asked a question, and a question back ends the run',async()=>{
 const run=await agentProject((body,step)=>body.purpose==='answering'?[[use('w','write',{path:'x.txt',content:'x'})],[say('It is 4 seconds long.')]][step]??[]:[say('Which clip: the interview or the b-roll?')]);
 try{
  await run.agent.message('How long is it?',[],'ask',[],'turn-1');
  expect(textOf(run.gateway.returned('w'))).toMatch(/only looks and reads/);
  expect(run.db.state().messages.at(-1)).toMatchObject({text:'It is 4 seconds long.',report:{kind:'answer'}});
  // A question back is a reply like any other: the run ends, and the answer comes as the next message.
  await run.agent.message('Trim the clip',[],'auto',[],'turn-2');
  expect(run.db.state().messages.at(-1)?.text).toBe('Which clip: the interview or the b-roll?');expect(run.db.getMeta('ai_status')).toBe('complete');
 }finally{run.close();}
});

it('finds a spoken line in the footage files with grep, and reviews the cut in playback order',async()=>{
 const run=await agentProject((_body,step)=>[
  [use('g','grep',{pattern:'price',path:'footage'})],
  [use('e','edit',{path:'project.json',oldText:'"spine": [],',newText:clip('a_fixture000000000000000001',10,14.5)})],
  [use('r','review',{frames:false})],
  [say('The price line opens the video.')]][step]??[]);
 try{
  addSource(run.db,{durationSec:30,words:[[1,1.4,'Welcome'],[1.5,2,'back.'],[10.2,10.5,'The'],[10.6,11,'price'],[11.1,11.4,'is'],[11.5,12,'twelve'],[12.1,12.6,'dollars.'],[20,20.5,'Bye.']]});
  await run.agent.message('Open on where she says the price',[],'auto',[],'turn-1');
  expect(textOf(run.gateway.returned('g'))).toMatch(/footage\/interview-a_fixture000000000000000001\/transcript\.txt:\d+: \[10\.2-12\.6\] The price is twelve dollars\./);
  const review=textOf(run.gateway.returned('r'));
  expect(review).toMatch(/1\. 0\.0-4\.5 c1 \[interview\.mp4 10\.0-14\.5\]\n {3}"The price is twelve dollars\."/);
  expect(review).toContain('Checks: no cut inside a word');
 }finally{run.close();}
});

it('hands a wide look to a helper with its own conversation, which can read but not change anything',async()=>{
 const run=await agentProject((body,step)=>{
  if(body.purpose==='subagent')return step===0?[use('hr','read',{path:'footage/INDEX.md'}),use('hw','write',{path:'x.txt',content:'x'})]:[say('The interview is the only source: 30 s, one speaker.')];
  return[[use('t','task',{title:'Going through the footage',prompt:'List every source and what is in it.'})],[say('Done.')]][step]??[];
 });
 try{
  addSource(run.db,{durationSec:30});
  await run.agent.message('What do I have?',[],'auto',[],'turn-1');
  const helper=run.gateway.bodies.filter(b=>b.purpose==='subagent');
  expect(helper).toHaveLength(2);
  // Its own conversation, opening with the same cached session start, and the same prompt and tools.
  expect(helper[0].messages[0].content[0].text).toBe(run.gateway.bodies[0].messages[0].content[0].text);expect(helper[0].system).toBe(run.gateway.bodies[0].system);
  expect(JSON.stringify(helper[1].messages)).toMatch(/only looks and reads/);
  expect(textOf(run.gateway.returned('t'))).toBe('The interview is the only source: 30 s, one speaker.');
  // The main conversation holds the report, never the helper's reading.
  expect(JSON.stringify(saved(run.db).messages)).not.toContain('footage/INDEX.md: lines');
  expect(run.db.turnUsage('turn-1').rows.some((r:any)=>r.owner.startsWith('task:'))).toBe(true);
 }finally{run.close();}
});

it('pauses to check in after half a dollar of spending, and continue goes on from there',async()=>{
 let calls=0;
 const run=await agentProject(()=>{calls++;return calls<5?[use('l'+calls,'list',{path:'.'})]:[say('Done.')];},{usage:()=>({input_tokens:150_000,output_tokens:100})});
 try{
  await run.agent.message('Go through everything',[],'auto',[],'turn-1');
  // Each call costs about 30 cents on Sonnet: after two the run pauses before a third.
  expect(calls).toBe(2);expect(run.db.getMeta('ai_status')).toBe('interrupted');
  expect(run.db.state().messages.at(-1)).toMatchObject({text:expect.stringMatching(/I've paused to check in: this part used about \d+ credits/),report:{status:'paused'}});
  await run.agent.resume();expect(calls).toBe(4);
 }finally{run.close();}
});

it('stops at once; a resume never runs a finished call again, and the model hears what the stop cut short',async()=>{
 const ran:string[]=[];
 const run=await agentProject((_body,step)=>step===0?[use('w','write',{path:'notes.txt',content:'kept'}),use('c','run',{command:'sleep 60'})]:[say('Done.')],
  {workspace:{run:async(request,signal)=>{ran.push(request.id);await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));return{id:request.id,status:'cancelled',exitCode:null,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),output:'',logPath:'',isolation:'local',commandHash:''};}}});
 try{
  const started=run.agent.message('Write notes and run it',[],'auto',[],'turn-1');
  await new Promise(resolve=>setTimeout(resolve,300));run.agent.cancel();await started;
  expect(run.db.getMeta('ai_status')).toBe('interrupted');expect(run.db.state().messages.at(-1)?.text).toBe('Stopped.');
  await run.agent.resume();
  // The write that finished is not done again, and the stopped command is not started again by itself: the model hears
  // it was stopped and decides.
  expect(readFileSync(join(run.folder,'Workspace','notes.txt'),'utf8')).toBe('kept');expect(ran).toHaveLength(1);
  expect(textOf(run.gateway.returned('c'))).toMatch(/^Stopped/);expect(run.db.getMeta('ai_status')).toBe('complete');
  const toolResults=saved(run.db).messages.flatMap((m:any)=>Array.isArray(m.content)?m.content.filter((b:any)=>b.type==='tool_result'):[]);
  expect(toolResults.filter((b:any)=>/^w-/.test(b.tool_use_id))).toHaveLength(1);
 }finally{run.close();}
});

it('compacts a conversation that outgrows its budget into a summary, keeping its opening and recent exchanges',async()=>{
 engineBudgets.workingInput=4000;
 let summaries=0,calls=0;
 // Counted by calls, not steps: a compaction shortens the conversation the steps are counted in.
 const run=await agentProject(()=>++calls<=6?[say('x'.repeat(4000)),use('l'+calls,'list',{path:'.'})]:[say('Done.')],{helper:body=>{if(body.purpose==='compaction'){summaries++;return'Requests: make a long edit.\nOpen: finish it.';}return'Fixture.';}});
 try{
  await run.agent.message('A long job',[],'auto',[],'turn-1');
  expect(summaries).toBeGreaterThan(0);
  const session=saved(run.db),opening=run.gateway.bodies[0].messages[0].content[0];
  expect(session.messages[0].content[0]).toEqual(opening);
  expect(session.messages[0].content.at(-1).text.startsWith(SUMMARY_MARK)).toBe(true);
  expect(session.compactions).toBeGreaterThan(0);expect(run.db.getMeta('ai_status'),run.db.state().messages.at(-1)?.text).toBe('complete');
  // Every call after a compaction still opens with the same cached block.
  for(const body of run.gateway.agentCalls())expect(body.messages[0].content[0].text).toBe(opening.text);
 }finally{run.close();}
});

it('tells the next request what the user changed by hand since its last edit',async()=>{
 const run=await agentProject((_body,step)=>step===0?[use('e','edit',{path:'project.json',oldText:'"spine": [],',newText:clip('a_fixture000000000000000001')})]:[say('Done.')]);
 try{
  addSource(run.db);
  await run.agent.message('Add the clip',[],'auto',[],'turn-1');
  // The user undoes it by hand.
  const v=run.db.writeVersion({...run.db.timeline(),spine:[]},run.db.head(),'Removed clip c1',null);run.db.db.prepare('UPDATE branches SET head_id=? WHERE id=?').run(v,'main');
  await run.agent.message('Make it brighter',[],'auto',[],'turn-2');
  const asked=run.gateway.bodies.find(b=>JSON.stringify(b.messages.at(-1)).includes('Make it brighter'))!;
  expect(asked.messages.at(-1).content.at(-1).text).toContain('The user changed the edit by hand since your last edit: Removed clip c1');
 }finally{run.close();}
});

it('writes an edit log from the request\'s part of the conversation, with each tool\'s input and result',async()=>{
 const run=await agentProject((_body,step)=>step===0?[use('l','list',{path:'.'})]:[say('Here are the files.')]);
 try{
  await run.agent.message('What files are there?',[],'ask',[],'turn-1');
  const log=turnLog(run.db,'turn-1') as any;
  expect(log.version).toBe(3);expect(log.outcome.status).toBe('complete');
  expect(log.tools).toEqual([expect.objectContaining({tool:'list',input:{path:'.'},status:'complete'})]);expect(String(log.tools[0].result)).toContain('project.json');
  expect(log.conversation[0].messages.length).toBeGreaterThan(2);
 }finally{run.close();}
});

it('sets up the workspace: memory, guides, history and footage files, and no files from earlier versions of Gumbo',async()=>{
 const run=await agentProject(()=>[]);
 try{
  addSource(run.db,{words:[[0,1,'Hi.']]});run.workspace.footage.refresh();
  const root=join(run.folder,'Workspace'),read=(path:string)=>readFileSync(join(root,path),'utf8');
  expect(read('GUMBO.md')).toContain('## Preferences');expect(read('guides/editing.md')).toContain('Condensing long footage');expect(read('guides/project.md')).toContain('project.json');
  expect(read('HISTORY.md')).toContain('(current)');expect(read('footage/INDEX.md')).toContain('interview.mp4');
  expect(read('footage/interview-a_fixture000000000000000001/transcript.txt')).toContain('[0.0-1.0] Hi.');
  expect(projectText(run.folder)).toContain('"baseVersionId"');
 }finally{run.close();}
});
