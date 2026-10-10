import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
import {RunStream} from '../../packages/orchestrator/src/run-stream';
import {toolActivity} from '../../packages/orchestrator/src/activity';
import {parseCodeTool} from '../../packages/orchestrator/src/code-tools';
import {editingActivity} from '../../apps/desktop/src/renderer/editing-language';

it('streams progress notes from text and update-display thinking blocks, never other thinking, and preserves a specific tool label',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-editing-progress-')));try{
  db.setMeta('pending_request',JSON.stringify({turnId:'turn'}));const live=new RunStream(db,'turn','request',()=>{},true);
  live.accept({event:'dream_policy',data:{thinkingDisplay:'updates'}});
  // Under the updates display a thinking block holds only the model's progress note; its reasoning is never returned.
  live.accept({event:'content_block_start',data:{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}}});
  live.accept({event:'content_block_delta',data:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'I found your Minecraft textures; next I’ll write the script.'}}});
  live.accept({event:'content_block_stop',data:{type:'content_block_stop',index:0}});
  live.accept({event:'content_block_start',data:{type:'content_block_start',index:1,content_block:{type:'text',text:'The voiceover is longer than the video. I’m matching the footage to the narration.'}}});
  const events=db.turnActivity('turn')?.events??[];expect(events).toHaveLength(2);expect(events.every(e=>e.kind==='commentary')).toBe(true);expect(events[0].text).toContain('Minecraft textures');expect(events[1].text).toContain('voiceover is longer');
  db.setMeta('turn_activity:other',JSON.stringify({turnId:'other',events:[],tasks:[]}));const hidden=new RunStream(db,'other','request-2',()=>{},true);
  hidden.accept({event:'dream_policy',data:{thinkingDisplay:'omitted'}});hidden.accept({event:'content_block_start',data:{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'internal analysis'}}});hidden.finish({content:[{type:'thinking',thinking:'internal analysis'},{type:'tool_use',id:'t',name:'list_files',input:{}}],dream_policy:{thinkingDisplay:'omitted'}});
  expect((db.turnActivity('other')?.events??[]).some(e=>e.kind==='commentary')).toBe(false);
  const input:any=parseCodeTool('read_transcript',{assetId:'voice',progress:'Check the caption timing against the first spoken sentence'});expect(toolActivity('read_transcript',input)).toBe(input.progress);
  expect(editingActivity({...events[0],tool:'read_transcript',text:input.progress})).toBe(input.progress);
 }finally{db.close();}
});
