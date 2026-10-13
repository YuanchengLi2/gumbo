import {it,expect} from 'vitest';
import {autoModel,agentModels,modelCatalog,usageCost} from '@dream/config';

it('Auto picks the model for each request among the ones that can run',()=>{
 // Small, precise changes to an edit that exists go to Haiku; anything new or across the video stays on Sonnet.
 expect(autoModel({route:{route:'local',complexity:'simple'},text:'trim the second clip',hasEdit:true})).toBe(agentModels.haiku);
 expect(autoModel({route:{route:'local',complexity:'normal'},text:'add music under the whole video',hasEdit:true})).toBe(agentModels.sonnet);
 expect(autoModel({route:{route:'local',complexity:'normal'},text:'make a first cut from my clips',hasEdit:false})).toBe(agentModels.sonnet);
 // Opus plans difficult work; the approved plan then runs on what Auto picks for doing it.
 expect(autoModel({route:{route:'plan',complexity:'difficult'},text:'condense my vlog to 10 minutes',hasEdit:false,planning:true})).toBe(agentModels.opus);
 expect(autoModel({route:{route:'local',complexity:'difficult'},text:'condense my vlog to 10 minutes',hasEdit:false})).toBe(agentModels.sonnet);
 // A question goes to Gemini Flash only when its key is on the gateway.
 expect(autoModel({route:{route:'question',complexity:'normal'},text:'what is in my footage?',hasEdit:true})).toBe(agentModels.sonnet);
 expect(autoModel({route:{route:'question',complexity:'normal'},text:'what is in my footage?',hasEdit:true,providers:{google:true}})).toBe('gemini-3.8-flash');
});

it('lists every model once with its price, and bills other providers without cache writes',()=>{
 expect(new Set(modelCatalog.map(m=>m.id)).size).toBe(modelCatalog.length);
 expect(usageCost('deepseek-flash',{input_tokens:1_000_000,cache_read_input_tokens:1_000_000,output_tokens:1_000_000})).toBeCloseTo(.3+.006+1.2,9);
});
