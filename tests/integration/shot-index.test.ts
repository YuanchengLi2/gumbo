import {it,expect,vi} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {ProjectDB} from '@dream/project-db';
import {measureShots,searchShots,shotLine,terms,labelsFor,rangeFacts,ShotIndexer,type Shot} from '../../apps/project-service/src/shot-index';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';

// Ten seconds with known content: a still red card (0-2 s), a pan to the right across colour bars (2-5 s), a test pattern
// jolting from side to side like a handheld walk (5-8 s), and a still blue card (8-10 s).
function fixture(folder:string){
 const out=join(folder,'shots.mp4');
 const result=spawnSync(ffmpeg!,['-v','error','-y',
  '-f','lavfi','-i','color=c=0xc03020:s=320x180:d=2:r=30',
  '-f','lavfi','-i','smptehdbars=s=960x180:d=3:r=30',
  '-f','lavfi','-i','testsrc2=s=960x180:d=3:r=30',
  '-f','lavfi','-i','color=c=0x2040c0:s=320x180:d=2:r=30',
  '-filter_complex',"[1:v]crop=320:180:x='t*120':y=0[pan];[2:v]crop=320:180:x='300+60*sin(t*21)':y=0[shake];[0:v][pan][shake][3:v]concat=n=4:v=1,format=yuv420p[v]",
  '-map','[v]','-c:v','libx264','-preset','veryfast','-crf','20',out],{encoding:'utf8'});
 if(result.status!==0)throw new Error(result.stderr);
 return out;
}

it('splits footage into shots at its cuts and measures the camera, light and motion of each',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-shots-')),path=fixture(folder);
 const {shots}=await measureShots(ffmpeg!,{id:'v1',kind:'video',durationSec:10,originalPath:path,hasAudio:false} as any,new AbortController().signal);
 const cuts=shots.filter(s=>s.cutIn).map(s=>s.start);
 expect(cuts).toHaveLength(3);for(const [found,expected] of cuts.map((c,n)=>[c,[2,5,8][n]]))expect(Math.abs(found-expected)).toBeLessThanOrEqual(.25);
 const at=(t:number)=>shots.find(s=>s.start<=t&&s.end>t)!;
 expect(at(1).labels).toEqual(expect.arrayContaining(['steady','still']));
 // The pattern's content moves left, so the camera pans right.
 expect(at(3.5).labels).toContain('pans right');expect(at(3.5).facts.panX).toBeGreaterThan(6);
 expect(at(6.5).labels.some(l=>l==='shaky'||l==='handheld')).toBe(true);expect(at(6.5).facts.shake).toBeGreaterThan(at(3.5).facts.shake*2);
 expect(at(9).labels).toContain('steady');
},60_000);

it('splits long takes into parts of at most six seconds, and words the facts',()=>{
 const base={brightness:.5,saturation:.3,sharpness:100,panX:0,panY:0,shake:.2,activity:.03};
 expect(labelsFor({...base,brightness:.1,loudnessDb:-60},100)).toEqual(['steady','dark','silent']);
 expect(labelsFor({...base,shake:3,sharpness:20},100)).toEqual(['shaky','soft']);
 expect(labelsFor({...base,panY:-8,shake:.5},100)).toEqual(['tilts up']);
 expect(terms('Noodles, cooking at the night-markets!')).toEqual(['noodl','cook','night','market']);
 expect(terms('noodle cooks markets')).toEqual(['noodl','cook','market']);
});

