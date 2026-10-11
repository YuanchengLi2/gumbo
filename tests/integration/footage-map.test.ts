import {it,expect,beforeAll} from 'vitest';
import {mkdtempSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema,type Asset,type Shot,emptyFootage} from '@dream/footage';
import {emptyTimeline} from '@dream/timeline';
import {measureSignals,shotsFrom,mapFootage,measureLoudness} from '../../apps/project-service/src/footage-map';
import {placementWarnings,applyTimelineActions} from '../../apps/project-service/src/timeline-actions';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';
import {timelineOutline} from '../../packages/orchestrator/src/timeline-outline';

const dir=mkdtempSync(join(tmpdir(),'dream-footage-map-')),clip=join(dir,'mixed.mp4');
// Ten seconds: 3 s moving test pattern, 2 s frozen picture, 2 s black, 3 s of the pattern with camera shake; a tone throughout.
beforeAll(()=>{const r=spawnSync(ffmpeg!,['-y','-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=30:d=3','-f','lavfi','-i','color=c=0x3a6ea5:s=640x360:r=30:d=2','-f','lavfi','-i','color=c=black:s=640x360:r=30:d=2','-f','lavfi','-i','testsrc2=s=720x420:r=30:d=3','-f','lavfi','-i','sine=frequency=440:duration=10',
 '-filter_complex','[3]crop=640:360:40+30*sin(n*1.9):30+25*cos(n*2.7)[shaky];[0][1][2][shaky]concat=n=4:v=1:a=0[v]','-map','[v]','-map','4:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',clip],{windowsHide:true});if(r.status)throw new Error(r.stderr.toString());},60_000);

const asset=(extra:Partial<Asset>={})=>AssetSchema.parse({id:'v',filename:'mixed.mp4',kind:'video',originalPath:clip,durationSec:10,hasAudio:true,fingerprint:'v',status:'ready',...extra});

it('finds the frozen, black and shaky stretches of a source and splits it into shots',async()=>{
 const signals=await measureSignals(ffmpeg!,clip,10,dir,new AbortController().signal);
 expect(signals.frozen.some(([a,b])=>a<3.6&&b>4.4)).toBe(true);expect(signals.black.some(([a,b])=>a<5.6&&b>6.4)).toBe(true);
 const shots=shotsFrom('v',signals,10),at=(t:number)=>shots.find(s=>s.start<=t&&s.end>t)!;
 expect(shots.length).toBeGreaterThanOrEqual(3);
 expect(at(4).quality!.problems).toContain('frozen');expect(at(6).quality!.problems).toContain('black');expect(at(8.5).quality!.problems).toContain('shaky');expect(at(1).quality!.problems).toEqual([]);
 expect(existsSync(join(dir,'footage-map.txt'))).toBe(false);
 expect(await measureLoudness(ffmpeg!,clip,new AbortController().signal)).toBeLessThan(-5);
},60_000);

it('adds what one look at the shots saw, and keeps the measurements when the look fails',async()=>{
 const sheets:number[]=[];const contactSheet=async(images:{data:string}[])=>{sheets.push(images.length);return{data:'sheet',mimeType:'image/jpeg' as const,columns:3,rows:2,count:images.length,width:1568,height:600};};
 const looked=await mapFootage({ffmpeg:ffmpeg!,asset:asset(),dir,signal:new AbortController().signal,contactSheet,describe:async({shots})=>({summary:'A test pattern, a still and a black screen.',shots:shots.map(s=>({n:s.n,description:s.n===1?'Moving colour test pattern':'Something else',framing:'graphic',tags:['test'],energy:'medium' as const,usable:s.n!==1,problems:s.n===1?['player_controls','made_up']:[]}))})});
 expect(sheets).toEqual([looked.shots.length]);expect(looked.map).toMatchObject({status:'complete',summary:'A test pattern, a still and a black screen.'});
 expect(looked.shots[0].log).toMatchObject({description:'Moving colour test pattern',usableAsBroll:false});expect(looked.shots[0].quality!.problems).toEqual(['player_controls']);
 const blind=await mapFootage({ffmpeg:ffmpeg!,asset:asset(),dir,signal:new AbortController().signal,contactSheet,describe:async()=>{throw new Error('Not signed in');}});
 expect(blind.map.status).toBe('signals');expect(blind.map.error).toContain('Not signed in');expect(blind.shots.some(s=>s.quality!.problems.includes('frozen'))).toBe(true);
},60_000);

