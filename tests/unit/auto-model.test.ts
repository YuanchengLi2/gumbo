import {it,expect} from 'vitest';
import {autoModel,fairOrder,workOf,bestFor,works,agentModels,modelCatalog,modelInfo,typicalCost,usageCost} from '@dream/config';

const all:Partial<Record<'deepseek'|'openai'|'google',boolean>>={deepseek:true,openai:true,google:true};
const seeds=Array.from({length:60},(_,n)=>'turn-'+n);
/** Every model Auto's fallback runs for a score, over many requests. */
const across=(score:Parameters<typeof autoModel>[0],providers=all)=>new Set(seeds.map(seed=>autoModel(score,providers,seed)));
const tier=(t:string)=>new Set(modelCatalog.filter(m=>m.tier===t).map(m=>m.id));

it('falls back to the tier of model the work needs, with every provider\'s model in it an equal candidate',()=>{
 // One setting on one thing and small talk: any light model.
 expect(across({kind:'edit',difficulty:1,work:'fix'})).toEqual(tier('light'));
 expect(across({kind:'answer',difficulty:1,work:'talk'})).toEqual(tier('light'));
 // Real edits, footage, sound and graphics, scripts: any strong model (Claude Sonnet, GPT-6.1 Sol, Gemini 4 Argon).
 for(const d of [2,3,4])expect(across({kind:'edit',difficulty:d,work:'fix'})).toEqual(tier('strong'));
 for(const work of ['footage','sound','graphics'] as const)expect(across({kind:'edit',difficulty:4,work})).toEqual(tier('strong'));
 expect(across({kind:'answer',difficulty:3,work:'write'})).toEqual(tier('strong'));
 // Whole-video work and big plans: any frontier model.
 expect(across({kind:'edit',difficulty:4,work:'restructure'})).toEqual(tier('frontier'));expect(across({kind:'plan',difficulty:5})).toEqual(tier('frontier'));
 // One request always gets the same model; without other providers' keys, only Claude can run.
 expect(autoModel({kind:'edit',difficulty:3,work:'fix'},all,'turn-7')).toBe(autoModel({kind:'edit',difficulty:3,work:'fix'},all,'turn-7'));
 expect(across({kind:'edit',difficulty:3,work:'fix'},{})).toEqual(new Set([agentModels.sonnet]));expect(across({kind:'plan',difficulty:5},{})).toEqual(new Set([agentModels.opus]));
});

it('lists the models to the router in an order that rotates per request, and describes each tier\'s models alike',()=>{
 const ids=modelCatalog.map(m=>m.id);
 expect(new Set(seeds.map(seed=>fairOrder(ids,seed)[0]))).toEqual(new Set(ids));
 for(const seed of seeds.slice(0,5))expect([...fairOrder(ids,seed)].sort()).toEqual([...ids].sort());
 // No provider is described as the usual choice: models of one tier read the same to the router and in the menu.
 for(const t of ['light','strong','frontier']){const same=modelCatalog.filter(m=>m.tier===t);expect(new Set(same.map(m=>m.guide)).size).toBe(1);expect(new Set(same.map(m=>m.detail)).size).toBe(1);}
});

it('runs the model Haiku chose, weighing difficulty against cost, from every model that can run',()=>{
 expect(autoModel({kind:'edit',difficulty:3,work:'footage',model:'gemini-argon'},all)).toBe('gemini-4-argon');
 expect(autoModel({kind:'answer',difficulty:2,work:'write',model:'gpt-sol'},all)).toBe('gpt-6.1-sol');
 expect(autoModel({kind:'edit',difficulty:5,work:'restructure',model:'opus'},all)).toBe(agentModels.opus);
 // A pick needs a key on the gateway and must be a real model; otherwise the tier's fallback decides.
 expect(autoModel({kind:'edit',difficulty:3,work:'footage',model:'gemini-argon'},{})).toBe(agentModels.sonnet);
 expect(tier('strong').has(autoModel({kind:'edit',difficulty:3,work:'fix',model:'gpt-9-ultra'},all,'turn-3'))).toBe(true);
 // What Haiku weighs: a typical request's cost on each model, from the vlog's Opus runs scaled by list price, at today's price.
 expect(typicalCost(modelInfo('opus')!)).toBe(.55);expect(typicalCost(modelInfo('sonnet')!)).toBe(.28);expect(typicalCost(modelInfo('haiku')!)).toBe(.01);expect(typicalCost(modelInfo('gpt-astra')!)).toBe(1.38);
 expect(typicalCost(modelInfo('gemini-argon')!,new Date('2026-11-30T12:00:00Z'))).toBe(.28);expect(typicalCost(modelInfo('gemini-argon')!,new Date('2026-12-02T12:00:00Z'))).toBe(.55);
 expect(modelCatalog.every(m=>m.guide.length>20)).toBe(true);
});

it('reads the work from the score when the triage did not name it, and every kind of work has a tier at every difficulty',()=>{
 expect(workOf({kind:'edit',difficulty:1})).toBe('fix');expect(workOf({kind:'edit',difficulty:5})).toBe('restructure');
 expect(workOf({kind:'answer',difficulty:1})).toBe('talk');expect(workOf({kind:'answer',difficulty:3})).toBe('look');
 for(const work of works)for(let d=1;d<=5;d++){const band=bestFor[work].find(b=>d<=b.upTo);expect(band,`${work} ${d}`).toBeTruthy();expect(modelCatalog.some(m=>m.tier===band!.tier)).toBe(true);}
});

it('lists every model once with its price, without DeepSeek V4 Pro, and bills other providers without cache writes',()=>{
 expect(new Set(modelCatalog.map(m=>m.id)).size).toBe(modelCatalog.length);
 expect(modelCatalog.some(m=>/deepseek-v4-pro/.test(m.id))).toBe(false);
 expect(modelCatalog.some(m=>/cheapest/i.test(m.detail))).toBe(false);
 expect(usageCost('deepseek-flash',{input_tokens:1_000_000,cache_read_input_tokens:1_000_000,output_tokens:1_000_000},undefined,new Date('2026-10-14T02:00:00Z'))).toBeCloseTo(.3+.006+1.2,9);
});
