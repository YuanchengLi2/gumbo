import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {TimelineSchema,resolve} from '@dream/timeline';
import {AssetSchema} from '@dream/footage';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';
import {publishWorkspace} from '../../apps/project-service/src/code-publication';
import {ProjectContext} from '../../packages/orchestrator/src/context';

it('publishes audio-only timelines without annotations and derives a playable duration',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-audio-contract-')),db=new ProjectDB(root);try{
  const ws=new CodeWorkspace(db,{run:async()=>{throw Error('unexpected');},ffmpeg:'',ffprobe:''},()=>{});await ws.initialize();db.saveAsset(AssetSchema.parse({id:'music',filename:'music.wav',kind:'audio',durationSec:30,hasAudio:true,originalPath:join(root,'music.wav'),fingerprint:'fixture',status:'ready'}));
  const path=join(root,'Workspace/project.json'),doc=JSON.parse(readFileSync(path,'utf8'));doc.timeline.music=[{id:'theme',assetId:'music',srcIn:0,srcOut:30,start:{kind:'project',at:'start',offsetSec:0}}];writeFileSync(path,JSON.stringify(doc));
  await publishWorkspace(db,{id:'audio',status:'complete',exitCode:0,startedAt:'fixture',finishedAt:'fixture',output:'',logPath:'',isolation:'windows-appcontainer',commandHash:'fixture'},'turn','');expect(resolve(db.timeline(),db.footage()).durationSec).toBe(30);expect(new ProjectContext(db).overview().durationSec).toBe(30);expect(db.timeline().music[0].reason).toBe('');
  const fixed={...db.timeline(),settings:{...db.timeline().settings,durationSec:10,autoDuration:false}};expect(resolve(fixed,db.footage()).durationSec).toBe(10);
 }finally{db.close();}
});
it('searches relative workspace paths as content even when computer scope is selected',async()=>{const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-search-contract-')));let externalCalls=0;try{const ws=new CodeWorkspace(db,{run:async()=>{throw Error('unexpected');},ffmpeg:'',ffprobe:'',files:async()=>{externalCalls++;throw Error('external path used');}},()=>{});await ws.initialize();const result=await ws.execute('search',{scope:'computer',path:'context/project-schema.json',query:'music assetId'},'search','turn',new AbortController().signal);expect(result.matches.length).toBeGreaterThan(0);expect(externalCalls).toBe(0);const read=await ws.execute('read_file',{scope:'computer',path:'context/environment.json'},'read','turn',new AbortController().signal);expect(JSON.parse(read.text).pythonPackages).toEqual([]);}finally{db.close();}});
