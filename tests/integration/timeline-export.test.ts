import {it,expect} from 'vitest';
import {timelineXML,exchangeTracks,type ExchangeClip} from '../../apps/desktop/src/main/timeline-xml';
import {audioAutomation,envelope,type AudioSegment} from '../../packages/composition/src/audio-manifest';
const clip=(id:string,extra:Partial<ExchangeClip>={}):ExchangeClip=>({id,name:id,path:'C:/media/'+id+'.wav',kind:'audio',track:'Same name',trackId:id,trackOrder:0,start:0,end:2,sourceIn:1,sourceOut:3,sourceDuration:5,sourceFps:30,width:0,height:0,enabled:true,...extra});
it('keeps same-named tracks separate, splits overlapping lanes, and maps both stereo channels',()=>{
 const clips=[clip('a',{trackId:'dialogue',linkGroup:'video'}),clip('b',{trackId:'music'}),clip('c',{trackId:'music',start:1,end:3}),clip('video',{kind:'video',trackId:'video',linkGroup:'video',width:1920,height:1080,sourceFps:24000/1001})];
 expect(exchangeTracks(clips).filter(t=>t.kind==='audio')).toHaveLength(6);
 const xml=timelineXML('A & B',{fps:30,width:1920,height:1080},3,clips);
 expect(xml).toContain('A &amp; B');expect(xml).toContain('<trackindex>2</trackindex></sourcetrack>');expect(xml).toContain('<linkclipref>video</linkclipref>');expect(xml).toContain('<ntsc>TRUE</ntsc>');expect(xml).toContain('<start>30</start><end>90</end>');
});
it('exports the preview gain, fades and dialogue ducking at their boundaries',()=>{
 const segment:AudioSegment={id:'music',assetId:'a',startSample:48000,sourceStartSample:0,durationSamples:192000,speed:1,gainDb:-6,fadeInSamples:48000,fadeOutSamples:48000,duckDb:9};
 const keys=audioAutomation(segment,[{start:2,end:3}],30);
 expect(keys.find(k=>k.timeSec===1)?.value).toBeCloseTo(envelope(segment,96000,true));
 expect(keys.find(k=>k.timeSec===2)?.value).toBeCloseTo(envelope(segment,144000,false));
 expect(keys[0].value).toBe(0);expect(keys.at(-1)!.value).toBe(0);
});
