import {it,expect} from 'vitest';
import {autoModel,autoModels,routerChoices,isTier,workOf,bestFor,works,agentModels,modelCatalog,modelInfo,typicalCost,usageCost} from '@dream/config';

const all:Partial<Record<'deepseek'|'openai'|'google',boolean>>={deepseek:true,openai:true,google:true};
const sol='gpt-6.1-sol';

it('runs Haiku for light work, GPT-6.1 Sol for real edits and Opus for the hardest, and nothing else',()=>{
 // One setting on one thing and small talk: Haiku.
 expect(autoModel({kind:'edit',difficulty:1,work:'fix'},all)).toBe(agentModels.haiku);expect(autoModel({kind:'answer',difficulty:1,work:'talk'},all)).toBe(agentModels.haiku);
 // Real edits, footage, sound, graphics and scripts: Sol (Sonnet's price, half its cache-read rate).
 for(const d of [2,3,4])expect(autoModel({kind:'edit',difficulty:d,work:'fix'},all)).toBe(sol);
 for(const work of ['footage','sound','graphics'] as const)expect(autoModel({kind:'edit',difficulty:4,work},all)).toBe(sol);
 expect(autoModel({kind:'answer',difficulty:3,work:'write'},all)).toBe(sol);expect(autoModel({kind:'plan',difficulty:3},all)).toBe(sol);
 // Whole-video work and big plans: Opus.
 expect(autoModel({kind:'edit',difficulty:4,work:'restructure'},all)).toBe(agentModels.opus);expect(autoModel({kind:'plan',difficulty:5},all)).toBe(agentModels.opus);
 // Every score lands on one of the three.
 const ran=new Set<string>();for(const work of works)for(let d=1;d<=5;d++)for(const kind of ['edit','answer','plan'] as const)ran.add(autoModel({kind,difficulty:d,work},all));
 expect([...ran].sort()).toEqual([agentModels.haiku,agentModels.opus,sol].sort());
});

it('counts a model the router names as its tier, and stands Sonnet in for Sol only when Sol cannot run',()=>{
 expect(autoModel({kind:'edit',difficulty:3,work:'fix',model:'strong'},all)).toBe(sol);expect(autoModel({kind:'edit',difficulty:1,work:'fix',model:'frontier'},all)).toBe(agentModels.opus);
 // Other models are never Auto's: a name of one counts as its tier.
 expect(autoModel({kind:'edit',difficulty:3,work:'footage',model:'gemini-argon'},all)).toBe(sol);expect(autoModel({kind:'edit',difficulty:3,work:'fix',model:'sonnet'},all)).toBe(sol);
 expect(autoModel({kind:'answer',difficulty:1,work:'talk',model:'deepseek-flash'},all)).toBe(agentModels.haiku);expect(autoModel({kind:'edit',difficulty:5,work:'restructure',model:'gpt-astra'},all)).toBe(agentModels.opus);
 expect(autoModel({kind:'edit',difficulty:3,work:'fix',model:'gpt-9-ultra'},all)).toBe(sol);
 // No OpenAI key on the gateway: Sonnet does Sol's work.
 expect(autoModel({kind:'edit',difficulty:3,work:'fix'},{})).toBe(agentModels.sonnet);expect(autoModel({kind:'edit',difficulty:3,work:'fix',model:'strong'},{google:true})).toBe(agentModels.sonnet);
 expect(autoModels).toEqual({light:['haiku'],strong:['gpt-sol','sonnet'],frontier:['opus']});
});

it('shows the router the three tiers without providers, each at its model\'s cost',()=>{
 const choices=routerChoices(all);
 expect(choices.map(c=>c.id)).toEqual(['light','strong','frontier']);expect(JSON.stringify(choices)).not.toMatch(/claude|sonnet|opus|haiku|gpt|gemini|deepseek|anthropic|openai|google/i);
 expect(choices.map(c=>c.costPerRequest)).toEqual(['about $0.01','about $0.28','about $0.55']);
 expect(routerChoices({}).map(c=>c.id)).toEqual(['light','strong','frontier']);
 expect(isTier('strong')).toBe(true);expect(isTier('sonnet')).toBe(false);
});

it('describes each tier\'s models alike, and prices them at the day\'s rate',()=>{
 for(const t of ['light','strong','frontier']){const same=modelCatalog.filter(m=>m.tier===t);expect(new Set(same.map(m=>m.guide)).size).toBe(1);expect(new Set(same.map(m=>m.detail)).size).toBe(1);}
 expect(typicalCost(modelInfo('opus')!)).toBe(.55);expect(typicalCost(modelInfo('sonnet')!)).toBe(.28);expect(typicalCost(modelInfo('gpt-sol')!)).toBe(.28);expect(typicalCost(modelInfo('haiku')!)).toBe(.01);expect(typicalCost(modelInfo('gpt-astra')!)).toBe(1.38);
 expect(typicalCost(modelInfo('gemini-argon')!,new Date('2026-11-30T12:00:00Z'))).toBe(.28);expect(typicalCost(modelInfo('gemini-argon')!,new Date('2026-12-02T12:00:00Z'))).toBe(.55);
 expect(modelCatalog.every(m=>m.guide.length>20)).toBe(true);
});

it('reads the work from the score when the triage did not name it, and every kind of work has a tier at every difficulty',()=>{
 expect(workOf({kind:'edit',difficulty:1})).toBe('fix');expect(workOf({kind:'edit',difficulty:5})).toBe('restructure');
 expect(workOf({kind:'answer',difficulty:1})).toBe('talk');expect(workOf({kind:'answer',difficulty:3})).toBe('look');
 for(const work of works)for(let d=1;d<=5;d++){const band=bestFor[work].find(b=>d<=b.upTo);expect(band,`${work} ${d}`).toBeTruthy();expect(autoModels[band!.tier].length).toBeGreaterThan(0);}
});

it('lists every model once with its price, without DeepSeek V4 Pro, and bills other providers without cache writes',()=>{
 expect(new Set(modelCatalog.map(m=>m.id)).size).toBe(modelCatalog.length);
 expect(modelCatalog.some(m=>/deepseek-v4-pro/.test(m.id))).toBe(false);
 expect(modelCatalog.some(m=>/cheapest/i.test(m.detail))).toBe(false);
 expect(usageCost('deepseek-flash',{input_tokens:1_000_000,cache_read_input_tokens:1_000_000,output_tokens:1_000_000},undefined,new Date('2026-10-14T02:00:00Z'))).toBeCloseTo(.3+.006+1.2,9);
});
