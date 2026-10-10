import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {Director} from '../../packages/orchestrator/src/legacy-director';
import {TaskPlanSchema} from '@dream/contracts';
import {proposePlan} from '../../packages/orchestrator/src/workflow';
import {validateOutcome,exposeSavedReceipts} from '../../packages/orchestrator/src/outcomes';

const call=(id:string,name:string,input:unknown)=>({type:'tool_use',id,name,input});
const response=(...content:any[])=>({content,stop_reason:'tool_use',usage:{}});
const complete=(toolCallId:string)=>({status:'complete',summary:'Requested format saved.',evidence:[{toolCallId,finding:'Setting committed.'}]});
const edit=call('fps','apply_ops',{label:'Timing',ops:[{type:'set_project_settings',settings:{fps:60},reason:'Requested'}]});
function fixture(){const folder=mkdtempSync(join(tmpdir(),'dream-outcome-'));return{folder,db:new ProjectDB(folder,'Outcomes')};}
const director=(db:ProjectDB)=>new Director(db,async()=>({url:'unused',token:'unused'}),()=>{});

it('keeps a blocked step at its cursor across reopening and resumes without replaying committed edits',async()=>{
 const {folder,db:initial}=fixture();let db=initial;
 try{
  const plan=TaskPlanSchema.parse({schemaVersion:1,title:'Format',goal:'Save the format',steps:[{id:'fps',title:'Timing',instruction:'Set 60 fps',acceptance:'60 fps'},{id:'square',title:'Format',instruction:'Make square',acceptance:'1080 square'}]});
  proposePlan(db,'turn',plan,[]);const first=director(db);
  first.inference=async()=>response(edit,call('blocked','report',{status:'blocked',summary:'Timing saved, but the source is unavailable.',evidence:[{toolCallId:'fps',finding:'60 fps saved'}],nextAction:'Relink the missing source and resume.'}));
  await first.approveTaskPlan(plan,db.head(),'approve');
  expect(db.state().aiStatus).toBe('interrupted');let workflow=JSON.parse(db.getMeta('workflow:turn')!);expect(workflow).toMatchObject({cursor:0,status:'blocked',completed:[]});
  expect(workflow.blocked.nextAction).toContain('Relink');const versions=db.state().versions.length;
  db.close();db=new ProjectDB(folder);const second=director(db);let executions=0;
  second.inference=async(_m,_s,messages)=>{executions++;if(executions===1)expect(JSON.stringify(messages)).toContain('Source is relinked; continue');const text=String((messages[0] as any).content);return text.includes('Current step: Timing')?response(call('done','report',complete('fps'))):response(call('square','apply_ops',{label:'Square',ops:[{type:'set_project_settings',settings:{width:1080,height:1080},reason:'Requested'}]}),call('done-square','report',complete('square')));};
  await second.resume('Source is relinked; continue');workflow=JSON.parse(db.getMeta('workflow:turn')!);expect(workflow).toMatchObject({cursor:2,status:'complete'});expect(workflow.completed).toHaveLength(2);expect(executions).toBe(2);expect(db.state().versions).toHaveLength(versions+1);db.undo();expect(db.timeline().settings).toMatchObject({fps:30,width:1920});
 }finally{db.close();}
});

it('does not finish on bare text or a premature report before later edits',async()=>{
 const {db}=fixture();try{
  const ai=director(db);let requests=0;
  ai.inference=async()=>{requests++;return requests===1?response(call('premature','report',complete('fps')),edit):requests===2?response({type:'text',text:'All done.'}):response(call('done','report',complete('fps')));};
  const outcome=await ai.edit('60 fps','turn',[],false);expect(outcome.status).toBe('complete');expect(requests).toBe(3);expect(db.state().versions).toHaveLength(2);
  expect(db.state().messages.filter(m=>(m.report as any)?.outcome)).toHaveLength(1);expect(db.getMeta('reported:turn:edit:premature')).toBeUndefined();
 }finally{db.close();}
});

it('pauses repeated text-only responses and rejects invented or failed evidence',async()=>{
 const {db}=fixture();try{
  const ai=director(db);let requests=0;ai.inference=async()=>{requests++;return response({type:'text',text:'Done'});};
  await expect(ai.edit('Finish','turn',[],false)).rejects.toThrow('validated outcome');expect(requests).toBe(2);expect(JSON.parse(db.getMeta('editor_checkpoint')!).finished).toBe(false);
  expect(()=>validateOutcome(complete('missing'),[],[],[])).toThrow('successful');
  expect(()=>validateOutcome(complete('fps'),[],[edit],[{type:'tool_result',tool_use_id:'fps',is_error:true,content:'Failed'}])).toThrow('successful');
 }finally{db.close();}
});

// Providers may not expose protocol-generated tool IDs to the model. References must be in content.
it('makes successful execution references visible, including restored image and text results',()=>{
 const messages:any[]=[{role:'user',content:[{type:'tool_result',tool_use_id:'saved',content:'{"fps":60}'},{type:'tool_result',tool_use_id:'image',content:[{type:'image',source:{type:'base64',data:'abc'}}]},{type:'tool_result',tool_use_id:'failed',is_error:true,content:'Error'}]}];
 exposeSavedReceipts(messages);exposeSavedReceipts(messages);
 expect(messages[0].content[0].content).toHaveLength(2);expect(messages[0].content[0].content[0].text).toContain('saved');expect(messages[0].content[1].content[0].text).toContain('image');expect(messages[0].content[1].content[1].type).toBe('image');expect(messages[0].content[2].content).toBe('Error');
});
