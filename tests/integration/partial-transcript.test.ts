import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {Workspace} from '../../apps/project-service/src/workspace';
import {call,textOf} from '../fixtures/agent-project';

it('writes the transcript as it is heard, marking stretches not heard yet, then all of it',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-partial-speech-'))),path=join(db.folder,'Media/Originals/talk.mp3');writeFileSync(path,'fixture');
 try{
  db.saveAsset(AssetSchema.parse({id:'talk',filename:'talk.mp3',kind:'audio',hasAudio:true,durationSec:210,originalPath:path,fingerprint:'talk',status:'ready'}));db.job('talk','transcription','running',30);
  const word=(n:number)=>({id:'w'+n,assetId:'talk',text:'word'+n,start:n,end:n+.5,confidence:1,speaker:'unknown',pauseBefore:0});
  const cover=(ranges:[number,number][])=>db.setMeta('speech-coverage:talk',JSON.stringify({provider:'groq',status:'partial',ranges:ranges.map(([start,end])=>({start,end}))}));
  // The first chunk (0-30 s) and the third (120-210 s) are done; the second is still running.
  db.saveRecords('words',[...Array.from({length:30},(_,n)=>word(n)),...Array.from({length:90},(_,n)=>word(120+n))] as any);cover([[0,30],[120,210]]);
  const ws=new Workspace(db,{run:async()=>{throw new Error('no commands');},ffmpeg:'',ffprobe:''},()=>{});await ws.initialize();
  const read=async()=>textOf(await call(ws,'read',{path:'footage/talk-talk/transcript.txt',limit:2000}));
  const first=await read();
  expect(first).toMatch(/Still being transcribed: heard without a gap up to 30\.0 s of 210\.0 s/);expect(first).toContain('(30.0-120.0 s: not heard yet)');
  expect(first.indexOf('word29')).toBeLessThan(first.indexOf('not heard yet'));expect(first.indexOf('not heard yet')).toBeLessThan(first.indexOf('word120'));
  expect(textOf(await call(ws,'read',{path:'footage/INDEX.md'}))).toMatch(/transcript being heard \(to 30 s\)/);
  // The gap fills and transcription completes: every word, no notes.
  db.saveRecords('words',Array.from({length:90},(_,n)=>word(30+n)) as any);cover([[0,30],[30,120],[120,210]]);db.job('talk','transcription','complete',100);
  const done=await read();
  expect(done).not.toMatch(/Still being transcribed|not heard yet/);expect(done).toContain('word30');expect(done).toContain('word209');
  // Every word with its times, for code.
  const words=JSON.parse(readFileSync(join(ws.root,'footage/talk-talk/words.json'),'utf8')).words;expect(words).toHaveLength(210);expect(words[30]).toEqual([30,30.5,'word30']);
  ws.close();
 }finally{db.close();}
});

it('keeps the transcript file current while a command runs, so code waiting for a long recording sees its words arrive',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-live-transcript-'))),path=join(db.folder,'Media/Originals/talk.mp3');writeFileSync(path,'fixture');
 try{
  db.saveAsset(AssetSchema.parse({id:'talk',filename:'talk.mp3',kind:'audio',hasAudio:true,durationSec:120,originalPath:path,fingerprint:'talk',status:'ready'}));db.job('talk','transcription','running',30);
  const word=(n:number)=>({id:'w'+n,assetId:'talk',text:'word'+n,start:n,end:n+.5,confidence:1,speaker:'unknown',pauseBefore:0});
  db.saveRecords('words',Array.from({length:30},(_,n)=>word(n)) as any);db.setMeta('speech-coverage:talk',JSON.stringify({provider:'groq',status:'partial',ranges:[{start:0,end:30}]}));
  let ws!:Workspace;
  // The command reads the file the way an agent's waiting script does, after transcription has moved on underneath it.
  const run=async(request:any)=>{
   db.saveRecords('words',Array.from({length:90},(_,n)=>word(30+n)) as any);db.setMeta('speech-coverage:talk',JSON.stringify({provider:'groq',status:'complete',ranges:[{start:0,end:120}]}));
   await new Promise(resolve=>setTimeout(resolve,4500));
   const words=JSON.parse(readFileSync(join(ws.root,'footage/talk-talk/words.json'),'utf8')).words;
   return{id:request.id,status:'complete' as const,exitCode:0,startedAt:'',finishedAt:'',output:JSON.stringify({words:words.length}),logPath:'',isolation:'local' as const,commandHash:''};
  };
  ws=new Workspace(db,{run,ffmpeg:'',ffprobe:''},()=>{});await ws.initialize();
  const result=textOf(await call(ws,'run',{command:'node wait-for-transcript.cjs'},'wait'));
  expect(result).toContain('{"words":120}');ws.close();
 }finally{db.close();}
},15000);

it('gives a workspace the package manifest of a fresh npm project, so require() and import scripts both run',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-manifest-')));
 try{
  const ws=new Workspace(db,{run:async()=>{throw new Error('no commands');},ffmpeg:'',ffprobe:''},()=>{});await ws.initialize();
  const manifest=join(ws.root,'package.json');expect(JSON.parse(readFileSync(manifest,'utf8')).type).toBeUndefined();
  // An earlier workspace that declared an ES module loses the declaration on open.
  writeFileSync(manifest,JSON.stringify({name:'dream-project',private:true,type:'module',scripts:{}}));
  await new Workspace(db,{run:async()=>{throw new Error('no commands');},ffmpeg:'',ffprobe:''},()=>{}).initialize();
  expect(JSON.parse(readFileSync(manifest,'utf8'))).toEqual({name:'dream-project',private:true,scripts:{}});
 }finally{db.close();}
});