const shot=(id:string,start:number,what:string,tags:string[],labels:string[]):Shot=>({id,assetId:'v1',start,end:start+4,cutIn:true,facts:{brightness:.4,saturation:.3,sharpness:1,panX:0,panY:0,shake:.2,activity:.03},labels,what,tags});
const library=[
 shot('a',0,'man talking to the camera on a busy street','street day person selfie closeup'.split(' '),['handheld']),
 shot('b',4,'street food stall at night, vendor cooking noodles','street night food vendor market medium'.split(' '),['steady','dark']),
 shot('c',8,'bowl of pho on a table in a cafe','cafe indoor food closeup day'.split(' '),['steady']),
 shot('d',12,'motorbikes crossing a busy street at night','street night motorbike crowd wide'.split(' '),['shaky','dark']),
 shot('e',16,'mountain road winding through green valley','mountain road outdoor day wide'.split(' '),['steady']),
];

it('ranks shots by what is visible and said, and filters on measured facts and on what the edit already uses',()=>{
 const none=(_s:Shot)=>'',ids=(q:any,spoken:(s:Shot)=>string=none,used:any[]=[])=>searchShots(library,q,spoken,used).map(h=>h.shot.id);
 expect(ids({query:'street food at night'})[0]).toBe('b');
 expect(ids({query:'food'})).toEqual(expect.arrayContaining(['b','c']));expect(ids({query:'food'})).toHaveLength(2);
 expect(ids({query:'street -selfie'})).not.toContain('a');
 expect(ids({query:'street night',steady:true})).toEqual(['b']);
 expect(ids({query:'night',light:'dark'})).toEqual(expect.arrayContaining(['b','d']));
 expect(ids({query:'street'},s=>s.id==='a'?'we made it to Hanoi':'')).toContain('a');expect(ids({query:'hanoi'},s=>s.id==='a'?'we made it to Hanoi':'')).toEqual(['a']);
 expect(ids({speech:true},s=>s.id==='a'?'hello':'')).toEqual(['a']);
 // Shot b is in the edit (source 4-8 s placed at 30 s); unused leaves it out, and its line says where it is.
 const used=[{assetId:'v1',from:3.5,to:8.5,at:30}];
 expect(ids({query:'food'},none,used)).toContain('b');expect(ids({query:'food',unused:true},none,used)).toEqual(['c']);
 const hit=searchShots(library,{query:'noodles'},none,used)[0];expect(shotLine(hit,1,'trip.mp4')).toBe('1. v1 trip.mp4 4-8s (4s) | street food stall at night, vendor cooking noodles | steady, dark | in the edit at 30.5s');
 // Without a query: every shot, in source order.
 expect(ids({})).toEqual(['a','b','c','d','e']);
});

it('describes shots from one frame sheet per twelve, keeps what was described when a batch fails, and serves find_shots with frames',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-shot-tool-')),db=new ProjectDB(folder,'Shots'),path=fixture(folder);
 db.saveAsset({id:'v1',filename:'shots.mp4',kind:'video',durationSec:10,fps:30,width:320,height:180,hasAudio:false,originalPath:path,fingerprint:'f1',status:'ready'} as any);
 let calls=0;const sheets:number[]=[];
 const describe=vi.fn(async(_system:string,content:any[])=>{calls++;const count=Number(String(content[1].text).match(/\d+/)![0]);return{content:[{type:'text',text:JSON.stringify(Array.from({length:count},(_,n)=>({n:n+1,what:`shot number ${n+1} of the test pattern`,tags:['pattern','test']})))}]};});
 const indexer=new ShotIndexer(db,ffmpeg!,describe,async images=>{sheets.push(images.length);return{data:Buffer.from('sheet').toString('base64')};});
 try{
  const index=(await indexer.ensure('v1',new AbortController().signal))!;
  expect(index.shots.length).toBeGreaterThanOrEqual(4);expect(index.shots.every(s=>s.what)).toBe(true);expect(calls).toBe(1);expect(sheets).toEqual([index.shots.length]);
  expect(indexer.status('v1')).toBe(`${index.shots.length} shots`);
  // A second call reuses the saved index: no measuring, no describing.
  await indexer.ensure('v1',new AbortController().signal);expect(calls).toBe(1);
  db.contactSheet=vi.fn(async(images:any[])=>({data:'SHEET',mimeType:'image/jpeg' as const,columns:4,rows:3,count:images.length,width:1536,height:400}));
  const workspace=new CodeWorkspace(db,{run:async()=>{throw new Error('no commands');},ffmpeg:ffmpeg!,ffprobe:ffprobe.path,shots:indexer},()=>{});
  await workspace.initialize();
  expect((workspace.mediaContext() as any[]).find(m=>m.assetId==='v1').shots).toBe(`${index.shots.length} shots`);
  const result:any=await workspace.execute('find_shots',{query:'pattern',steady:true,limit:12,offset:0},'find','turn',new AbortController().signal);
  const summary=JSON.parse(result.content[0].text);
  expect(summary.matched).toBeGreaterThan(0);expect(summary.results[0]).toMatch(/^1\. v1 shots\.mp4 [\d.]+-[\d.]+s \([\d.]+s\) \| shot number \d+ of the test pattern \| /);expect(summary.results.some((l:string)=>/shaky|handheld/.test(l))).toBe(false);
  expect(result.content.at(-1)).toEqual({type:'image',source:{type:'base64',media_type:'image/jpeg',data:'SHEET'}});
  await expect(workspace.execute('find_shots',{assetIds:['nope'],limit:12,offset:0},'find2','turn',new AbortController().signal)).rejects.toThrow(/Not in the footage index/);
 }finally{indexer.close();db.close();}
},60_000);

