import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {rememberDecision} from '../../packages/orchestrator/src/project-memory';
import {parseCodeTool} from '../../packages/orchestrator/src/code-tools';
import {inspectMedia} from '../../apps/project-service/src/media-evidence';

const fixture=()=>new ProjectDB(mkdtempSync(join(tmpdir(),'dream-tools-')));

it('saves a quoted preference whatever form of message ID the agent sends, and refuses words the user never wrote',()=>{
 const db=fixture();try{
  const message=db.message('user','I want this whole video to feel calm and dreamy: slow pacing and soft, warm colors. Keep that in mind for everything after this.','turn');
  const text='I want this whole video to feel calm and dreamy: slow pacing and soft, warm colors.';
  // The two inputs a live run sent: a conversation record ID, then a made-up ID with typographic quotes.
  expect(rememberDecision(db,{sourceId:`conversation:${message.id}:0`,scope:'whole video',text}).sourceId).toBe(message.id);
  expect(rememberDecision(db,{sourceId:'afdb23d2-da39-455c-a5cb-302bec15a231',scope:'mood',text:'feel calm and dreamy:  slow pacing'}).sourceId).toBe(message.id);
  expect(rememberDecision(db,{scope:'pace',text:'Keep that in mind for everything after this.'}).sourceId).toBe(message.id);
  expect(()=>rememberDecision(db,{scope:'mood',text:'Make everything bright and fast.'})).toThrow(/own words/);
  // A quote with the spelling fixed still finds the message the user typed fast ("make the caption white").
  const typed=db.message('user','just amke teh caption white everywhere','turn2');
  expect(rememberDecision(db,{scope:'captions',text:'make the captions white everywhere'}).sourceId).toBe(typed.id);
  expect(()=>rememberDecision(db,{scope:'captions',text:'make the captions yellow and huge'})).toThrow(/own words/);
 }finally{db.close();}
});

it('unwraps a choice sent as quoted JSON, keeps quotes in file contents, and explains invalid input in plain words',()=>{
 expect(parseCodeTool('find_media',{kinds:['video'],sort:'"captured"',limit:30}).sort).toBe('captured');
 expect(parseCodeTool('write_file',{path:'src/a.txt',content:'"quoted"'}).content).toBe('"quoted"');
 expect(()=>parseCodeTool('find_media',{sort:'newest'})).toThrow('The find_media input is not valid: sort: must be one of "captured", "modified", "name".');
});

it('samples a long look at footage more coarsely instead of refusing it',async()=>{
 const db=fixture();try{
  const file=join(db.folder,'clip.mp4');writeFileSync(file,'video');db.saveAsset(AssetSchema.parse({id:'v',filename:'Clip.mp4',kind:'video',originalPath:file,durationSec:90,fingerprint:'v'}));
  const asked:string[]=[];db.inspectSource=async request=>{asked.push(request.detail);return{assetId:'v',fingerprint:'v',startSec:request.startSec,endSec:request.endSec,sampleIntervalSec:1,coverage:'fixture',frames:[]};};
  const look=await inspectMedia(db,{assetId:'v',startSec:70,endSec:88,motion:true},'ffmpeg','ffprobe',new AbortController().signal);
  expect(asked).toEqual(['overview']);expect(JSON.stringify(look.content)).toContain('Motion detail covers at most 8 seconds');
  await inspectMedia(db,{assetId:'v',startSec:70,endSec:75,motion:true},'ffmpeg','ffprobe',new AbortController().signal);expect(asked.at(-1)).toBe('motion');
 }finally{db.close();}
});

it('looks at the nearest valid stretch when asked for a range past the end of the media, and says so',async()=>{
 const db=fixture();try{
  const file=join(db.folder,'clip.mp4');writeFileSync(file,'video');db.saveAsset(AssetSchema.parse({id:'v',filename:'Clip.mp4',kind:'video',originalPath:file,durationSec:30,fingerprint:'v'}));
  const asked:{startSec:number;endSec:number}[]=[];db.inspectSource=async request=>{asked.push({startSec:request.startSec,endSec:request.endSec});return{assetId:'v',fingerprint:'v',startSec:request.startSec,endSec:request.endSec,sampleIntervalSec:1,coverage:'fixture',frames:[]};};
  const look=await inspectMedia(db,{assetId:'v',startSec:31,endSec:33},'ffmpeg','ffprobe',new AbortController().signal);
  expect(asked.at(-1)).toEqual({startSec:28,endSec:30});expect(JSON.stringify(look.content)).toContain('Asked for 31.00-33.00s, outside this 30.00 s media; showing 28.00-30.00s instead.');
 }finally{db.close();}
});
