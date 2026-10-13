import {it,expect} from 'vitest';
import {routerMessage,parseRouterReply,fallbackModel,routerCandidates} from '../../packages/orchestrator/src/model-router';
import {intelligence,outputAllowance} from '../../packages/orchestrator/src/intelligence';

const project={clips:12,elements:4,audio:2,minutes:9.9,footage:30};
it('offers Haiku only the models that can run, with what each is good at, can see and costs',()=>{
 expect(routerCandidates({}).map(m=>m.provider)).toEqual(['anthropic','anthropic','anthropic']);
 const message=JSON.parse(routerMessage({request:'add a whoosh on each cut',mode:'edit',project,providers:{deepseek:true}}));
 expect(message.models.map((m:any)=>m.id)).toEqual(['opus','sonnet','haiku','deepseek-pro','deepseek-flash']);
 expect(message.models.find((m:any)=>m.id==='deepseek-pro')).toMatchObject({vision:false,pricePerMillionTokens:{input:1.32,output:3.96}});
 expect(message.project).toEqual(project);
});
it('takes Haiku\'s pick only when it names a model that can run, and falls back to the rules otherwise',()=>{
 expect(parseRouterReply('{"model":"deepseek-flash","reason":"simple edit"}',{deepseek:true})?.model.id).toBe('deepseek-flash');
 expect(parseRouterReply('```json\n{"model":"sonnet","reason":"first cut"}\n```',{})?.model.id).toBe('claude-sonnet-5-5');
 expect(parseRouterReply('{"model":"gpt-sol","reason":"x"}',{})).toBeUndefined();
 expect(parseRouterReply('not json',{})).toBeUndefined();
 expect(fallbackModel({request:'trim the second clip',mode:'edit',project,providers:{},route:{route:'local',complexity:'simple'}})).toBe('claude-haiku-5-5');
});
it('runs the router as a small, low-effort call',()=>{
 const profile=intelligence('claude-haiku-5-5','model_routing');expect(profile).toMatchObject({role:'router',effort:'low'});expect(outputAllowance(profile)).toBe(2048);
});
