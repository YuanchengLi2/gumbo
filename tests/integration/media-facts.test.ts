import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema,type Asset,type Shot,emptyFootage} from '@dream/footage';
import {TimelineSchema} from '@dream/timeline';
import {Workspace} from '../../apps/project-service/src/workspace';
import {call,textOf} from '../fixtures/agent-project';

const asset=(extra:Partial<Asset>={})=>AssetSchema.parse({id:'v',filename:'talk.mp4',kind:'video',originalPath:'talk.mp4',durationSec:90,width:1920,height:1080,fps:30,hasAudio:true,fingerprint:'v',status:'ready',...extra});
// An earlier project's source still carries a footage map and described shots; none of it may reach the agent.
const legacy=()=>{const footage=emptyFootage();
 footage.assets=[asset({footageMap:{version:1,status:'complete',summary:'A talk on a black slide',frozen:[[20,84]],black:[]}}),asset({id:'n',filename:'new.mp4',durationSec:30})];
 const shot=(i:number,start:number,end:number):Shot=>({id:'v:map'+i,assetId:'v',start,end,framePaths:[],log:{description:'Solid black frame',framing:'screen',tags:['black'],energy:'low',usableAsBroll:false},quality:{brightness:.02,frozen:1,black:0,problems:['frozen','dark']}});
 footage.shots=[shot(0,0,45),shot(1,45,90)];return footage;};
const clipOf=(id:string,assetId:string,srcIn:number,srcOut:number,speed=1)=>({id,assetId,srcIn,srcOut,speed,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:''});

it('tells the agent plain facts about each source and the edit, never what an old analysis judged the footage to show',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-media-facts-')));
 const ws=new Workspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg:'unavailable',ffprobe:'unavailable'},()=>{});
 try{const footage=legacy();for(const a of footage.assets)db.saveAsset(a);db.replaceRecords('shots','v',footage.shots as any);db.job('v','transcription','complete',100);
  await ws.initialize();
  const index=textOf(await call(ws,'read',{path:'footage/INDEX.md'}));
  expect(index).toMatch(/- v "talk\.mp4": video 1:30 \(90\.0 s\), 1920x1080, 30 fps, sound\. footage\/talk-v\//);
  expect(index).not.toMatch(/map|frozen|black|Solid/i);
  expect(JSON.stringify(ws.sessionContext())).not.toMatch(/footageMap|Solid black|frozen/);
  // The edit as each message sees it: plain facts.
  const v=db.writeVersion(TimelineSchema.parse({...db.timeline(),spine:[clipOf('a','v',30,38)]}),db.head(),'Placed a clip',null);db.db.prepare('UPDATE branches SET head_id=? WHERE id=?').run(v,'main');
  const context=ws.messageContext({turnId:'t',text:'black frame talk',selection:['a'],assetIds:['v'],known:['v','n']}).text;
  expect(context).toContain('The edit now: 0:08 (8.0 s), 1920x1080 at 30 fps; 1 clip on the main track, 0 items over it, 0 sounds; captions off.');
  expect(context).toContain('Selected in the editor: clip a at 0.0-8.0 s (talk.mp4 30.0-38.0 s).');
  expect(context).toContain('Attached to this message: v "talk.mp4" (video 90.0 s).');
  expect(context).not.toMatch(/footageMap|Solid black|frozen/);
 }finally{ws.close();db.close();}
});
