import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {Director} from '../../packages/orchestrator/src/legacy-director';
import {TaskPlanSchema,planDocument} from '@dream/contracts';
import {proposePlan,approvePlan,savePlanDraft} from '../../packages/orchestrator/src/workflow';

const plan=TaskPlanSchema.parse({schemaVersion:1,title:'A cohesive edit',goal:'Refine the format in two considered steps',steps:[{id:'motion',title:'Motion',instruction:'Set 60 fps with director guidance',acceptance:'Frame rate is 60'},{id:'format',title:'Format',instruction:'Set square 1080 dimensions',acceptance:'1080 square'}]});
function fixture(){return new ProjectDB(mkdtempSync(join(tmpdir(),'dream-workflow-')),'Workflow');}
const response=(content:any[])=>({content,stop_reason:'tool_use',usage:{}});

it('plans without mutations, exchanges director guidance twice, and resumes only the interrupted step',async()=>{
 const db=fixture(),director=new Director(db,async()=>({url:'unused',token:'unused'}),()=>{});let guidance=0,motion=0,format=0,fail=true;
 director.inference=async(_model,_system,messages,tools)=>{
  if(tools?.some((t:any)=>t.name==='submit_plan'))return response([{type:'tool_use',id:'plan',name:'submit_plan',input:plan}]);
  if(tools?.some((t:any)=>t.name==='submit_guidance')){guidance++;return response([{type:'tool_use',id:'guidance',name:'submit_guidance',input:{assessment:'Use the existing scene timing.',instructions:['Set the requested frame rate and retain all source cuts.'],needsUser:false}}]);}
  const text=String((messages[0] as any).content);
  if(text.includes('Current step: Motion')){motion++;return response(motion===1?[{type:'tool_use',id:'direction-1',name:'consult_director',input:{question:'How should I preserve timing?'}},{type:'tool_use',id:'fps',name:'apply_ops',input:{label:'Motion timing',ops:[{type:'set_project_settings',settings:{fps:60},reason:'Approved motion step'}]}}]:[{type:'tool_use',id:'direction-2',name:'consult_director',input:{question:'The timing is changed; what should the next step preserve?'}},{type:'tool_use',id:'done-motion',name:'report',input:{summary:'Motion timing is ready.',status:'complete',evidence:[{toolCallId:'fps',finding:'Frame rate saved.'}]}}]);}
  format++;if(format===1)return response([{type:'tool_use',id:'format',name:'apply_ops',input:{label:'Square format',ops:[{type:'set_project_settings',settings:{width:1080,height:1080},reason:'Approved format'}]}}]);if(fail){fail=false;throw new Error('Connection lost after format commit');}return response([{type:'tool_use',id:'done-format',name:'report',input:{summary:'Square format is ready.',status:'complete',evidence:[{toolCallId:'format',finding:'Square dimensions saved.'}]}}]);
 };
 try{
  const initial=db.head();await director.message('Plan the edit first',[],'plan');expect(db.head()).toBe(initial);expect(db.state().aiStatus).toBe('awaiting_approval');expect((db.state().taskPlan as any).plan.steps).toHaveLength(2);
  await director.approveTaskPlan(plan,initial,'approval');expect(db.state().aiStatus).toBe('interrupted');expect(guidance).toBe(2);expect(db.timeline().settings).toMatchObject({fps:60,width:1080,height:1080});const versions=db.state().versions.length;
  await director.resume();expect(db.state().aiStatus).toBe('complete');expect(motion).toBe(2);expect(guidance).toBe(2);expect(db.state().versions).toHaveLength(versions);
  await director.approveTaskPlan(plan,initial,'approval');expect(db.state().versions).toHaveLength(versions);db.undo();expect(db.timeline().settings).toMatchObject({fps:30,width:1920,height:1080});
 }finally{db.close();}
});

it('rejects stale or changed approvals and makes an exhausted task resumable rather than complete',async()=>{
 const db=fixture();try{
  const head=db.head();proposePlan(db,'turn',plan,[]);db.apply([{type:'set_project_settings',settings:{fps:60},reason:'Manual change'}],'Manual','manual',head);expect(()=>approvePlan(db,plan,head,'stale')).toThrow('changed');
  proposePlan(db,'turn',plan,[]);approvePlan(db,plan,db.head(),'valid');expect(()=>approvePlan(db,{...plan,goal:'Different'},db.head(),'valid')).toThrow('different plan');
  const director=new Director(db,async()=>({url:'unused',token:'unused'}),()=>{});let calls=0;
  director.inference=async(_m,_s,_messages,tools)=>{if(tools?.some((t:any)=>t.name==='select_route'))return response([{type:'tool_use',id:'route',name:'select_route',input:{route:'local'}}]);calls++;return response([...Array.from({length:41},(_,n)=>({type:'tool_use',id:`read-${n}`,name:'get_project',input:{}})),{type:'tool_use',id:'done',name:'report',input:{summary:'Inspection completed.',status:'complete',evidence:[{toolCallId:'read-40',finding:'Current project inspected.'}]}}]);};
  await director.message('Inspect the project');expect(db.state().aiStatus).toBe('interrupted');expect(calls).toBe(1);await director.resume();expect(db.state().aiStatus).toBe('complete');expect(calls).toBe(1);
 }finally{db.close();}
});

it('saves an editable plan revision and rejects stale approval without changing the timeline',()=>{
 const db=fixture();try{proposePlan(db,'draft',plan,[]);const head=db.head(),edited=planDocument(plan).replace('A cohesive edit','My revised edit');const saved=savePlanDraft(db,edited,0,head);expect(saved.revision).toBe(1);expect(saved.plan.title).toBe('My revised edit');expect(db.head()).toBe(head);expect(()=>approvePlan(db,saved.plan,head,'old',0)).toThrow('plan changed');expect(()=>savePlanDraft(db,edited,0,head)).toThrow('changed');approvePlan(db,saved.plan,head,'new',1);expect((db.loadState<any>('workflow:draft')).plan.title).toBe('My revised edit');}finally{db.close();}
});
