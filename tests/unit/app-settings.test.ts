import {it,expect,afterEach} from 'vitest';
import {AppSettingsSchema} from '@dream/contracts';
import {creatorProfile} from '../../packages/orchestrator/src/context';
import {usageSummary} from '../../supabase/functions/dream-gateway/usage-summary';

const saved=process.env.DREAM_CREATOR_PROFILE;afterEach(()=>{if(saved===undefined)delete process.env.DREAM_CREATOR_PROFILE;else process.env.DREAM_CREATOR_PROFILE=saved;});

it('fills settings with defaults and refuses providers it does not know, including Claude',()=>{
 expect(AppSettingsSchema.parse({})).toEqual({profile:{name:'',makes:'',style:''},disabledProviders:[]});
 expect(AppSettingsSchema.parse({disabledProviders:['deepseek']}).disabledProviders).toEqual(['deepseek']);
 expect(()=>AppSettingsSchema.parse({disabledProviders:['anthropic']})).toThrow();
});

it('gives the agent the creator\'s profile with every request, only the parts filled in',()=>{
 process.env.DREAM_CREATOR_PROFILE=JSON.stringify({name:' Yuan ',makes:'travel vlogs and anime shorts',style:''});
 expect(creatorProfile()).toEqual({creatorProfile:{name:'Yuan',makes:'travel vlogs and anime shorts'}});
 process.env.DREAM_CREATOR_PROFILE=JSON.stringify({name:'',makes:'',style:''});expect(creatorProfile()).toEqual({});
 process.env.DREAM_CREATOR_PROFILE='not json';expect(creatorProfile()).toEqual({});
});

it('sums spend today, over 30 days and by model, counting a reserved request at its reservation',()=>{
 const today=new Date('2026-10-16T00:00:00Z');
 const rows=[{model:'gpt-6.1-sol',cost_usd:'0.25',reserved_usd:'0.4',status:'completed',created_at:'2026-10-16T03:00:00Z'},{model:'gpt-6.1-sol',cost_usd:0,reserved_usd:0.3,status:'reserved',created_at:'2026-10-16T04:00:00Z'},
  {model:'claude-haiku-5-5',cost_usd:0.01,reserved_usd:0.05,status:'completed',created_at:'2026-10-15T20:00:00Z'}];
 expect(usageSummary(rows,today,10)).toEqual({todayUsd:.55,monthUsd:.56,dailyBudgetUsd:10,requests:3,byModel:[{model:'gpt-6.1-sol',calls:2,costUsd:.55},{model:'claude-haiku-5-5',calls:1,costUsd:.01}]});
});
