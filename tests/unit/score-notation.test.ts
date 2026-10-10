import {it,expect} from 'vitest';
import {scoreFromNotation,noteNumber,durationBeats,chordNotes,NotationError,renderArrangement} from '@dream/procedural-media';

it('reads note names, durations and chord symbols',()=>{
 expect(noteNumber('C4')).toBe(60);expect(noteNumber('A4')).toBe(69);expect(noteNumber('F#3')).toBe(54);expect(noteNumber('Bb2')).toBe(46);
 expect(durationBeats('4n',4)).toBe(1);expect(durationBeats('8n',4)).toBe(.5);expect(durationBeats('4n.',4)).toBe(1.5);expect(durationBeats('8t',4)).toBeCloseTo(1/3);expect(durationBeats('1n',4)).toBe(4);
 expect(chordNotes('Am',3)).toEqual([57,60,64]);expect(chordNotes('Cmaj7',3)).toEqual([48,52,55,59]);expect(chordNotes('C/E',4)).toEqual([52,60,64,67]);
});

it('expands drum patterns, note strings, progressions and arpeggios into a valid score that repeats to fill its sections',()=>{
 const score=scoreFromNotation({title:'Test',tempo:120,key:'A minor',sections:[{name:'intro',bars:2,kind:'intro'},{name:'main',bars:4}],tracks:[
  {instrument:'kick',pattern:'x...x...x...x...',sections:['main']},
  {instrument:'hat',pattern:'.x.x .x.x .x.x .x.x',velocity:.5},
  {instrument:'bass',notes:'A2:8n A2 C3 E3:4n r:2n'},
  {instrument:'pad',chords:['Am','F','C','G']},
  {instrument:'pluck',arp:{chords:['Am','F'],rate:'8n',octaves:2},sections:['intro'],repeat:1},
 ]},'theme');
 expect(score).toMatchObject({schemaVersion:2,id:'theme',tempo:120,key:9,mode:'minor',durationSec:12,meter:{beatsPerBar:4,beatUnit:4}});
 expect(score.sections.map(s=>[s.name,s.startBeat,s.durationBeats])).toEqual([['intro',0,8],['main',8,16]]);
 const kick=score.tracks[0].notes;expect(kick).toHaveLength(16);expect(kick[0]).toMatchObject({beat:8,pitch:36});
 expect(score.tracks[1].notes).toHaveLength(48);expect(score.tracks[1].notes[0]).toMatchObject({beat:.25,velocity:.5});
 expect(score.tracks[2].notes.slice(0,4).map(n=>[n.beat,n.pitch])).toEqual([[0,45],[.5,45],[1,48],[1.5,52]]);
 expect(score.tracks[3].notes.filter(n=>n.beat===4).map(n=>n.pitch)).toEqual([53,57,60]);
 expect(score.tracks[4].notes).toHaveLength(16);expect(Math.max(...score.tracks[4].notes.map(n=>n.beat))).toBe(7.5);
 const rendered=renderArrangement(score);expect(rendered.wav.byteLength).toBeGreaterThan(48000*12);expect(rendered.beats.slice(0,3)).toEqual([0,.5,1]);
});

it('fills a requested duration, accepts full documents and names the field that is wrong',()=>{
 expect(scoreFromNotation({tempo:100,durationSec:9,tracks:[{instrument:'keys',chords:['C','G']}]}).durationSec).toBeCloseTo(9);
 const full=scoreFromNotation({tempo:90,tracks:[{instrument:'lead',notes:'C4 D4 E4'}]});expect(scoreFromNotation({...full,id:undefined})).toMatchObject({schemaVersion:2,tempo:90});
 const failure=(input:unknown)=>{try{scoreFromNotation(input);}catch(error){expect(error).toBeInstanceOf(Error);return(error as Error).message;}return'';};
 expect(failure({tempo:120,tracks:[{instrument:'bass',notes:'A2 H4'}]})).toContain('tracks[0].notes token 2');
 expect(failure({tempo:120,tracks:[{instrument:'kick',pattern:'x..z'}]})).toContain('tracks[0].pattern');
 expect(failure({tempo:120,tracks:[{instrument:'pad',chords:['Qm']}]})).toContain('tracks[0].chords[0]');
 expect(failure({tempo:400,tracks:[{instrument:'pad',chords:['C']}]})).toContain('tempo');
 expect(failure({tempo:120,tracks:[{instrument:'kick',pattern:'x...',sections:['verse']}]})).toContain('"verse" is not a section');
 expect(failure({tempo:120,tracks:[{instrument:'kick',pattern:'x...',notes:'C4'}]})).toContain('exactly one');
 expect(new NotationError('a','b').message).toBe('a: b');
});
