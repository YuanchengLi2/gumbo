import {it,expect,vi} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {sourceInspector} from '../../apps/project-service/src/source-frames';
import {quickSourceInspector} from '../../apps/project-service/src/quick-context';
import {initialMediaContext} from '../../packages/orchestrator/src/media-context';

it('extracts and caches timestamped CRV images locally, then supplies them to the editing request',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-quick-context-')),'Context');
 const original={binary:process.env.DREAM_CONTEXT_BINARY,python:process.env.DREAM_CONTEXT_PYTHON,script:process.env.DREAM_CONTEXT_SCRIPT};
 process.env.DREAM_CONTEXT_BINARY='';process.env.DREAM_CONTEXT_PYTHON=resolve('apps/ingest-worker/.venv/Scripts/python.exe');process.env.DREAM_CONTEXT_SCRIPT=resolve('apps/ingest-worker/src/dream_ingest/context.py');
 const authorize=vi.fn(async()=>{});
 try{
  db.saveAsset(AssetSchema.parse({id:'source',filename:'source.mp4',kind:'video',durationSec:6,width:640,height:360,fps:30,originalPath:resolve('artifacts/fixtures/source.mp4'),fingerprint:'context-fixture',status:'ready'}));
  db.inspectSource=quickSourceInspector(db,ffmpeg!,ffprobe.path,sourceInspector(db,ffmpeg!,authorize),authorize);
  db.setMeta('pending_request',JSON.stringify({turnId:'turn',assetIds:['source']}));
  const first=await db.inspectSource({assetId:'source',startSec:0,endSec:6,detail:'overview'});
  expect(first.frames.length).toBeGreaterThan(0);expect(first.frames.length).toBeLessThanOrEqual(12);
  expect(first.frames.every(f=>f.timeSec>=0&&f.timeSec<6&&f.data.startsWith('/9j/'))).toBe(true);
  expect(first.frames.map(f=>f.timeSec)).toEqual(first.frames.map(f=>f.timeSec).sort((a,b)=>a-b));
  const before=db.state().eventCursor,again=await db.inspectSource({assetId:'source',startSec:0,endSec:6,detail:'overview'});
  expect(again).toEqual(first);expect(db.events(before).some(e=>e.type==='media.context')).toBe(false);
  const input=await initialMediaContext(db,'turn');expect(input.filter(b=>b.type==='image').length).toBeGreaterThanOrEqual(3);expect(JSON.stringify(input)).toContain('source.mp4');
  expect(authorize).toHaveBeenCalledTimes(3);
 }finally{db.close();for(const [field,value]of Object.entries(original)){const key='DREAM_CONTEXT_'+field.toUpperCase();if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
