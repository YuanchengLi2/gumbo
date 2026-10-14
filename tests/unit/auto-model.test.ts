import {it,expect} from 'vitest';
import {autoModel,tierFor,agentModels,modelCatalog,usageCost} from '@dream/config';

it('Auto turns a request\'s score into a tier: light for small changes, strong for editing, frontier for the hardest',()=>{
 expect(tierFor({kind:'edit',difficulty:1})).toBe('light');
 for(const d of [2,3,4])expect(tierFor({kind:'edit',difficulty:d})).toBe('strong');
 expect(tierFor({kind:'edit',difficulty:5})).toBe('frontier');
 expect(tierFor({kind:'answer',difficulty:2})).toBe('light');expect(tierFor({kind:'answer',difficulty:3})).toBe('strong');
 expect(tierFor({kind:'plan',difficulty:3})).toBe('strong');expect(tierFor({kind:'plan',difficulty:4})).toBe('frontier');
});

it('picks the cheapest model in the tier that can run, Claude on a price tie',()=>{
 // "make the caption white" went to DeepSeek Flash, described as the cheapest; Haiku and GPT Luna cost a third of it.
 expect(autoModel({kind:'edit',difficulty:1},{deepseek:true,openai:true,google:true})).toBe(agentModels.haiku);
 expect(autoModel({kind:'edit',difficulty:3},{openai:true,google:true})).toBe(agentModels.sonnet);
 expect(autoModel({kind:'edit',difficulty:5},{openai:true})).toBe(agentModels.opus);
 expect(autoModel({kind:'answer',difficulty:1},{})).toBe(agentModels.haiku);
 expect(autoModel({kind:'plan',difficulty:5},{})).toBe(agentModels.opus);
});

it('lists every model once with its price and tier, without DeepSeek V4 Pro, and bills other providers without cache writes',()=>{
 expect(new Set(modelCatalog.map(m=>m.id)).size).toBe(modelCatalog.length);
 expect(modelCatalog.some(m=>/deepseek-v4-pro/.test(m.id))).toBe(false);
 expect(modelCatalog.every(m=>['light','strong','frontier'].includes(m.tier))).toBe(true);
 // No model is described as the cheapest: Auto compares prices itself.
 expect(modelCatalog.some(m=>/cheapest/i.test(m.detail))).toBe(false);
 expect(usageCost('deepseek-flash',{input_tokens:1_000_000,cache_read_input_tokens:1_000_000,output_tokens:1_000_000})).toBeCloseTo(.3+.006+1.2,9);
});
