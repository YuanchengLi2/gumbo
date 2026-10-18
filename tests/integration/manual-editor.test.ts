import {clipStyle,clipStyleAt} from '../../packages/composition/src/visual-style';
import {transitionOps} from '../../apps/desktop/src/renderer/manual/model';
import {canvasPresets} from '@dream/timeline';
import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AssetSchema,emptyFootage} from '@dream/footage';
import {emptyTimeline,ClipSchema,apply,resolve,type TimelineDocument} from '@dream/timeline';
import {ProjectDB} from '@dream/project-db';
import {processBatch} from '@dream/guardrails';
import {audioManifest} from '@dream/compositor';
import {addAsset,trimItems,moveItems,splitItems,duplicateItems} from '../../apps/desktop/src/renderer/manual/model';
import {selectRange,toggleSelection} from '../../apps/desktop/src/renderer/manual/opencut/selection/state';
const footage=emptyFootage();footage.assets=[AssetSchema.parse({id:'v',filename:'Video',kind:'video',originalPath:'v.mp4',durationSec:20,hasAudio:true,fingerprint:'v'}),AssetSchema.parse({id:'still',filename:'Still',kind:'image',originalPath:'s.png',durationSec:5,fingerprint:'s'}),AssetSchema.parse({id:'audio',filename:'Audio',kind:'audio',originalPath:'s.wav',durationSec:8,hasAudio:true,fingerprint:'a'})];
function timeline(){const t=emptyTimeline('t');t.spine=['a','b','c','d'].map(id=>ClipSchema.parse({id,assetId:'v',srcIn:2,srcOut:5,reason:'Fixture'}));return t;}
it('uses OpenCut resize bounds for speed-aware source trims and still-image holds',()=>{
 const t=timeline();t.spine[0].speed=2;const next=apply(t,trimItems(t,footage,['a'],'right',.5),footage);expect(next.spine[0].srcOut).toBe(6);expect(resolve(next,footage).clips[0].durationInFrames).toBe(60);
 const bounded=apply(t,trimItems(t,footage,['a'],'left',-20),footage);expect(bounded.spine[0].srcIn).toBe(0);
 const image=apply(emptyTimeline('image'),addAsset(emptyTimeline('image'),footage,'still','video',0),footage);const held=apply(image,trimItems(image,footage,[image.spine[0].id],'right',2),footage);expect(held.spine[0].holdSec).toBe(7);
});
it('moves a selection together in both directions and pastes without changing unrelated source intervals',()=>{
 const t=timeline(),right=apply(t,moveItems(t,footage,['a','b'],12),footage);expect(right.spine.map(c=>c.id)).toEqual(['c','d','a','b']);const left=apply(t,moveItems(t,footage,['c','d'],-6),footage);expect(left.spine.map(c=>c.id)).toEqual(['c','d','a','b']);
 const pasted=apply(t,duplicateItems(t,footage,['a'],4,t),footage);expect(pasted.spine).toHaveLength(6);expect(pasted.spine[2].srcIn).toBe(2);expect(pasted.spine[2].srcOut).toBe(5);expect(resolve(pasted,footage).durationSec).toBe(15);
});
it('splits and trims anchored layers explicitly and supports audio/title-only canvas duration',()=>{
 const t=timeline();t.attached=[{id:'title',type:'overlay',component:'lower_third',start:{kind:'project',at:'start',offsetSec:1},end:{kind:'project',at:'start',offsetSec:5},params:{text:'Title'},layer:0,reason:'Fixture'}];
 const ops=splitItems(t,footage,['title'],3),next=apply(t,JSON.parse(JSON.stringify(ops)),footage);expect(next.attached[0].end).toBeUndefined();expect(next.attached[0].durationSec).toBe(2);expect(next.spine).toEqual(t.spine);
 const moved=apply(next,moveItems(next,footage,['title'],2,'visual:2'),footage);expect(moved.attached[0].layer).toBe(2);expect(resolve(moved,footage).items[0].timelineStart).toBe(3);
 const onlyAudio=processBatch(emptyTimeline('a'),addAsset(emptyTimeline('a'),footage,'audio','music:0',0),footage,undefined,{snapToSpeech:false});expect(onlyAudio.resolved.durationSec).toBe(8);expect(audioManifest(onlyAudio.timeline,footage)[0].durationSamples).toBe(8*48000);const shortened=apply(onlyAudio.timeline,[{type:'update_music',musicId:onlyAudio.timeline.music[0].id,changes:{srcOut:3},reason:'Shorten'}],footage);expect(resolve(shortened,footage).durationSec).toBe(3);
 const duplicate=apply(t,duplicateItems(t,footage,['title'],2),footage);expect(duplicate.spine).toEqual(t.spine);
});
it('preserves manual frame precision, track locks and mute through durable undo/reopen',()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-manual-'));let db=new ProjectDB(folder,'Manual');try{for(const a of footage.assets)db.saveAsset(a);db.saveRecords('words',[{id:'w',assetId:'v',text:'hello',start:0,end:.2,confidence:1}]);db.apply(addAsset(db.timeline(),footage,'v','video',0),'Add','add',db.head(),undefined,{snapToSpeech:false});const id=db.timeline().spine[0].id;
  db.apply([{type:'trim_clip',clipId:id,srcIn:.1,reason:'Exact manual trim'}],'Trim','trim',db.head(),undefined,{snapToSpeech:false});expect(db.timeline().spine[0].srcIn).toBe(.1);
  db.apply([{type:'set_project_settings',settings:{width:1080},reason:'Unrelated AI edit'}],'Format','format',db.head());expect(db.timeline().spine[0].srcIn).toBe(.1);
  db.apply([{type:'set_track_settings',trackId:'video',settings:{locked:true,muted:true},reason:'Lock'}],'Lock','lock',db.head());expect(()=>db.apply([{type:'delete_clips',clipIds:[id],reason:'Delete'}],'Delete','delete',db.head())).toThrow('Unlock');expect(audioManifest(db.timeline(),db.footage())).toEqual([]);db.undo();expect(db.timeline().trackSettings?.video?.locked).not.toBe(true);db.close();db=new ProjectDB(folder);expect(db.timeline().spine[0].srcIn).toBe(.1);
 }finally{db.close();}
});
it('uses upstream range and additive selection semantics',()=>{const range=selectRange({state:{selectedIds:['b'],anchorId:'b'},orderedIds:['a','b','c','d'],targetId:'d',isAdditive:false});expect(range.selectedIds).toEqual(['b','c','d']);expect(toggleSelection({state:range,id:'c'}).selectedIds).toEqual(['b','d']);});

