import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {TaskPlanSchema,planDocument} from '@dream/contracts';
import {proposePlan,approvePlan,savePlanDraft} from '../../packages/orchestrator/src/workflow';

const plan=TaskPlanSchema.parse({schemaVersion:1,title:'A cohesive edit',goal:'Refine the format in two considered steps',steps:[{id:'motion',title:'Motion',instruction:'Set 60 fps with director guidance',acceptance:'Frame rate is 60'},{id:'format',title:'Format',instruction:'Set square 1080 dimensions',acceptance:'1080 square'}]});
function fixture(){return new ProjectDB(mkdtempSync(join(tmpdir(),'dream-workflow-')),'Workflow');}
const response=(content:any[])=>({content,stop_reason:'tool_use',usage:{}});

it('saves an editable plan revision and rejects stale approval without changing the timeline',()=>{
 const db=fixture();try{proposePlan(db,'draft',plan,[]);const head=db.head(),edited=planDocument(plan).replace('A cohesive edit','My revised edit');const saved=savePlanDraft(db,edited,0,head);expect(saved.revision).toBe(1);expect(saved.plan.title).toBe('My revised edit');expect(db.head()).toBe(head);expect(()=>approvePlan(db,saved.plan,head,'old',0)).toThrow('plan changed');expect(()=>savePlanDraft(db,edited,0,head)).toThrow('changed');approvePlan(db,saved.plan,head,'new',1);expect((db.loadState<any>('workflow:draft')).plan.title).toBe('My revised edit');}finally{db.close();}
});
