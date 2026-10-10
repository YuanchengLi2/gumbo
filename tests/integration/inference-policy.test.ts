import {it,expect} from 'vitest';
import {inferencePolicy,cachedPrompt,usageCost} from '../../supabase/functions/dream-gateway/inference-policy';
it('uses adaptive thinking and validated effort profiles while preserving Haiku structured routing',()=>{
 expect(inferencePolicy('claude-sonnet-5-5')).toEqual({thinking:{type:'adaptive',display:'updates',block_binding:{prefix_mismatch_behavior:'drop_block'}},output_config:{effort:'low'}});
 expect(inferencePolicy('claude-opus-5-5').output_config?.effort).toBe('low');expect(inferencePolicy('claude-haiku-4-5-20251001')).toEqual({});
 expect(inferencePolicy('claude-opus-5-5','consultation').output_config?.effort).toBe('medium');expect(inferencePolicy('claude-sonnet-5-5','consultation').output_config?.effort).toBe('medium');expect(inferencePolicy('claude-opus-5-5','max').output_config?.effort).toBe('low');
 expect(inferencePolicy('claude-sonnet-5-5','routine',{effort:'high'}).output_config?.effort).toBe('high');
 const tools=[{name:'read'},{name:'create'}],prompt=cachedPrompt('Stable instructions',tools);expect(prompt.cache_control).toEqual({type:'ephemeral'});expect((prompt.tools as {cache_control?:unknown}[])[1].cache_control).toEqual({type:'ephemeral',ttl:'1h'});expect((prompt.system as {cache_control?:unknown}[])[0].cache_control).toEqual({type:'ephemeral',ttl:'1h'});expect(tools[1]).not.toHaveProperty('cache_control');
 expect(usageCost('claude-opus-5-5',{cache_read_input_tokens:1_000_000},[4,20])).toBe(.2);
});
