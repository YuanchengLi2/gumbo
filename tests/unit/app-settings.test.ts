import {it,expect,afterEach} from 'vitest';
import {AppSettingsSchema} from '@dream/contracts';
import {creatorProfile} from '../../apps/project-service/src/workspace';
import {usageSummary} from '../../supabase/functions/dream-gateway/usage-summary';

const saved=process.env.DREAM_CREATOR_PROFILE;afterEach(()=>{if(saved===undefined)delete process.env.DREAM_CREATOR_PROFILE;else process.env.DREAM_CREATOR_PROFILE=saved;});

it('fills settings with defaults and refuses providers it does not know, including Claude',()=>{
 expect(AppSettingsSchema.parse({})).toEqual({profile:{name:'',makes:'',style:''},disabledProviders:[]});
 expect(AppSettingsSchema.parse({disabledProviders:['deepseek']}).disabledProviders).toEqual(['deepseek']);
 expect(()=>AppSettingsSchema.parse({disabledProviders:['anthropic']})).toThrow();
});

it('gives the agent the creator\'s profile with every request, only the parts filled in',()=>{
 process.env.DREAM_CREATOR_PROFILE=JSON.stringify({name:' Yuan ',makes:'travel vlogs and anime shorts',style:''});
 expect(creatorProfile()).toEqual({name:'Yuan',makes:'travel vlogs and anime shorts'});
 process.env.DREAM_CREATOR_PROFILE=JSON.stringify({name:'',makes:'',style:''});expect(creatorProfile()).toBeUndefined();
 process.env.DREAM_CREATOR_PROFILE='not json';expect(creatorProfile()).toBeUndefined();
});

it('sums credits today, over 30 days, by day and by model, counting nothing for a request still running',()=>{
 const now=new Date('2026-10-16T09:00:00Z');
 const rows=[{model:'gpt-6.1-sol',cost_usd:'0.25',reserved_usd:'0.4',status:'completed',created_at:'2026-10-16T03:00:00Z'},{model:'gpt-6.1-sol',cost_usd:0,reserved_usd:0.3,status:'reserved',created_at:'2026-10-16T04:00:00Z'},
  {model:'claude-haiku-5-5',cost_usd:0.01,reserved_usd:0.05,status:'completed',created_at:'2026-10-15T20:00:00Z'}];
 const summary=usageSummary(rows,now);
 expect({...summary,days:undefined}).toEqual({todayCredits:25,monthCredits:26,requests:3,days:undefined,byModel:[{model:'gpt-6.1-sol',calls:2,credits:25},{model:'claude-haiku-5-5',calls:1,credits:1}]});
 expect(summary.days).toHaveLength(30);expect(summary.days.at(-1)).toEqual({date:'2026-10-16',credits:25});expect(summary.days.at(-2)).toEqual({date:'2026-10-15',credits:1});
});
