import {it,expect} from 'vitest';
import {speechMask,fitToSpeech,longestWord} from '../../apps/project-service/src/speech-timing';
import {emptyTimeline,TimelineSchema,resolve} from '@dream/timeline';
import {emptyFootage,AssetSchema} from '@dream/footage';
import {ProjectDB} from '@dream/project-db';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/** 16 kHz mono PCM16 WAV: quiet room noise, with a tone wherever speech is. */
function wav(seconds:number,speech:[number,number][]){
 const n=Math.round(seconds*16000),bytes=new Uint8Array(44+n*2),view=new DataView(bytes.buffer),text=(at:number,s:string)=>[...s].forEach((c,i)=>bytes[at+i]=c.charCodeAt(0));
 text(0,'RIFF');view.setUint32(4,36+n*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,n*2,true);
 let seed=1;const noise=()=>((seed=(seed*16807)%2147483647)/2147483647-.5)*60;
 for(let i=0;i<n;i++){const t=i/16000,loud=speech.some(([a,b])=>t>=a&&t<b);view.setInt16(44+i*2,Math.round(noise()+(loud?8000*Math.sin(2*Math.PI*220*t):0)),true);}
 return bytes;
}

// The vlog's first line: Whisper put "I" at 0.02 s and stretched "made" to 15.38 s; it was said at about 14.6-15.7 s.
it('pulls a word Whisper stretched across silence onto the speech actually heard',()=>{
 const mask=speechMask(wav(20,[[14.6,15.75],[15.8,16.8]]))!;
 const fitted=fitToSpeech([{word:'I',start:.02,end:1.74},{word:'made',start:1.74,end:15.38},{word:'it.',start:15.38,end:15.74},{word:'I',start:15.74,end:16.02},{word:'checked',start:16.02,end:16.78}],mask);
 expect(fitted[1].start).toBeGreaterThan(14.5);expect(fitted[1].end).toBeCloseTo(15.38,1);
 expect(fitted[0].start).toBeGreaterThan(14);expect(fitted[0].end).toBeLessThanOrEqual(fitted[1].start);
 expect(fitted.every(w=>w.end-w.start<=longestWord(w.word)+1e-9)).toBe(true);
 // Words already on speech keep their times.
 expect(fitted[3]).toMatchObject({start:15.74,end:16.02});
});

it('caps a word at how long it can take to say when there is no sound to go by',()=>{
 const fitted=fitToSpeech([{word:'hello',start:0,end:9},{word:'there',start:12,end:12.4}]);
 expect(fitted[0].end-fitted[0].start).toBeCloseTo(longestWord('hello'));expect(fitted[1]).toMatchObject({start:12,end:12.4});
 expect(speechMask(new Uint8Array(10))).toBeUndefined();
});

// The vlog's narration sat on the music track, and the built-in captions only read the main track: no captions at all.
it('captions speech on the music track at foreground level, not beds, scores or muted clips',()=>{
 const footage=emptyFootage();footage.assets=[
  AssetSchema.parse({id:'cam',filename:'cam.mp4',kind:'video',originalPath:'cam.mp4',durationSec:30,width:1920,height:1080,fps:30,hasAudio:false,fingerprint:'c',status:'ready'}),
  AssetSchema.parse({id:'voice',filename:'narration.m4a',kind:'audio',originalPath:'n.m4a',durationSec:30,fps:30,hasAudio:true,fingerprint:'v',status:'ready'}),
  AssetSchema.parse({id:'song',filename:'song.mp3',kind:'audio',originalPath:'s.mp3',durationSec:30,fps:30,hasAudio:true,fingerprint:'s',status:'ready'})];
 footage.words=[{id:'v1',assetId:'voice',text:'Made',start:2,end:2.4},{id:'v2',assetId:'voice',text:'it',start:2.4,end:2.6},{id:'s1',assetId:'song',text:'la',start:2,end:2.5}] as any;
 const t=emptyTimeline('t'),clip={id:'a',assetId:'cam',srcIn:0,srcOut:10,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:true},reason:''};
 const start={kind:'clip',clipId:'a',at:'start',offsetSec:0};
 const timeline=TimelineSchema.parse({...t,spine:[clip],captions:{style:'clean',params:{},overrides:[]},music:[{id:'narration',assetId:'voice',srcIn:0,srcOut:10,start,gainDb:0},{id:'bed',assetId:'song',srcIn:0,srcOut:10,start,gainDb:-18}]});
 expect(resolve(timeline,footage).words.map(w=>[w.clipId,w.text,w.start])).toEqual([['narration','Made',2],['narration','it',2.4]]);
 // Chosen sources win.
 const chosen=TimelineSchema.parse({...timeline,captions:{style:'clean',params:{sources:['bed']},overrides:[]}});
 expect(resolve(chosen,footage).words.map(w=>w.text)).toEqual(['la']);
});

// A song the transcriber heard one word in ("Bye.") is not narration, even at foreground level.
it('does not caption the odd word heard in music on the music track',()=>{
 const footage=emptyFootage();footage.assets=[
  AssetSchema.parse({id:'cam',filename:'cam.mp4',kind:'video',originalPath:'cam.mp4',durationSec:30,width:1920,height:1080,fps:30,hasAudio:false,fingerprint:'c',status:'ready'}),
  AssetSchema.parse({id:'lofi',filename:'lofi.mp3',kind:'audio',originalPath:'l.mp3',durationSec:30,fps:30,hasAudio:true,fingerprint:'l',status:'ready'})];
 footage.words=[{id:'l1',assetId:'lofi',text:'Bye.',start:0,end:.3}] as any;
 const t=emptyTimeline('t'),clip={id:'a',assetId:'cam',srcIn:0,srcOut:20,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:true},reason:''};
 const timeline=TimelineSchema.parse({...t,spine:[clip],captions:{style:'clean',params:{},overrides:[]},music:[{id:'intro',assetId:'lofi',srcIn:0,srcOut:15,start:{kind:'clip',clipId:'a',at:'start',offsetSec:0},gainDb:-10}]});
 expect(resolve(timeline,footage).words).toEqual([]);
 // Chosen as a caption source, it is captioned as asked.
 expect(resolve(TimelineSchema.parse({...timeline,captions:{style:'clean',params:{sources:['intro']},overrides:[]}}),footage).words.map(w=>w.text)).toEqual(['Bye.']);
});

// The player, the agent's view of the edit and Export read the words through playbackFootage, which only loaded the main
// track's words: narration on the music track resolved to no captions at all.
it('loads the words of narration on the music track for playback',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-playback-words-')),'Words');
 try{
  db.saveAsset(AssetSchema.parse({id:'voice',filename:'narration.m4a',kind:'audio',originalPath:'n.m4a',durationSec:30,fps:30,hasAudio:true,fingerprint:'v',status:'ready'}));
  db.saveRecords('words',[{id:'v1',assetId:'voice',text:'Made',start:2,end:2.4},{id:'v2',assetId:'voice',text:'later',start:20,end:20.4}]);
  const timeline=TimelineSchema.parse({...emptyTimeline('t'),music:[{id:'narration',assetId:'voice',srcIn:0,srcOut:10,start:{kind:'project',at:'start',offsetSec:0},gainDb:0}]});
  expect(db.playbackFootage(timeline).words.map(w=>w.text)).toEqual(['Made']);
 }finally{db.close();}
});
