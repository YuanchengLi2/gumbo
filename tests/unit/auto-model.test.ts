import {it,expect} from 'vitest';
import {autoModel,workOf,bestFor,works,agentModels,modelCatalog,modelInfo,typicalCost,usageCost} from '@dream/config';

it('falls back to the least expensive model that does the kind of work well: Sonnet for real edits, Opus only for whole-video work',()=>{
 const all={deepseek:true,openai:true,google:true};
 // "make the caption white": one setting on one thing, Haiku; DeepSeek took 12 minutes over it.
 expect(autoModel({kind:'edit',difficulty:1,work:'fix'},all)).toBe(agentModels.haiku);
 // Real edits, including choosing footage and sound: Sonnet. Two vlog requests on Opus cost $0.54 and $0.64.
 for(const d of [2,3,4])expect(autoModel({kind:'edit',difficulty:d,work:'fix'},all)).toBe(agentModels.sonnet);
 for(const work of ['footage','sound','graphics'] as const)expect(autoModel({kind:'edit',difficulty:4,work},all)).toBe(agentModels.sonnet);
 // Whole-video work: Opus from 4 (a first cut of long footage, restructuring).
 expect(autoModel({kind:'edit',difficulty:4,work:'restructure'},all)).toBe(agentModels.opus);expect(autoModel({kind:'edit',difficulty:5,work:'footage'},all)).toBe(agentModels.opus);
 expect(autoModel({kind:'answer',difficulty:1,work:'talk'},all)).toBe(agentModels.haiku);expect(autoModel({kind:'answer',difficulty:3,work:'write'},all)).toBe(agentModels.sonnet);
 expect(autoModel({kind:'plan',difficulty:5},{})).toBe(agentModels.opus);expect(autoModel({kind:'plan',difficulty:3},{})).toBe(agentModels.sonnet);
});

it('runs the model Haiku chose, weighing difficulty against cost, from every model that can run',()=>{
 const all={deepseek:true,openai:true,google:true};
 expect(autoModel({kind:'edit',difficulty:3,work:'footage',model:'gemini-argon'},all)).toBe('gemini-4-argon');
 expect(autoModel({kind:'answer',difficulty:2,work:'write',model:'gpt-sol'},all)).toBe('gpt-6.1-sol');
 expect(autoModel({kind:'edit',difficulty:5,work:'restructure',model:'opus'},all)).toBe(agentModels.opus);
 // A pick needs a key on the gateway and must be a real model; otherwise the fallback decides.
 expect(autoModel({kind:'edit',difficulty:3,work:'footage',model:'gemini-argon'},{})).toBe(agentModels.sonnet);
 expect(autoModel({kind:'edit',difficulty:3,work:'fix',model:'gpt-9-ultra'},all)).toBe(agentModels.sonnet);
 // What Haiku weighs: a typical request's cost on each model, from the vlog's Opus runs scaled by list price.
 expect(typicalCost(modelInfo('opus')!)).toBe(.55);expect(typicalCost(modelInfo('sonnet')!)).toBe(.28);expect(typicalCost(modelInfo('haiku')!)).toBe(.01);expect(typicalCost(modelInfo('gpt-astra')!)).toBe(1.38);
 expect(modelCatalog.every(m=>m.guide.length>20)).toBe(true);
});

it('reads the work from the score when the triage did not name it, and every kind of work has a model at every difficulty',()=>{
 expect(workOf({kind:'edit',difficulty:1})).toBe('fix');expect(workOf({kind:'edit',difficulty:5})).toBe('restructure');
 expect(workOf({kind:'answer',difficulty:1})).toBe('talk');expect(workOf({kind:'answer',difficulty:3})).toBe('look');
 expect(autoModel({kind:'edit',difficulty:3},{})).toBe(agentModels.sonnet);
 for(const work of works)for(let d=1;d<=5;d++){const band=bestFor[work].find(b=>d<=b.upTo);expect(band,`${work} ${d}`).toBeTruthy();for(const choice of band!.models)expect(modelCatalog.some(m=>m.choice===choice)).toBe(true);}
 // GPT-6 Astra (five times Sonnet's cost) is never a fallback; it runs only when picked.
 expect(works.some(w=>bestFor[w].some(b=>b.models.includes('gpt-astra')))).toBe(false);
});

it('lists every model once with its price, without DeepSeek V4 Pro, and bills other providers without cache writes',()=>{
 expect(new Set(modelCatalog.map(m=>m.id)).size).toBe(modelCatalog.length);
 expect(modelCatalog.some(m=>/deepseek-v4-pro/.test(m.id))).toBe(false);
 expect(modelCatalog.some(m=>/cheapest/i.test(m.detail))).toBe(false);
 expect(usageCost('deepseek-flash',{input_tokens:1_000_000,cache_read_input_tokens:1_000_000,output_tokens:1_000_000},undefined,new Date('2026-10-14T02:00:00Z'))).toBeCloseTo(.3+.006+1.2,9);
});
