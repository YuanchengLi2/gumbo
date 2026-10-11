import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {mapFootage,mapSections,joinSignals} from '../../apps/project-service/src/footage-map';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';

it('splits a long source into a short first section and four-minute ones, folding a short tail into the last',()=>{
 expect(mapSections(30)).toEqual([{from:0,to:30}]);
 expect(mapSections(310)).toEqual([{from:0,to:60},{from:60,to:310}]);
 expect(mapSections(600)).toEqual([{from:0,to:60},{from:60,to:300},{from:300,to:540},{from:540,to:600}]);
 const empty={cuts:[],samples:[],jitter:[]};
 expect(joinSignals([{...empty,frozen:[],black:[[58,60]]},{...empty,frozen:[[61,65]],black:[[60,62.5]]}])).toMatchObject({black:[[58,62.5]],frozen:[[61,65]]});
});

it('maps a long source section by section, reporting the stretch measured from the start as it grows',async()=>{
 // Red for 55 s, black across the first section boundary (55-65 s), then blue and green.
 const dir=mkdtempSync(join(tmpdir(),'dream-partial-map-')),file=join(dir,'long.mp4');
 const parts=[['red',55],['black',10],['blue',200],['green',55]].map(([c,d])=>`color=c=${c}:s=160x90:r=10:d=${d}`);
 const made=spawnSync(ffmpeg!,['-y','-v','error',...parts.flatMap(p=>['-f','lavfi','-i',p]),'-filter_complex','[0:v][1:v][2:v][3:v]concat=n=4:v=1[v]','-map','[v]','-c:v','libx264','-preset','ultrafast','-g','10',file],{windowsHide:true});
 if(made.status)throw new Error(made.stderr.toString());
 const asset=AssetSchema.parse({id:'long',filename:'long.mp4',kind:'video',originalPath:file,durationSec:320,width:160,height:90,fps:10,hasAudio:false,fingerprint:'long',status:'ready'});
 const progress:{until:number;lastShotEnd:number}[]=[];
 const result=await mapFootage({ffmpeg:ffmpeg!,asset,dir,signal:new AbortController().signal,onProgress:p=>progress.push({until:p.map.analyzedUntilSec!,lastShotEnd:p.shots.at(-1)!.end})});
 // Sections 0-60, 60-300, 300-320: the opening is reported before the whole is done, each report covering only what is measured.
 expect(progress[0]?.until).toBe(60);
 for(const p of progress){expect(p.until).toBeLessThan(320);expect(p.lastShotEnd).toBe(p.until);}
 expect(progress.map(p=>p.until)).toEqual([...progress.map(p=>p.until)].sort((a,b)=>a-b));
 // The black stretch across the section boundary is one range, and the whole map has no partial marker.
 expect(result.map.black).toHaveLength(1);expect(result.map.black[0][0]).toBeCloseTo(55,0);expect(result.map.black[0][1]).toBeCloseTo(65,0);
 expect(result.map.analyzedUntilSec).toBeUndefined();expect(result.shots.at(-1)!.end).toBe(320);
 expect(result.shots.some(s=>Math.abs(s.start-265)<1)).toBe(true);
},120_000);

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
