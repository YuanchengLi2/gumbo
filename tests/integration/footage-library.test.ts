import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {FootageLibrary,sentences,transcriptText,footageFolder} from '../../apps/project-service/src/footage-library';
import {addSource} from '../fixtures/agent-project';
import {SoundIndexer} from '../../apps/project-service/src/sound-index';
import {SOUND_ANALYSIS_VERSION,type SoundAnalysis} from '@dream/sound';

/** The footage as files (apps/project-service/src/footage-library.ts): transcripts by sentence, shot lists, overviews
 * and the index, the same pipeline for a clip and for hours. */
const project=()=>{const folder=mkdtempSync(join(tmpdir(),'gumbo-footage-')),db=new ProjectDB(folder,'Footage');return{db,root:join(folder,'Workspace')};};
const words=(from:number,count:number,each=.4)=>Array.from({length:count},(_,n)=>[from+n*.5,from+n*.5+each,n%12===11?`word${n}.`:`word${n}`] as [number,number,string]);

it('groups words into sentences at punctuation, pauses, speaker changes and length',()=>{
 const lines=sentences([{text:'So',start:0,end:.2},{text:'I',start:.3,end:.4},{text:'went.',start:.5,end:.8},{text:'Then',start:.9,end:1},{text:'what?',start:1.1,end:1.3},
  {text:'Later',start:3,end:3.2,speaker:'A'},{text:'on',start:3.3,end:3.4,speaker:'B'}]);
 // "So I went." is short, so it runs on to "Then what?"; a 1.7 s pause ends a line; so does a new speaker.
 expect(lines.map(l=>l.text)).toEqual(['So I went. Then what?','Later','on']);
 expect(lines[0]).toMatchObject({start:0,end:1.3});
});

