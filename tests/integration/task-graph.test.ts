import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {Director} from '../../packages/orchestrator/src/code-director';
import {validateDelegation} from '../../packages/orchestrator/src/code-tools';
import {runTaskGraph,retryable} from '../../packages/orchestrator/src/task-graph';
import type {WorkerReport} from '../../packages/orchestrator/src/code-agent';

const fixture=()=>new ProjectDB(mkdtempSync(join(tmpdir(),'dream-task-graph-')));
const text=(value:string)=>({content:[{type:'text',text:value}],stop_reason:'end_turn',usage:{}});
const toolUse=(id:string,name:string,input:any)=>({content:[{type:'tool_use',id,name,input}],stop_reason:'tool_use',usage:{}});
const route=(value:Record<string,unknown>)=>text(JSON.stringify({complexity:'normal',reason:'Fixture route',approvalQuote:null,...value}));
const report=(taskId:string,status:'complete'|'blocked'='complete'):WorkerReport=>({taskId,title:taskId,status,summary:status==='complete'?'done':'stuck'});

it('runs dependencies first, caps concurrency, skips dependents of a blocked task and reuses saved reports',async()=>{
 const order:string[]=[];let running=0,peak=0;
 const run=async(task:{id:string})=>{running++;peak=Math.max(peak,running);order.push('start:'+task.id);await new Promise(resolve=>setTimeout(resolve,5));running--;order.push('end:'+task.id);return report(task.id,task.id==='broken'?'blocked':'complete');};
 const tasks=[{id:'a',title:'a'},{id:'b',title:'b'},{id:'c',title:'c'},{id:'broken',title:'broken'},{id:'after-broken',title:'x',after:['broken']},{id:'join',title:'join',after:['a','b','c']}];
 const reports=await runTaskGraph(tasks,run,{concurrency:2});
 expect(peak).toBe(2);expect(order.indexOf('start:join')).toBeGreaterThan(Math.max(order.indexOf('end:a'),order.indexOf('end:b'),order.indexOf('end:c')));
 expect(reports.find(r=>r.taskId==='after-broken')).toMatchObject({status:'blocked',skipped:true});expect(order).not.toContain('start:after-broken');expect(reports.find(r=>r.taskId==='join')!.status).toBe('complete');
 // A resumed request returns completed reports without running those tasks again.
 const again:string[]=[];await runTaskGraph(tasks.slice(0,3),async t=>{again.push(t.id);return report(t.id);},{concurrency:4,done:{a:report('a')}});expect(again.sort()).toEqual(['b','c']);
 // A stop or permission error ends the whole graph.
 await expect(runTaskGraph([{id:'x',title:'x'},{id:'y',title:'y',after:['x']}],async()=>{throw new Error('Stopped.');},{concurrency:2})).rejects.toThrow('Stopped.');
 expect(retryable(report('a','blocked'))).toBe(true);expect(retryable({...report('a','blocked'),summary:'Waiting for the user to approve file changes.'})).toBe(false);expect(retryable({...report('a','blocked'),skipped:true})).toBe(false);
});

it('validates a task graph: known dependencies, no cycles, helpers never writing project.json, and safe writes for tasks that can overlap',()=>{
 const t=(id:string,extra:Record<string,unknown>={})=>({id,title:id,brief:'b',writes:[`src/${id}`],...extra});
 expect(()=>validateDelegation([t('a',{after:['missing']})])).toThrow('after must name other tasks');
 expect(()=>validateDelegation([t('a',{after:['b']}),t('b',{after:['a']})])).toThrow('cycle');
 expect(()=>validateDelegation([t('a'),t('join',{writes:['project.json'],after:['a']})])).toThrow('helpers write their own files');
 expect(()=>validateDelegation([t('a',{writes:['.']})])).toThrow('whole workspace');
 // Ordered tasks may write the same folder; tasks that can run at the same time may not.
 expect(()=>validateDelegation([t('a',{writes:['src/shared']}),t('b',{writes:['src/shared'],after:['a']})])).not.toThrow();
 expect(()=>validateDelegation([t('a',{writes:['src/shared']}),t('b',{writes:['src/shared/x']})])).toThrow('overlapping writes');
});

