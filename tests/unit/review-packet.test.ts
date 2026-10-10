import {it,expect} from 'vitest';
import {emptyTimeline,ClipSchema,ItemSchema} from '@dream/timeline';
import {emptyFootage,AssetSchema} from '@dream/footage';
import {reviewPacket} from '../../packages/orchestrator/src/review-packet';

it('bounds visual evidence while preserving occurrence timing and excluding local paths from cloud evidence',()=>{
 const t=emptyTimeline('p');t.spine=Array.from({length:200},(_,n)=>ClipSchema.parse({id:`clip-${n}`,assetId:'source',srcIn:1,srcOut:4,beatId:'body',reason:'Repeated source'}));
 t.beats=[{id:'body',purpose:'Body',targetSec:600}];
 t.attached=Array.from({length:20},(_,n)=>ItemSchema.parse({id:`title-${n}`,type:'overlay',component:'title_card',start:{kind:'clip',clipId:`clip-${n*10}`,at:'start'},durationSec:1,reason:'Title'}));
 const f=emptyFootage();f.assets=[AssetSchema.parse({id:'source',kind:'video',filename:'video.mp4',originalPath:'C:/private/video.mp4',fingerprint:'f',hasAudio:true,durationSec:6})];
 f.words=[{id:'w',assetId:'source',text:'hello',start:2,end:3,confidence:1,speaker:'unknown',pauseBefore:0}];
 const result=reviewPacket('version',t,f);expect(result.request.frames.length).toBeLessThanOrEqual(16);expect(result.request.frames[0].frame).toBe(0);expect(result.request.frames.at(-1)!.frame).toBe(17999);
 expect(result.evidence.transcript.slice(0,2).map(w=>[w.clipId,w.start])).toEqual([['clip-0',1],['clip-1',4]]);
 for(const segment of result.evidence.audio.segments)expect(segment.startSample).toBe(Number(segment.id.replace('clip-',''))*144000);expect(result.evidence.audio.sampled).toBe(true);expect(result.evidence.beats[0].actualSec).toBe(600);
 expect(JSON.stringify(result.evidence)).not.toContain('C:/private');expect(result.evidence.cuts).toHaveLength(80);expect(result.evidence.coverage.cutCount).toBe(200);expect(result.evidence.coverage.cutSheetSampled).toBe(true);
});
