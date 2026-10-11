import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {sessionReport,formatReport} from '../../scripts/session-report';

it('reports each request of a session with its cost, model calls, largest context and moves to Opus',()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-report-')),db=new ProjectDB(folder,'Report');
 try{
  db.userMessage('Make it gloomy','t1');db.recordUsage({requestId:'a',turnId:'t1',model:'claude-haiku-5-5',costUsd:.01,usage:{input_tokens:100,cache_read_input_tokens:9000,cache_creation_input_tokens:900,output_tokens:300}});
  db.event('ai.escalation',{turnId:'t1',kind:'switch',model:'claude-opus-5-5',reason:'Repeated failure'});db.recordUsage({requestId:'b',turnId:'t1',model:'claude-opus-5-5',costUsd:.2,usage:{input_tokens:50,cache_read_input_tokens:0,cache_creation_input_tokens:20000,output_tokens:800}});
  db.message('assistant','Done.','t1',{status:'complete'});
  db.userMessage('How long is it?','t2');db.recordUsage({requestId:'c',turnId:'t2',model:'claude-haiku-5-5',costUsd:.002});db.message('assistant','30 seconds.','t2');
 }finally{db.close();}
 const rows=sessionReport(folder);
 expect(rows).toHaveLength(2);
 expect(rows[0]).toMatchObject({request:'Make it gloomy',status:'complete',calls:2,maxContextTokens:20050,escalations:[{kind:'switch',model:'opus',reason:'Repeated failure'}],byModel:{haiku:{calls:1},opus:{calls:1}}});
 expect(rows[0].costUsd).toBeCloseTo(.21);
 const text=formatReport(rows,rows);expect(text).toContain('opus (switch): Repeated failure');expect(text).toContain('Total: $0.212 (Opus $0.200)');
});
