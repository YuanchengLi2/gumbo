import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';

it('reads the transcript transcribed without gaps from the start while it runs, then all of it',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-partial-speech-'))),path=join(db.folder,'Media/Originals/talk.mp3');writeFileSync(path,'fixture');
 try{
  db.saveAsset(AssetSchema.parse({id:'talk',filename:'talk.mp3',kind:'audio',hasAudio:true,durationSec:210,originalPath:path,fingerprint:'talk',status:'ready'}));db.job('talk','transcription','running',30);
  const word=(n:number)=>({id:'w'+n,assetId:'talk',text:'word'+n,start:n,end:n+.5,confidence:1,speaker:'unknown',pauseBefore:0});
  const cover=(ranges:[number,number][])=>db.setMeta('speech-coverage:talk',JSON.stringify({provider:'groq',status:'partial',ranges:ranges.map(([start,end])=>({start,end}))}));
  // The first chunk (0-30 s) and the third (120-210 s) are done; the second is still running.
  db.saveRecords('words',[...Array.from({length:30},(_,n)=>word(n)),...Array.from({length:90},(_,n)=>word(120+n))] as any);cover([[0,30],[120,210]]);
  const asked:boolean[]=[];
  const ws=new CodeWorkspace(db,{run:async()=>{throw new Error('no commands');},ffmpeg:'',ffprobe:'',ensureTranscript:async(_id,_signal,enough)=>{asked.push(enough!());}},()=>{});await ws.initialize();
  const read=(offset=0)=>ws.execute('read_transcript',{assetId:'talk',offset,limit:300},'speech','turn',new AbortController().signal);
  const first=await read();
  expect(first.words).toHaveLength(30);expect(first.transcribedUntilSec).toBe(30);expect(first.note).toMatch(/still running/);expect(first.nextOffset).toBe(30);expect(asked).toEqual([false]);
  expect(ws.mediaContext()[0].transcript).toMatchObject({status:'running',transcribedUntilSec:30});
  // The gap fills: the words run on to 210 s with the same revision, so pages read earlier stay valid.
  db.saveRecords('words',Array.from({length:90},(_,n)=>word(30+n)) as any);cover([[0,30],[30,120],[120,210]]);
  const more=await read(30);
  expect(more.words[0].text).toBe('word30');expect(more.totalWords).toBe(210);expect(more.transcribedUntilSec).toBe(210);expect(more.revision).toBe(first.revision);
  db.job('talk','transcription','complete',100);
  const done=await read();
  expect(done.status).toBe('complete');expect(done.note).toBeUndefined();expect(done.totalWords).toBe(210);expect(done.nextOffset).toBeNull();expect(done.revision).not.toBe(first.revision);
 }finally{db.close();}
});
