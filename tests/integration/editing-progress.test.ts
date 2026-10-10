import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
import {RunStream} from '../../packages/orchestrator/src/run-stream';
import {toolActivity} from '../../packages/orchestrator/src/activity';
import {parseCodeTool} from '../../packages/orchestrator/src/code-tools';
import {editingActivity} from '../../apps/desktop/src/renderer/editing-language';

it('streams public editing updates without showing private analysis and preserves a specific tool label',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-editing-progress-')));try{
  db.setMeta('pending_request',JSON.stringify({turnId:'turn'}));const live=new RunStream(db,'turn','request',()=>{},true);
  live.accept({event:'dream_policy',data:{thinkingDisplay:'updates'}});
  live.accept({event:'content_block_start',data:{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'private internal analysis'}}});
  live.accept({event:'content_block_start',data:{type:'content_block_start',index:1,content_block:{type:'text',text:'The voiceover is longer than the video. I’m matching the footage to the narration.'}}});
  const events=db.turnActivity('turn')?.events??[];expect(events).toHaveLength(1);expect(events[0].kind).toBe('commentary');expect(events[0].text).toContain('voiceover is longer');
  const input:any=parseCodeTool('read_transcript',{assetId:'voice',progress:'Check the caption timing against the first spoken sentence'});expect(toolActivity('read_transcript',input)).toBe(input.progress);
  expect(editingActivity({...events[0],tool:'read_transcript',text:input.progress})).toBe(input.progress);
 }finally{db.close();}
});
