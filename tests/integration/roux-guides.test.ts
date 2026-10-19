import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {codeAgent} from '../../packages/orchestrator/src/code-agent';
import {codePrompt,rouxPrompt,promptFor,guideInPrompt} from '../../packages/orchestrator/src/code-prompt';
import {editingGuide} from '../../packages/orchestrator/src/editing-guide';
import {sceneReference} from '../../packages/scene-engine/src/reference-parts';

/** Roux carries the editing and scene-engine guides in its cached prompt instead of reading the files each request
 * (code-prompt.ts); other models keep reading them when needed. */
it('gives DeepSeek the two guides in its prompt and leaves the other models reading the files',()=>{
 expect(rouxPrompt).toContain(editingGuide);expect(rouxPrompt).toContain(sceneReference);
 expect(rouxPrompt).not.toContain('read context/engine.md');expect(rouxPrompt).not.toContain('read context/editing.md');
 expect(codePrompt).not.toContain(sceneReference);expect(codePrompt).toContain('read context/engine.md');
 expect(promptFor('deepseek-flash')).toBe(rouxPrompt);expect(promptFor('claude-sonnet-5-5')).toBe(codePrompt);expect(promptFor('gpt-6.1-sol')).toBe(codePrompt);
 expect(guideInPrompt('deepseek-flash',{path:'context/engine.md'})).toBe(true);expect(guideInPrompt('deepseek-flash',{path:'./context\\editing.md'})).toBe(true);
 // The project-document guide stays a file, and so do files of the same name on the user's computer.
 expect(guideInPrompt('deepseek-flash',{path:'context/project.md'})).toBe(false);expect(guideInPrompt('deepseek-flash',{path:'context/engine.md',scope:'computer'})).toBe(false);
 expect(guideInPrompt('claude-sonnet-5-5',{path:'context/engine.md'})).toBe(false);
});

it('answers a Roux read of a guide with a short receipt, and sends Roux the prompt with the guides',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-roux-guides-')));let calls=0,system='',receipt='';
 try{db.setMeta('pending_request',JSON.stringify({turnId:'turn'}));
  const result=await codeAgent({db,workspace:{initialize:async()=>{},context:()=>({}),execute:async()=>({path:'context/engine.md',hash:'h',text:sceneReference})},turnId:'turn',text:'How do scenes get their fonts?',model:'deepseek-flash',readOnly:true,signal:new AbortController().signal,publish:()=>{},infer:async(_model,prompt,messages)=>{
   const n=calls++;if(!n)system=prompt;else receipt=JSON.stringify((messages as any[]).at(-1));
   return{content:[!n?{type:'tool_use',id:'read',name:'read_file',input:{path:'context/engine.md'}}:{type:'tool_use',id:'done',name:'finish',input:{status:'complete',summary:'Fonts load with the scene.',evidence:[]}}]};
  }});
  expect(result.outcome.status).toBe('complete');expect(system).toBe(rouxPrompt);
  expect(receipt).toContain('already in your instructions');expect(receipt).not.toContain('## @dream/engine');
 }finally{db.close();}
});
