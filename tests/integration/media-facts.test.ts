import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema,type Asset,type Shot,emptyFootage} from '@dream/footage';
import {emptyTimeline} from '@dream/timeline';
import {placementWarnings} from '../../apps/project-service/src/timeline-actions';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';
import {ProjectContext} from '../../packages/orchestrator/src/context';
import {timelineOutline} from '../../packages/orchestrator/src/timeline-outline';

const asset=(extra:Partial<Asset>={})=>AssetSchema.parse({id:'v',filename:'talk.mp4',kind:'video',originalPath:'talk.mp4',durationSec:90,width:1920,height:1080,fps:30,hasAudio:true,fingerprint:'v',status:'ready',...extra});
// An earlier project's source still carries a footage map and described shots; none of it may reach the agent.
const legacy=()=>{const footage=emptyFootage();
 footage.assets=[asset({footageMap:{version:1,status:'complete',summary:'A talk on a black slide',frozen:[[20,84]],black:[]}}),asset({id:'n',filename:'new.mp4',durationSec:30})];
 const shot=(i:number,start:number,end:number):Shot=>({id:'v:map'+i,assetId:'v',start,end,framePaths:[],log:{description:'Solid black frame',framing:'screen',tags:['black'],energy:'low',usableAsBroll:false},quality:{brightness:.02,frozen:1,black:0,problems:['frozen','dark']}});
 footage.shots=[shot(0,0,45),shot(1,45,90)];return footage;};
const clipOf=(id:string,assetId:string,srcIn:number,srcOut:number,speed=1)=>({id,assetId,srcIn,srcOut,speed,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:''});

it('tells the agent plain facts about each source and the timeline, never what the footage was judged to show',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-media-facts-')));
 try{const footage=legacy();for(const a of footage.assets)db.saveAsset(a);db.replaceRecords('shots','v',footage.shots as any);db.job('v','transcription','complete',100);
  const ws=new CodeWorkspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg:'unavailable',ffprobe:'unavailable'},()=>{});
  const media=ws.mediaContext() as any[],v=media.find(m=>m.assetId==='v');
  expect(v).toMatchObject({filename:'talk.mp4',kind:'video',durationSec:90,width:1920,height:1080,fps:30,hasAudio:true,transcript:{status:'complete',wordCount:0,file:'context/transcripts/v.json'}});
  expect(JSON.stringify(media)).not.toMatch(/map|frozen|black|shot|Solid/i);
  const t=emptyTimeline('t');t.spine=[clipOf('a','v',30,38)];
  expect(timelineOutline(t,db.footage()).lines).toEqual(['1. a at 0s-8s: talk.mp4 30s-38s']);
  // The project context the first message carries (asset entries and footage search) has none of it either.
  const project=new ProjectContext(db).initial('black frame talk',[],['v']);
  expect(JSON.stringify(project)).not.toMatch(/footageMap|Solid black|frozen/);
 }finally{db.close();}
});

it('warns only about facts of the edit: slow motion, a dominating clip and footage used twice',()=>{
 const footage=legacy(),before=emptyTimeline('t');before.spine=[clipOf('a','v',0,4),clipOf('b','v',10,14),clipOf('c','v',20,24)];
 const slowed=placementWarnings(before,{...before,spine:[before.spine[0],before.spine[1],clipOf('c','v',50,80,.45)]},footage).join('\n');
 expect(slowed).toContain('clip c plays at 0.45x');expect(slowed).toMatch(/clip c is .* of a .* video/);expect(slowed).not.toMatch(/frozen|dark|analyzed/);
 const repeated=placementWarnings(before,{...before,spine:[...before.spine,clipOf('d','v',11,13.5),clipOf('e','n',0,3)]},footage).join('\n');
 expect(repeated).toContain('clips b and d show the same footage');expect(repeated).not.toContain('not analyzed');
 expect(placementWarnings(before,{...before,spine:[...before.spine,clipOf('f','v',40,44)]},footage)).toEqual([]);
});