it('keeps canvas presets and transforms durable and supplies real transition handles',()=>{
 const t=timeline();t.spine[0].srcIn=0;t.spine[0].srcOut=20;t.spine[1].srcIn=0;t.spine[1].srcOut=20;
 const transitioned=processBatch(t,transitionOps(t,footage,'b','crossfade'),footage,undefined,{snapToSpeech:false}).timeline;
 // The library's cross dissolve lasts half a second: each side gives a quarter second of handle.
 expect(transitioned.spine[1].transitionIn?.durationSec).toBe(.5);expect(transitioned.spine[0].srcOut).toBeCloseTo(19.75);expect(transitioned.spine[1].srcIn).toBeCloseTo(.25);
 for(const preset of canvasPresets){const changed=apply(transitioned,[{type:'set_project_settings',settings:{width:preset.width,height:preset.height},reason:'Ratio'}],footage);expect(changed.settings.width/changed.settings.height).toBeCloseTo(preset.width/preset.height);}
 const style=clipStyle({mode:'fit',scale:1.2,x:.2,y:.7,rotation:90,flipX:true,opacity:.5,exposure:1,contrast:1.2,saturation:.8});expect(style.objectFit).toBe('contain');expect(style.transform).toContain('rotate(90deg)');expect(style.transform).toContain('scaleX(-1)');expect(style.filter).toContain('brightness(2)');
});