it('starts every helper of one call from the same cached snapshot, staggers them behind the first stream, retries a blocked helper once and reports changed files',async()=>{
 const db=fixture(),firsts:any[]=[],starts:{task:string;at:number}[]=[];let agentCalls=0,firstStreamAt=0;try{
  const workspace={initialize:async()=>{},context:()=>({}),snapshot:()=>({overview:{clips:0},media:[],capabilities:{engine:{version:1}},decisions:[]}),readContext:(paths:string[])=>paths.map(path=>({path,text:'export const shared=1;',truncated:false})),execute:async(name:string)=>name==='publish_project'?{publication:{versionId:db.head(),assets:[],unchanged:true}}:{ok:true}};
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace as any);
  const tries:Record<string,number>={};
  director.inference=async(_model,_system,messages,_tools=[],_turn,_force,purpose='execution',phase='main',extra:any={})=>{
   if(purpose==='routing')return route({route:'local',intelligence:'opus'});
   if(purpose==='execution'){agentCalls++;
    if(agentCalls===1)return toolUse('graph','delegate',{tasks:[{id:'one',title:'Scene one',brief:'Write src/one.tsx.',writes:['src/one'],context:['src/shared.ts']},{id:'two',title:'Scene two',brief:'Write src/two.tsx.',writes:['src/two']}]});
    if(agentCalls===3)return toolUse('done','finish',{status:'complete',summary:'Placed both scenes.'});
    const result=JSON.parse((messages as any[]).flatMap(m=>Array.isArray(m.content)?m.content:[]).find((b:any)=>b.type==='tool_result'&&b.tool_use_id==='graph').content);
    expect(result.reports.find((r:any)=>r.taskId==='one').changedFiles).toEqual(['src/one/scene.tsx']);expect(result.reports.find((r:any)=>r.taskId==='two')).toMatchObject({status:'complete',attempts:2});
    return toolUse('pub','publish_project',{});}
   const head=(messages as any)[0].content,task=phase.includes(':one')?'one':'two';
   if(!(messages as any[]).some(m=>m.role==='assistant')){firsts.push({task,head});starts.push({task,at:Date.now()});tries[task]=(tries[task]??0)+1;}
   if(task==='one'&&!firstStreamAt){await new Promise(resolve=>setTimeout(resolve,30));firstStreamAt=Date.now();extra.onStream?.();}
   const done=JSON.stringify(messages).includes('tool_result');
   if(task==='two'&&tries.two===1)return toolUse('stuck','finish',{status:'blocked',summary:'The first approach failed to compile.',nextAction:'Use a simpler layout.'});
   if(done)return toolUse(task+'-finish','finish',{status:'complete',summary:`Finished ${task}.`});
   return toolUse(task+'-write','write_file',{path:`src/${task}/scene.tsx`,content:'export default ()=>null;'});
  };
  await director.message('Make two scenes and place them');expect(db.getMeta('ai_status')).toBe('complete');
  // Every helper's first message opens with the same snapshot block, marked for caching; the task follows in its own block.
  const snapshots=firsts.map(f=>JSON.stringify(f.head[0]));expect(new Set(snapshots).size).toBe(1);expect(firsts[0].head[0].cache_control).toEqual({type:'ephemeral'});
  expect(firsts.find(f=>f.task==='one').head.at(-1).text).toContain('Context file src/shared.ts');
  // The second helper waited for the first helper's stream; the retry carries the earlier block reason.
  const two=starts.find(s=>s.task==='two')!;expect(two.at).toBeGreaterThanOrEqual(firstStreamAt);
  expect(firsts.filter(f=>f.task==='two').at(-1).head.at(-1).text).toContain('A previous attempt at this task was blocked: The first approach failed to compile.');
 }finally{db.close();}
});
