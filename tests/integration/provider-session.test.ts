import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {providerSession} from '../../packages/agent/src/provider-session';
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
  // Claude's thinking without a signature is never sent back.
  const unsigned=[{type:'thinking',thinking:'unsigned'},{type:'tool_use',id:'read',name:'read',input:{}}];providerSession(db,config,input).record(unsigned);
  expect(JSON.stringify(providerSession(db,config,{...input,messages:[...input.messages,{role:'assistant',content:unsigned},messages[2]]}).messages)).not.toContain('"unsigned"');
 }finally{db.close();}
});

it('replays DeepSeek\'s thinking whatever came before it, signed or not, but only to the same model and account',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-binding-ds-')),'Binding');
 try{
  const config={url:'https://fixture',token:'token',accountId:'account'},input={turnId:'turn',purpose:'execution',model:'deepseek-flash',system:'Edit',tools:[{name:'look'}],profile:{effort:'high'},messages:[{role:'user',content:'Trim'}]};
  const signed=[{type:'thinking',thinking:'The intro runs 4s.',signature:'ds-sig'},{type:'tool_use',id:'look',name:'look',input:{}}],unsigned=[{type:'thinking',thinking:'Now cut.'},{type:'tool_use',id:'cut',name:'cut',input:{}}];
  providerSession(db,config,input).record(signed);
  const messages=[...input.messages,{role:'assistant',content:signed},{role:'user',content:[{type:'tool_result',tool_use_id:'look',content:'Seen'}]}];
  providerSession(db,config,{...input,messages}).record(unsigned);
  const later=[...messages,{role:'assistant',content:unsigned},{role:'user',content:[{type:'tool_result',tool_use_id:'cut',content:'Done'}]}];
  // An earlier message rewritten (a picture swapped for its note, a compaction), another effort or system prompt: kept.
  for(const change of [{},{messages:[{role:'user',content:'Trim (picture seen)'},...later.slice(1)]},{profile:{effort:'low'}},{system:'Edit, v2'}]){
   const view=providerSession(db,config,{...input,messages:later,...change}).messages;expect(view[1].content).toEqual(signed);expect(view[3].content).toEqual(unsigned);
  }
  // Another model or account never gets them.
  for(const view of [providerSession(db,config,{...input,model:'claude-haiku-5-5',messages:later}),providerSession(db,{...config,accountId:'other'},{...input,messages:later})])expect(JSON.stringify(view.messages)).not.toMatch(/ds-sig|Now cut/);
 }finally{db.close();}
});