// A source with a mapped frozen stretch, a shot flagged as showing a recorder window, and one not analyzed yet.
const mapped=()=>{const footage=emptyFootage();
 footage.assets=[asset({durationSec:90,footageMap:{version:1,status:'complete',frozen:[[68,84]],black:[]}}),asset({id:'n',filename:'new.mp4',durationSec:30})];
 const shot=(i:number,start:number,end:number,problems:string[]=[],description='A man at a desk'):Shot=>({id:'v:map'+i,assetId:'v',start,end,framePaths:[],log:{description,framing:'medium',tags:[],energy:'low',usableAsBroll:!problems.length},quality:{brightness:.4,frozen:0,black:0,problems}});
 footage.shots=[shot(0,0,30),shot(1,30,85.4),shot(2,85.4,90,['recorder_window'],'OBS window')];return footage;};
const clipOf=(id:string,assetId:string,srcIn:number,srcOut:number,speed=1)=>({id,assetId,srcIn,srcOut,speed,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:''});

it('warns about frozen and flagged footage, slow motion, a dominating clip, repeats and unanalyzed sources',()=>{
 const footage=mapped(),before=emptyTimeline('t');before.spine=[clipOf('a','v',0,4),clipOf('b','v',10,14),clipOf('c','v',20,24)];
 const extended={...before,spine:[before.spine[0],before.spine[1],clipOf('c','v',60,90,.45)]};
 const warnings=placementWarnings(before,extended,footage).join('\n');
 expect(warnings).toContain('clip c shows frozen picture (mixed.mp4 68s-84s)');expect(warnings).toContain('clip c shows screen-recorder window');expect(warnings).toContain('Usable footage in mixed.mp4 ends at 68s');
 expect(warnings).toContain('clip c plays at 0.45x');expect(warnings).toMatch(/clip c is .* of a .* video/);
 const repeated={...before,spine:[...before.spine,clipOf('d','v',11,13.5),clipOf('e','n',0,3)]};
 const second=placementWarnings(before,repeated,footage).join('\n');expect(second).toContain('clips b and d show the same footage');expect(second).toContain('new.mp4 is not analyzed yet');
 // A clean edit has nothing to say.
 expect(placementWarnings(before,{...before,spine:[...before.spine,clipOf('f','v',40,44)]},footage)).toEqual([]);
 const applied=applyTimelineActions({format:'dream-workspace',version:1,baseVersionId:'x',timeline:before,outputs:[]} as any,[{type:'trim_clip',clipId:'c',srcIn:66,srcOut:72}],undefined,footage);
 expect(applied.warnings.join()).toContain('frozen picture');
});

it('gives the agent each source\'s map in the media list and what each placed clip shows in the outline',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-map-context-')));
 try{const footage=mapped();for(const a of footage.assets)db.saveAsset(a);db.replaceRecords('shots','v',footage.shots as any);
  const ws=new CodeWorkspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg:'unavailable',ffprobe:'unavailable'},()=>{});
  const media=ws.mediaContext() as any[],v=media.find(m=>m.assetId==='v'),n=media.find(m=>m.assetId==='n');
  expect(v.map.shots).toEqual(['0.0-30.0s: A man at a desk','30.0-85.4s: A man at a desk','85.4-90.0s: OBS window [screen-recorder window]']);expect(v.map.frozen).toEqual(['68.0-84.0s']);expect(v.map.usableUntilSec).toBe(68);
  expect(n.map).toContain('Not analyzed yet');
  const t=emptyTimeline('t');t.spine=[clipOf('a','v',80,88)];const lines=timelineOutline(t,db.footage()).lines;
  expect(lines[0]).toContain('(A man at a desk) [frozen picture, screen-recorder window]');
 }finally{db.close();}
});
