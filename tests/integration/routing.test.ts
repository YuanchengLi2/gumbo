import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
import {Director} from '../../packages/orchestrator/src/legacy-director';
it('uses a structured router result and answers questions on an empty timeline',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-routing-')),'Routing');try{
  const director=new Director(db,async()=>({url:'unused',token:'unused'}),()=>{});let calls=0;
  director.inference=async(_model,_system,_messages,tools,_turnId,forceTool)=>{calls++;if(calls===1){expect(forceTool).toBe('select_route');expect(tools).toEqual(expect.arrayContaining([expect.objectContaining({name:'select_route'})]));return{content:[{type:'text',text:'Optional commentary with ```json fences is not parsed.'},{type:'tool_use',name:'select_route',id:'route',input:{route:'question'}}],stop_reason:'tool_use',usage:{}};}return{content:[{type:'text',text:'Your project has no imported footage.'}],stop_reason:'end_turn',usage:{}};};
  await director.message('What is in this project?');expect(db.state().aiStatus).toBe('complete');expect(db.state().outline).toBeNull();expect(db.state().messages.at(-1)?.text).toBe('Your project has no imported footage.');expect(calls).toBe(2);
 }finally{db.close();}
});
