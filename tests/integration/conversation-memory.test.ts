import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {ProjectContext} from '../../packages/orchestrator/src/context';

// Supply & Demand: "can you give me a script" was answered, then "genreate captions for this" wrote its own lines, because
// the next request saw only the first 700 characters of the script.
it('gives the next request the latest reply in full and earlier ones nearly so, with where to read the rest',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-memory-')));
 try{
  const old='Earlier answer. '.repeat(400),script='Beat 1: "Ever wonder why dirt is worthless?" '.repeat(120);
  db.message('user','what is this','t1');db.message('assistant',old,'t1');db.message('user','can you give me a script','t2');db.message('assistant',script,'t2');
  const recent=(new ProjectContext(db).initial('genreate captions for this') as any).recentDirection;
  const last=recent.at(-1),earlier=recent.find((m:any)=>m.text.startsWith('Earlier answer.'));
  expect(last.text).toBe(script.slice(0,8000));expect(script.length).toBeLessThan(8000);expect(last.rest).toBeUndefined();
  expect(earlier.text.length).toBe(2500);expect(earlier.rest).toMatch(/^read_file scope project id conversation:/);
 }finally{db.close();}
});
