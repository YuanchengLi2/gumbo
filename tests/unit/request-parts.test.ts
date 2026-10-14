import {it,expect} from 'vitest';
import {parseParts,partsBlocker,notPossibleNote,partsBriefing} from '../../packages/orchestrator/src/request-parts';
import {intelligence} from '../../packages/orchestrator/src/intelligence';

// The vlog's message (October 13, 2026): captions, audio, scenery, all in one breath.
const message='i dont see captions, where are the captions, and then can you normalize the audio, and then go through the scenery shots and color grade them';
const parts=parseParts('{"parts":["Add the missing captions","Normalize the audio","Color grade the scenery shots"]}',message);

it('gives the agent every part of the request and refuses to finish until each is reported on',()=>{
 expect(parts.map(p=>p.id)).toEqual(['p1','p2','p3']);expect(partsBriefing(parts)).toContain('p3: Color grade the scenery shots');
 // Only two of three done: refused, naming the one left.
 expect(partsBlocker(parts,[{id:'p1',status:'done'},{id:'p2',status:'done'}])).toContain('p3 "Color grade the scenery shots"');
 // Not possible needs a reason, and the reason reaches the user.
 expect(partsBlocker(parts,[{id:'p1',status:'done'},{id:'p2',status:'done'},{id:'p3',status:'not_possible'}])).toContain('p3');
 const reports=[{id:'p1',status:'done' as const},{id:'p2',status:'done' as const},{id:'p3',status:'not_possible' as const,note:'There are no scenery shots in the footage.'}];
 expect(partsBlocker(parts,reports)).toBeUndefined();expect(notPossibleNote(parts,reports)).toContain('Color grade the scenery shots: There are no scenery shots in the footage.');
});
it('treats an unreadable split as one part, and a one-part request as done when it finishes',()=>{
 const one=parseParts('nonsense',message);expect(one).toHaveLength(1);expect(partsBlocker(one,undefined)).toBeUndefined();
 expect(intelligence('claude-haiku-5-5','request_parts')).toMatchObject({role:'router',effort:'low'});
});
import {mightHaveSeveralAsks} from '../../packages/orchestrator/src/request-parts';
it('splits only messages that may hold several asks',()=>{
 expect(mightHaveSeveralAsks(message)).toBe(true);
 expect(mightHaveSeveralAsks('Trim the second clip to 4 seconds')).toBe(false);
 expect(mightHaveSeveralAsks('Add captions. Also make the music quieter.')).toBe(true);
});
