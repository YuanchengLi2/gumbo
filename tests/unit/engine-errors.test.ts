import {it,expect} from 'vitest';
import {SoundDesignSchema,describeIssues} from '@dream/procedural-media';

// The Northern Vietnam vlog's chime (October 13, 2026), with a repeated id and too-long fades added: every problem must
// come back at once, saying which layer, which rule and the numbers to fix it with.
const chime={schemaVersion:1,id:'chime',title:'chime',seed:1,durationSec:.6,layers:[
 {id:'chime1',wave:'sine',startSec:0,durationSec:.6,frequencyHz:880,gainDb:-12,attackSec:.004,releaseSec:.5},
 {id:'chime1',wave:'sine',startSec:.01,durationSec:.6,frequencyHz:1320,gainDb:-16,attackSec:.3,releaseSec:.45}]};

it('lists every problem in a sound at once, with the layer, the rule and the numbers',()=>{
 const result=SoundDesignSchema.safeParse(chime);expect(result.success).toBe(false);
 const text=describeIssues(result.error,'sound');
 expect(text.split('\n')).toHaveLength(3);
 expect(text).toContain('layers.1.id: layer 1 (chime1) has the same id as layer 0');
 expect(text).toContain('layers.1.durationSec: layer 1 (chime1) starts at 0.01 s and lasts 0.6 s, so it ends at 0.61 s, after the sound ends at 0.6 s; shorten the layer to at most 0.59 s or set the sound\'s durationSec to at least 0.61 s.');
 expect(text).toContain('layers.1.attackSec:');
 // Following those instructions gives a valid sound.
 const fixed={...chime,durationSec:.61,layers:[chime.layers[0],{...chime.layers[1],id:'chime2',attackSec:.004}]};
 expect(SoundDesignSchema.safeParse(fixed).success).toBe(true);
});