it('keeps the measured index when describing fails, and says so',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-shot-fail-')),db=new ProjectDB(folder,'Fail'),path=fixture(folder);
 db.saveAsset({id:'v1',filename:'shots.mp4',kind:'video',durationSec:10,fps:30,width:320,height:180,hasAudio:false,originalPath:path,fingerprint:'f1',status:'ready'} as any);
 const indexer=new ShotIndexer(db,ffmpeg!,async()=>{throw new Error('Sign in to use AI.');},async()=>({data:'x'}));
 try{
  const index=(await indexer.ensure('v1',new AbortController().signal))!;
  expect(index.shots.length).toBeGreaterThanOrEqual(4);expect(index.shots.some(s=>s.what)).toBe(false);expect(index.describeError).toMatch(/Sign in/);
  expect(indexer.status('v1')).toMatch(/0 described \(describing failed: Sign in to use AI\.\)/);expect(indexer.missing()).toEqual(['v1']);
 }finally{indexer.close();db.close();}
},60_000);

it('shows the index facts of each clip the agent places, and of each cut in a stretch of the edit it watches',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-shot-facts-')),db=new ProjectDB(folder,'Facts'),path=fixture(folder);
 db.saveAsset({id:'v1',filename:'shots.mp4',kind:'video',durationSec:10,fps:30,width:320,height:180,hasAudio:false,originalPath:path,fingerprint:'f1',status:'ready'} as any);
 const indexer=new ShotIndexer(db,ffmpeg!);
 try{
  const index=(await indexer.ensure('v1',new AbortController().signal))!;
  // A range across the cut from the pan into the jolting pattern: its facts name the cut inside it and the shake.
  const facts=rangeFacts(index,4,7)!;expect(facts).toMatch(/shaky|handheld/);expect(facts).toMatch(/camera cut inside, 1(\.\d+)?s in/);expect(facts).toMatch(/shake [\d.]+/);
  expect(rangeFacts(index,0.2,1.8)).toMatch(/still|steady/);expect(rangeFacts(index,0.2,1.8)).not.toMatch(/camera cut/);
  const workspace=new CodeWorkspace(db,{run:async()=>{throw new Error('no commands');},ffmpeg:ffmpeg!,ffprobe:ffprobe.path,shots:indexer},()=>{});
  await workspace.initialize();
  const file=join(workspace.root,'project.json'),doc=JSON.parse(readFileSync(file,'utf8'));
  doc.timeline.spine=[{id:'calm',assetId:'v1',srcIn:0.2,srcOut:1.8,speed:1,audio:{mute:true},reason:'Calm open'},{id:'jolt',assetId:'v1',srcIn:4,srcOut:7,speed:1,audio:{mute:true},reason:'Across the cut'}];writeFileSync(file,JSON.stringify(doc));
  const first:any=await workspace.execute('publish_project',{},'p1','turn',new AbortController().signal);
  const placed:string[]=first.footageInPlacedClips.clips;expect(placed).toHaveLength(2);expect(placed[1]).toMatch(/^jolt at 1\.6s \(source 4-7s\): .*camera cut inside/);
  // Publishing again without new or re-trimmed clips adds nothing.
  const second:any=await workspace.execute('publish_project',{},'p2','turn',new AbortController().signal);expect(second.footageInPlacedClips).toBeUndefined();
  // Watching the stretch of the edit: each cut carries what the index measured in its source range.
  const viewed:any=await workspace.execute('view_media',{target:'preview',startSec:0,endSec:4},'look','turn',new AbortController().signal);
  const events:string[]=JSON.parse(viewed.content[0].text).stretch.events;expect(events.find(e=>e.includes('cut to jolt'))).toMatch(/camera cut inside/);
 }finally{indexer.close();db.close();}
},60_000);