it('writes a transcript that says how far it is heard and marks stretches not heard yet',()=>{
 const asset={id:'a',filename:'talk.mp4',durationSec:60,hasAudio:true};
 const text=transcriptText(asset,[{text:'Hi.',start:1,end:1.5},{text:'Later.',start:40,end:40.5}],{state:'running',until:10,covered:[{start:0,end:10},{start:30,end:45}]});
 expect(text.split('\n')).toEqual([expect.stringMatching(/^# What is said in talk\.mp4 \(a, 1:00 long\)/),'(Still being transcribed: heard without a gap up to 10.0 s of 60.0 s. More lines arrive as it continues.)','[1.0-1.5] Hi.','(10.0-30.0 s: not heard yet)','[40.0-40.5] Later.','(45.0-60.0 s: not heard yet)','']);
 expect(transcriptText(asset,[],{state:'complete'})).toContain('(No speech was heard.)');
 expect(transcriptText({...asset,hasAudio:false},[],{state:'none'})).toContain('(This source has no sound.)');
});

it('writes an overview of a source once its speech is heard, in one call when it fits',async()=>{
 const {db,root}=project(),asked:string[]=[];
 const library=new FootageLibrary(db,root,{summarize:async(system,text)=>{asked.push(system.slice(0,40)+'|'+text);return'A talk about pricing.\n\n## Scenes\n- 0-60 s: the talk';}});
 try{
  const asset=addSource(db,{durationSec:60,words:words(0,100)});
  library.refresh();await library.writeOverviews();
  expect(asked).toHaveLength(1);expect(asked[0]).toMatch(/^You write the overview/);expect(asked[0]).toContain('[0.0-');
  const folder=join(root,footageFolder(asset));
  expect(readFileSync(join(folder,'overview.md'),'utf8')).toContain('A talk about pricing.');
  expect(readFileSync(join(root,'footage','INDEX.md'),'utf8')).toContain('  A talk about pricing.');
  // Nothing changed: it is not written again.
  await library.writeOverviews();expect(asked).toHaveLength(1);
 }finally{library.close();db.close();}
});

it('reads a long source in parts of five minutes, four at a time, and combines them',async()=>{
 const {db,root}=project(),asked:string[]=[];let running=0,most=0;
 const library=new FootageLibrary(db,root,{summarize:async(system,text)=>{running++;most=Math.max(most,running);await new Promise(r=>setTimeout(r,10));running--;asked.push(system.startsWith('You take notes')?'part':system.startsWith('You write the overview')?'combine':'other');return system.startsWith('You take notes')?'## Scenes\n- part':'A long recording.';}});
 try{
  // Twenty-five minutes of speech: far more than one call reads.
  addSource(db,{durationSec:1500,words:words(0,3000).map(([start,end,text])=>[start,end,'considerably-'+text] as [number,number,string])});
  library.refresh();await library.writeOverviews();
  expect(asked.filter(a=>a==='part')).toHaveLength(5);expect(asked.at(-1)).toBe('combine');expect(most).toBeLessThanOrEqual(4);
 }finally{library.close();db.close();}
});

it('writes no overview for a short clip: its index line says what is in it',async()=>{
 const {db,root}=project();let calls=0;
 const library=new FootageLibrary(db,root,{summarize:async()=>{calls++;return'x';}});
 try{
  const asset=addSource(db,{durationSec:12,words:[[0,.5,'Welcome'],[.6,1,'back.']]});
  library.refresh();await library.writeOverviews();
  expect(calls).toBe(0);
  expect(readFileSync(join(root,footageFolder(asset),'overview.md'),'utf8')).toContain('A short clip');
  expect(readFileSync(join(root,'footage','INDEX.md'),'utf8')).toContain('says "Welcome back."');
 }finally{library.close();db.close();}
});

it('writes what the sound analysis heard: sound.txt, the voice of each transcript line, beats for code, and an overview that waits for it',async()=>{
 const {db,root}=project(),asked:string[]=[];
 // Two people: the first speaks for 5 s, the second answers; a laugh, then music under the end.
 const analysis:SoundAnalysis={version:SOUND_ANALYSIS_VERSION,durationSec:60,levelDb:-24,sections:[{start:0,end:40,kind:'speech'},{start:40,end:60,kind:'music'}],
  events:[{start:20,end:22,group:'laughter',label:'Laughter',score:.8}],omitted:{},loud:[{at:21,db:-10,rise:14}],
  speakers:{count:2,share:{A:.5,B:.5},turns:[{start:0,end:5.6,speaker:'A'},{start:5.6,end:12,speaker:'B'}]},music:[{start:40,end:60,bpm:120,beats:[40.5,41,41.5]}]};
 const sounds=new SoundIndexer(db,'ffmpeg',async()=>analysis),library=new FootageLibrary(db,root,{sounds,summarize:async(system,text)=>{asked.push(text);return'Two people talk, then music.';}});
 try{
  const asset=addSource(db,{durationSec:60,words:[...words(0,12),...words(6,12)].map(([s,e,t],n)=>[s,e,n===11||n===23?t+'.':t])}),folder=join(root,footageFolder(asset));
  library.refresh();await library.writeOverviews();
  expect(readFileSync(join(folder,'sound.txt'),'utf8')).toContain('(Not analysed yet: the analysis arrives here when it finishes.)');
  expect(asked).toEqual([]);
  expect(readFileSync(join(root,'footage','INDEX.md'),'utf8')).toContain('sound: waiting');
  await sounds.ensure(asset.id,new AbortController().signal);library.refresh();
  const sound=readFileSync(join(folder,'sound.txt'),'utf8');
  expect(sound).toContain('2 voices: A 50%, B 50% of the speech');expect(sound).toContain('[40.0-60.0] music');
  expect(sound).toContain('[20.0-22.0] laughter: Laughter (80%)');expect(sound).toContain('[21.0] 14 dB above its surroundings');expect(sound).toContain('[40.0-60.0] 120 BPM, 3 beats from 40.5 s');
  const transcript=readFileSync(join(folder,'transcript.txt'),'utf8').split('\n');
  expect(transcript.find(l=>l.startsWith('[0.0-'))).toMatch(/\] A: word0/);expect(transcript.find(l=>l.startsWith('[6.0-'))).toMatch(/\] B: word0/);
  expect(readFileSync(join(folder,'words.json'),'utf8')).toContain('"speakers":[\n[0,5.6,"A"],\n[5.6,12,"B"]\n]');
  expect(JSON.parse(readFileSync(join(folder,'beats.json'),'utf8')).music[0].beats).toEqual([40.5,41,41.5]);
  // Now the overview is written, from the voices and the sounds too.
  await library.writeOverviews();
  expect(asked).toHaveLength(1);expect(asked[0]).toContain('] A: word0');expect(asked[0]).toContain('Sounds:\n[20.0-22.0] Laughter');
  expect(readFileSync(join(root,'footage','INDEX.md'),'utf8')).toContain('sound: analysed (2 voices), music at 120 BPM');
 }finally{library.close();db.close();}
});
