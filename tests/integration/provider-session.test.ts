import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {providerSession} from '../../packages/orchestrator/src/provider-session';
it('replays signed thinking only for its exact account, model, tools, system and message prefix',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-binding-')),'Binding');
 try{
  const config={url:'https://fixture',token:'token',accountId:'account'},input={turnId:'turn',purpose:'routine',model:'claude-sonnet-5-5',system:'Edit',tools:[{name:'read'}],messages:[{role:'user',content:'Keep dialogue.'}]};
  const response=[{type:'thinking',thinking:'opaque',signature:'signed'},{type:'tool_use',id:'read',name:'read',input:{}}];
  const first=providerSession(db,config,input);first.record(response);
  const messages=[...input.messages,{role:'assistant',content:response},{role:'user',content:[{type:'tool_result',tool_use_id:'read',content:'Saved'}]}];
  expect(providerSession(db,config,{...input,messages}).messages[1].content).toEqual(response);
  for(const change of [{system:'Changed'},{tools:[{name:'read'},{name:'write'}]},{model:'claude-opus-5-5'},{messages:[{role:'user',content:'Compacted'},...messages.slice(1)]}]){
   const view=providerSession(db,config,{...input,messages,...change});expect(JSON.stringify(view.messages)).not.toContain('signed');expect(JSON.stringify(view.messages)).toContain('tool_result');
  }
  expect(JSON.stringify(providerSession(db,{...config,accountId:'other'},{...input,messages}).messages)).not.toContain('signed');
  expect(messages[1].content).toEqual(response);
 }finally{db.close();}
});
