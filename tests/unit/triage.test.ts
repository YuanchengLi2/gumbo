import {it,expect} from 'vitest';
import {triageMessage,parseTriage,ruleTriage,withMode,routeRecord,type TriageInput} from '../../packages/orchestrator/src/triage';
import {intelligence,outputAllowance} from '../../packages/orchestrator/src/intelligence';
import {inferencePolicy} from '../../supabase/functions/dream-gateway/inference-policy';

const project={clips:20,overlays:6,audio:3,minutes:9.9,footageFiles:2};
const input=(message:string,extra:Partial<TriageInput>={}):TriageInput=>({message,mode:'auto',recent:[],project,attachments:0,...extra});

it('sends Haiku the message with the recent conversation, a stopped request and the project size',()=>{
 const sent=JSON.parse(triageMessage(input('its still there',{recent:[{role:'user',text:'theres a weird green tint at 13 seconds'},{role:'assistant',text:'I removed the glow.'.repeat(100)}],stopped:'put the actual thing on screen with the definition'})));
 expect(sent.message).toBe('its still there');expect(sent.recentConversation[0].text).toContain('green tint');
 expect(sent.recentConversation[1].text.length).toBe(600);expect(sent.stopped).toContain('definition');expect(sent.project).toEqual(project);
});

it('reads Haiku\'s triage, clamped and trimmed, and refuses anything else',()=>{
 expect(parseTriage('```json\n{"kind":"edit","difficulty":1,"vision":false,"carriesStopped":false,"parts":["make the caption white"],"reason":"one setting"}\n```')).toMatchObject({kind:'edit',difficulty:1,parts:['make the caption white']});
 expect(parseTriage('{"kind":"edit","difficulty":9,"vision":true,"carriesStopped":false,"parts":[],"reason":"x"}')?.difficulty).toBe(5);
 expect(parseTriage('{"kind":"delete everything","difficulty":2}')).toBeUndefined();
 expect(parseTriage('Sure! Here is my answer')).toBeUndefined();
});

it('falls back to word rules that score real requests from the logs sensibly',()=>{
 // Each of these was labelled "difficult — open-ended" by the old rules.
 expect(ruleTriage(input('make the caption white'))).toMatchObject({kind:'edit',difficulty:1});
 expect(ruleTriage(input('in places where im talking about plans create a motion graphic in stick figure style'))).toMatchObject({kind:'edit',difficulty:4});
 expect(ruleTriage(input('condense it into a 10 minute vlog with the best things, add cuts, transitions and captions',{project:{...project,clips:0,minutes:0}}))).toMatchObject({kind:'edit',difficulty:5});
 expect(ruleTriage(input('what is this app, why is the pricing so expensive'))).toMatchObject({kind:'answer',difficulty:1});
 expect(ruleTriage(input('continue'),true).kind).toBe('continue');
});

it('lets the composer mode win, and carries a stopped request only while one exists',()=>{
 const t={kind:'edit' as const,difficulty:3,vision:true,carriesStopped:true,parts:['a'],reason:'r',source:'model' as const};
 expect(withMode(t,'plan',false).kind).toBe('plan');expect(withMode(t,'ask',false).kind).toBe('answer');
 expect(withMode({...t,kind:'continue'},'auto',false).kind).toBe('edit');
 expect(withMode(t,'auto',false).carriesStopped).toBe(false);expect(withMode(t,'auto',true).carriesStopped).toBe(true);
 expect(routeRecord({...t,kind:'answer',difficulty:1})).toMatchObject({route:'question',complexity:'simple',difficulty:1});
});

it('runs triage as a small router call with its own reply schema, and sets the agent\'s effort from the score',()=>{
 const profile=intelligence('claude-haiku-5-5','triage');expect(profile).toMatchObject({role:'router',effort:'low'});expect(outputAllowance(profile)).toBe(2048);
 expect((inferencePolicy('claude-haiku-5-5','triage').output_config as any).format.schema.required).toEqual(['kind','difficulty','vision','carriesStopped','parts','reason']);
 expect(intelligence('claude-sonnet-5-5','execution',{difficulty:1}).effort).toBe('low');
 expect(intelligence('claude-sonnet-5-5','execution',{difficulty:3}).effort).toBe('medium');
 expect(intelligence('claude-opus-5-5','execution',{difficulty:5}).effort).toBe('high');
 expect(intelligence('claude-haiku-5-5','execution',{difficulty:1}).effort).toBe('medium');
 // Without a score, as before: Sonnet at medium, Haiku at xhigh; the user's pick wins.
 expect(intelligence('claude-sonnet-5-5','execution').effort).toBe('medium');expect(intelligence('claude-haiku-5-5','execution').effort).toBe('xhigh');
 expect(intelligence('claude-sonnet-5-5','execution',{difficulty:5},0,'low').effort).toBe('low');
});
