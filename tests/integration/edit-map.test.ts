import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema,type Asset} from '@dream/footage';
import {emptyTimeline} from '@dream/timeline';
import {ProjectContext} from '../../packages/orchestrator/src/context';
import {editMap,outlineCut} from '../../packages/orchestrator/src/timeline-outline';

/** The edit map (timeline-outline.ts): a big edit at a glance in the first message, so the agent does not spend its first
 * steps mapping the cut with commands. */
const asset=(id:string,filename:string,durationSec:number,extra:Partial<Asset>={})=>AssetSchema.parse({id,filename,kind:'video',originalPath:filename,durationSec,width:1920,height:1080,fps:30,hasAudio:true,fingerprint:id,status:'ready',...extra});
const clipOf=(id:string,assetId:string,srcIn:number,srcOut:number)=>({id,assetId,srcIn,srcOut,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:''});
const at=(clip:string,offsetSec=0)=>({kind:'clip' as const,clipId:clip,at:'start' as const,offsetSec});

it('maps a big edit by section, lists its titles and music, and folds captions and repeated sounds',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-edit-map-')));
 try{
  for(const a of [asset('v','trip.mp4',1200),asset('b','lanterns.mp4',60)])db.saveAsset(a);
  const t=emptyTimeline('t');
  // 60 clips of 2 seconds: past the outline's 40, so the map is sent.
  t.spine=Array.from({length:60},(_,n)=>n%10===0?clipOf('c'+n,'b',n,n+2):clipOf('c'+n,'v',n*10,n*10+2));
  const overlay=(id:string,clip:string,text:string,dur=3)=>({id,type:'overlay' as const,start:at(clip),durationSec:dur,component:'text',params:{text},layer:0,reason:''});
  // A scene title carries its words among its settings; layout and colors are not words.
  const scene=(id:string,clip:string,params:Record<string,unknown>)=>({id,type:'overlay' as const,start:at(clip),durationSec:3,component:'source',params,layer:0,reason:''});
  t.attached=[overlay('ch01_name','c0','HANOI'),overlay('ch02_name','c30','HA GIANG'),scene('chapter03','c50',{x:.5,y:.5,scale:1,fit:'cover',color:'#ffffff',num:'03',name:'STREET FOOD',sub:'Pho, egg coffee'}),
   ...Array.from({length:25},(_,n)=>overlay('cap'+String(n).padStart(3,'0'),'c'+(n+1),'words '+n,2)),
   ...[1,2,3].map(n=>({id:'narr'+n,type:'sfx' as const,start:at('c'+n),durationSec:2,component:'sfx',params:{},source:{assetId:'b',srcIn:0,srcOut:2},layer:0,reason:''}))] as any;
  const m=editMap(t,db.footage());
  expect(outlineCut(t,db.footage())).toBe(true);expect(m.durationSec).toBe(120);expect(m.mainTrackClips).toBe(60);
  expect(m.sections).toHaveLength(4);
  expect(m.sections[0]).toMatch(/^0:00-0:30: 15 clips \(lanterns\.mp4 0s-12s; trip\.mp4 10s-142s\); starts overlay "HANOI", sfx lanterns\.mp4 x3; 14 captions$/);
  expect(m.titles).toEqual(['0:00-0:03 ch01_name: "HANOI"','1:00-1:03 ch02_name: "HA GIANG"','1:40-1:43 chapter03: "STREET FOOD · Pho, egg coffee"']);
  expect(m.captions).toBe('25 caption items, 0:02-0:52');
  // A small edit has the outline only; the first message carries the map when the outline is cut.
  const small=emptyTimeline('s');small.spine=[clipOf('a','v',0,5)];expect(outlineCut(small,db.footage())).toBe(false);
 }finally{db.close();}
});

it('puts the map in the first message only when the outline leaves part of the edit out',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-edit-map-context-')));
 try{
  db.saveAsset(asset('v','trip.mp4',600));
  const context=new ProjectContext(db).initial('make the intro faster',[],[]) as any;
  expect(context.editMap).toBeUndefined();
 }finally{db.close();}
});
