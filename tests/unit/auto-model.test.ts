import {it,expect} from 'vitest';
import {autoModel,workOf,bestFor,works,agentModels,modelCatalog,usageCost} from '@dream/config';

it('Auto picks the best model for the kind of work at its difficulty, not the cheapest',()=>{
 const all={deepseek:true,openai:true,google:true};
 // "make the caption white": one setting on one thing, Haiku; DeepSeek took 12 minutes over it.
 expect(autoModel({kind:'edit',difficulty:1,work:'fix'},all)).toBe(agentModels.haiku);
 // Precise fixes and new graphics: Sonnet, which made most edits work at the first try and writes the scenes.
 for(const d of [2,3,4])expect(autoModel({kind:'edit',difficulty:d,work:'fix'},all)).toBe(agentModels.sonnet);
 expect(autoModel({kind:'edit',difficulty:4,work:'graphics'},all)).toBe(agentModels.sonnet);
 // Choosing footage, b-roll, a first cut, a whole-video rework: Opus, whose b-roll the user kept.
 expect(autoModel({kind:'edit',difficulty:3,work:'footage'},all)).toBe(agentModels.opus);
 expect(autoModel({kind:'edit',difficulty:2,work:'footage'},all)).toBe(agentModels.sonnet);
 expect(autoModel({kind:'edit',difficulty:4,work:'restructure'},all)).toBe(agentModels.opus);
 expect(autoModel({kind:'edit',difficulty:4,work:'sound'},all)).toBe(agentModels.opus);expect(autoModel({kind:'edit',difficulty:3,work:'sound'},all)).toBe(agentModels.sonnet);
 // Answers: small talk on Haiku, a question about the video on a model that looks well, a real script on Opus.
 expect(autoModel({kind:'answer',difficulty:1,work:'talk'},all)).toBe(agentModels.haiku);
 expect(autoModel({kind:'answer',difficulty:2,work:'look'},all)).toBe(agentModels.sonnet);
 expect(autoModel({kind:'answer',difficulty:3,work:'write'},all)).toBe(agentModels.opus);
 expect(autoModel({kind:'plan',difficulty:5},{})).toBe(agentModels.opus);expect(autoModel({kind:'plan',difficulty:3},{})).toBe(agentModels.sonnet);
});

it('reads the work from the score when the triage did not name it, and every kind of work has a model at every difficulty',()=>{
 expect(workOf({kind:'edit',difficulty:1})).toBe('fix');expect(workOf({kind:'edit',difficulty:5})).toBe('restructure');
 expect(workOf({kind:'answer',difficulty:1})).toBe('talk');expect(workOf({kind:'answer',difficulty:3})).toBe('look');
 expect(autoModel({kind:'edit',difficulty:3},{})).toBe(agentModels.sonnet);
 for(const work of works)for(let d=1;d<=5;d++){const band=bestFor[work].find(b=>d<=b.upTo);expect(band,`${work} ${d}`).toBeTruthy();for(const choice of band!.models)expect(modelCatalog.some(m=>m.choice===choice)).toBe(true);}
 // Another provider stands in only where it is listed and has a key; Claude always can run.
 expect(autoModel({kind:'edit',difficulty:3,work:'fix'},{})).toBe(agentModels.sonnet);
});

it('lists every model once with its price, without DeepSeek V4 Pro, and bills other providers without cache writes',()=>{
 expect(new Set(modelCatalog.map(m=>m.id)).size).toBe(modelCatalog.length);
 expect(modelCatalog.some(m=>/deepseek-v4-pro/.test(m.id))).toBe(false);
 expect(modelCatalog.some(m=>/cheapest/i.test(m.detail))).toBe(false);
 expect(usageCost('deepseek-flash',{input_tokens:1_000_000,cache_read_input_tokens:1_000_000,output_tokens:1_000_000})).toBeCloseTo(.3+.006+1.2,9);
});
