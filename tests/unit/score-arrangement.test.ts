import {it,expect} from 'vitest';
import {arrangeScore,renderArrangement,bindScore,renderSound,SoundDesignSchema} from '@dream/procedural-media';
const fixture=()=>arrangeScore({id:'score',seed:4,tempo:120,key:0,durationSec:.5,mood:'warm',intensity:.7,instruments:['keys','bass']});
it('renders editable notes and automation into matching stereo stems and master',()=>{
 const doc=fixture(),stems:Uint8Array[]=[];const first=renderArrangement(doc,(_,wav)=>stems.push(wav));expect(new DataView(first.wav.buffer).getUint16(22,true)).toBe(2);
 for(let n=44;n<first.wav.length;n+=2){const sum=stems.reduce((total,wav)=>total+new DataView(wav.buffer,wav.byteOffset,wav.byteLength).getInt16(n,true),0)*first.masterGain;expect(Math.abs(new DataView(first.wav.buffer).getInt16(n,true)-sum)).toBeLessThan(4);}
 doc.tracks[0].automation=[{target:'pan',points:[{beat:0,value:-1},{beat:1,value:1}]}];doc.tracks[0].notes[0].pitch+=12;expect(renderArrangement(doc).wav).not.toEqual(first.wav);expect(renderArrangement(doc).wav).toEqual(renderArrangement(doc).wav);
});
it('retimes bound notes with their section and rejects silently truncated arrangements',()=>{
 const doc=fixture();doc.bindings=[{sectionId:doc.sections[0].id,beatId:'reveal',offsetSec:0,followDuration:true}];
 const bound=bindScore(doc,[{id:'reveal',startSec:2,durationSec:1}]);expect(bound.score.sections[0].startBeat).toBe(4);expect(bound.score.tracks[0].notes[0].beat).toBe(4);expect(bound.score.tracks[0].notes[0].durationBeats).toBe(doc.tracks[0].notes[0].durationBeats*2);expect(bound.score.durationSec).toBe(3);expect(doc.sections[0].startBeat).toBe(0);
 expect(()=>bindScore(doc,[{id:'reveal',startSec:601,durationSec:1}])).toThrow();expect(bindScore(doc,[]).unresolved).toEqual(['reveal']);
});
it('synthesizes custom sounds deterministically with editable pitch sweeps',()=>{
 const doc=SoundDesignSchema.parse({schemaVersion:1,id:'sound',title:'Sweep',seed:4,durationSec:.1,layers:[{id:'noise',wave:'noise',startSec:0,durationSec:.1,frequencyHz:100,endFrequencyHz:400,gainDb:-3,pan:.5,attackSec:.01,releaseSec:.05,filterHz:800}]});const a=renderSound(doc);expect(a.wav).toEqual(renderSound(doc).wav);doc.layers[0].filterHz=4000;expect(renderSound(doc).wav).not.toEqual(a.wav);
});
