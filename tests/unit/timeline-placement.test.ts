import {it,expect} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AssetSchema,emptyFootage} from '@dream/footage';
import {apply,resolve,placeAssets,dropTrack,selectionRefs,type TimelineDocument} from '@dream/timeline';
import {ProjectDB} from '@dream/project-db';
import {MediaTile} from '../../apps/desktop/src/renderer/components/media/MediaTile';

const asset=(id:string,kind:'video'|'audio'|'image',durationSec:number,capturedAt?:string)=>AssetSchema.parse({id,filename:id+(kind==='audio'?'.mp3':kind==='image'?'.jpg':'.mp4'),kind,durationSec,fps:30,width:1920,height:1080,hasAudio:kind!=='image',originalPath:id,fingerprint:id,status:'ready',...(capturedAt?{capturedAt}:{})});
function project(){
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-placement-'))),footage={...emptyFootage(),assets:[asset('late','video',4,'2026-10-10T12:00:00Z'),asset('early','video',6,'2026-10-10T08:00:00Z'),asset('song','audio',30),asset('photo','image',5)]};
 return{db,footage,timeline:db.timeline() as TimelineDocument};
}

it('places dropped media in capture order on the right tracks as one change',()=>{
 const {db,footage,timeline}=project();try{
  expect([dropTrack('video','video'),dropTrack('music','video'),dropTrack('video','audio'),dropTrack('visual','image')]).toEqual(['video','visual:0','music:0','visual:0']);
  const ops=placeAssets(timeline,footage,['late','early'],'video',0),after=apply(timeline,ops,footage),r=resolve(after,footage);
  expect(r.clips.map(c=>c.assetId)).toEqual(['early','late']);expect(r.clips[1].start).toBeCloseTo(6);
  // Dropping inside a clip splits it there and inserts the new clip at that point.
  const split=apply(after,placeAssets(after,footage,['photo'],'video',3),footage);expect(resolve(split,footage).clips.map(c=>c.assetId)).toEqual(['early','photo','early','late']);
  const withMusic=apply(after,placeAssets(after,footage,['song'],'video',2),footage);expect(resolve(withMusic,footage).music).toHaveLength(1);expect(resolve(withMusic,footage).clips).toHaveLength(2);
  const refs=selectionRefs(after,footage,[after.spine[1].id]);expect(refs).toEqual([expect.objectContaining({kind:'clip',assetId:'late',srcIn:0,srcOut:4,label:'late.mp4'})]);
 }finally{db.close();}
});

it('shows media as tiles: a frame at the clip in point, a thumbnail, a live scene, a waveform, or a file-type icon',()=>{
 const video={...asset('clip','video',20),thumbnailPath:'thumb.jpg'};
 expect(renderToStaticMarkup(React.createElement(MediaTile,{asset:video,srcIn:12,srcOut:15}))).toContain('dream-media://clip/preview#t=12.00');
 expect(renderToStaticMarkup(React.createElement(MediaTile,{asset:video}))).toContain('dream-media://clip/thumbnail');
 const scene={...asset('scene','video',5),scene:{format:'engine' as const,revisionId:'abc',durationInFrames:150}};expect(renderToStaticMarkup(React.createElement(MediaTile,{asset:scene}))).toContain('scene-peek');
 expect(renderToStaticMarkup(React.createElement(MediaTile,{asset:{...asset('song','audio',30),waveform:[.2,.5,.8]}}))).toContain('media-tile-wave');
 const pending=renderToStaticMarkup(React.createElement(MediaTile,{label:'holiday.MOV',onRemove:()=>{}}));expect(pending).toContain('media-tile chip video');expect(pending).toContain('aria-label="Remove holiday.MOV"');
});

it('saves the timeline selection with the message that referred to it',()=>{
 const {db,footage}=project();try{
  db.userMessage('Make this brighter','turn',['early'],[{id:'c1',kind:'clip',assetId:'early',srcIn:1,srcOut:3,label:'early.mp4',start:0,end:2}]);
  const message=db.state().messages.find(m=>m.turnId==='turn')!;expect(message.assetIds).toEqual(['early']);expect(message.selection).toEqual([expect.objectContaining({id:'c1',srcIn:1,srcOut:3})]);void footage;
 }finally{db.close();}
});