it('gives every request its edit as footage, and the shots triage says it needs, from the index',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-shot-context-')),db=new ProjectDB(folder,'Context'),path=fixture(folder);
 db.saveAsset({id:'v1',filename:'shots.mp4',kind:'video',durationSec:10,fps:30,width:320,height:180,hasAudio:false,originalPath:path,fingerprint:'f1',status:'ready'} as any);
 const describe=vi.fn(async(_system:string,content:any[])=>{const count=Number(String(content[1].text).match(/\d+/)![0]);return{content:[{type:'text',text:JSON.stringify(Array.from({length:count},(_,n)=>({n:n+1,what:n===count-1?'calm blue lake under a clear sky':'colour bars test pattern',tags:n===count-1?['lake','water','calm','outdoor']:['pattern']})))}]};});
 const indexer=new ShotIndexer(db,ffmpeg!,describe,async()=>({data:Buffer.from('sheet').toString('base64')}));
 try{
  await indexer.ensure('v1',new AbortController().signal);
  const workspace=new CodeWorkspace(db,{run:async()=>{throw new Error('no commands');},ffmpeg:ffmpeg!,ffprobe:ffprobe.path,shots:indexer},()=>{});
  await workspace.initialize();
  const file=join(workspace.root,'project.json'),doc=JSON.parse(readFileSync(file,'utf8'));
  doc.timeline.spine=[{id:'jolt',assetId:'v1',srcIn:5.2,srcOut:7.8,speed:1,audio:{mute:true},reason:'Jolting pattern'}];writeFileSync(file,JSON.stringify(doc));
  await workspace.execute('publish_project',{},'p1','turn',new AbortController().signal);
  // Triage said what the request needs from the footage.
  db.setMeta('pending_request',JSON.stringify({turnId:'t2',text:'open on something calm'}));db.setMeta('routing:t2',JSON.stringify({route:'local',lookFor:'calm lake water'}));
  const project:any=(workspace.context('open on something calm') as any).project;
  expect(project.timeline.lines[0]).toMatch(/^1\. jolt at .*\| "colour bars test pattern"; .*(shaky|handheld)/);
  expect(project.footageForRequest.lookingFor).toBe('calm lake water');expect(project.footageForRequest.shots[0]).toMatch(/calm blue lake/);
  // A request that needs no footage chosen gets no shot list.
  db.setMeta('routing:t2',JSON.stringify({route:'local'}));expect((workspace.context('make the caption white') as any).project.footageForRequest).toBeUndefined();
 }finally{indexer.close();db.close();}
},60_000);
