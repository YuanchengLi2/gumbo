/** Every model a request can run on, as the composer lists it, and Auto's choice among them.
 * Claude models always run; GPT, Gemini and DeepSeek run once their key is on the gateway (OPENAI_API_KEY, GEMINI_API_KEY,
 * DEEPSEEK_API_KEY). Prices per million tokens (input, output, cache read) from the official pages on October 13, 2026. */
export type Provider='anthropic'|'openai'|'google'|'deepseek';
export type ModelChoice='auto'|'sonnet'|'haiku'|'opus'|'gpt-astra'|'gpt-sol'|'gpt-luna'|'gemini-argon'|'gemini-flash'|'deepseek-flash';
/** How much work a model is trusted with when Auto picks: light for small precise changes and quick answers, strong for
 * real editing, frontier for the hardest work and planning it. */
export type Tier='light'|'strong'|'frontier';
/** detail: what the model is good at, in a few words (the menu shows it under the name); cost: its price tier, $ to $$$$$,
 * from its output price. */
export type ModelInfo={choice:Exclude<ModelChoice,'auto'>;id:string;provider:Provider;label:string;detail:string;cost:string;tier:Tier;vision:boolean;price:[number,number];cachedRead:number};
export const modelCatalog:ModelInfo[]=[
 {choice:'opus',id:'claude-opus-5-5',provider:'anthropic',label:'Claude Opus 5.5',detail:'Best judgement, for the hardest edits and plans',cost:'$$$$',tier:'frontier',vision:true,price:[4,20],cachedRead:.2},
 {choice:'sonnet',id:'claude-sonnet-5-5',provider:'anthropic',label:'Claude Sonnet 5.5',detail:'Strong all-round editor, motion graphics',cost:'$$$',tier:'strong',vision:true,price:[2,10],cachedRead:.2},
 {choice:'haiku',id:'claude-haiku-5-5',provider:'anthropic',label:'Claude Haiku 5.5',detail:'Fast and inexpensive, small precise edits',cost:'$',tier:'light',vision:true,price:[.1,.5],cachedRead:.01},
 {choice:'gpt-astra',id:'gpt-6-astra',provider:'openai',label:'GPT-6 Astra',detail:'Frontier reasoning, very expensive',cost:'$$$$$',tier:'frontier',vision:true,price:[10,50],cachedRead:1},
 {choice:'gpt-sol',id:'gpt-6.1-sol',provider:'openai',label:'GPT-6.1 Sol',detail:'Capable all-rounder',cost:'$$$',tier:'strong',vision:true,price:[2,10],cachedRead:.1},
 {choice:'gpt-luna',id:'gpt-6-luna',provider:'openai',label:'GPT-6 Luna',detail:'Fast and inexpensive, small edits and questions',cost:'$',tier:'light',vision:true,price:[.1,.5],cachedRead:.01},
 {choice:'gemini-argon',id:'gemini-4-argon',provider:'google',label:'Gemini 4 Argon',detail:'Strong reasoning, long footage',cost:'$$$',tier:'strong',vision:true,price:[2,10],cachedRead:.1},
 {choice:'gemini-flash',id:'gemini-3.8-flash',provider:'google',label:'Gemini 3.8 Flash',detail:'Fast, reads footage and answers questions',cost:'$$',tier:'light',vision:true,price:[.75,3.75],cachedRead:.075},
 {choice:'deepseek-flash',id:'deepseek-flash',provider:'deepseek',label:'DeepSeek V4.1 Flash',detail:'Inexpensive, small edits',cost:'$',tier:'light',vision:true,price:[.3,1.2],cachedRead:.006}
];
export const providerLabels:Record<Provider,string>={anthropic:'Claude',openai:'OpenAI',google:'Google',deepseek:'DeepSeek'};
export const modelInfo=(idOrChoice:string)=>modelCatalog.find(m=>m.id===idOrChoice||m.choice===idOrChoice);
/** Model ids by composer choice (Auto excluded: it resolves per request). */
export const agentModels=Object.fromEntries(modelCatalog.map(m=>[m.choice,m.id])) as Record<Exclude<ModelChoice,'auto'>,string>;

/** What a request is and how hard, as scored for Auto (see the orchestrator's triage): edit changes the project, answer
 * only replies, plan returns a plan first. Difficulty runs from 1 (one setting on one thing, small talk) to 5 (a first cut
 * of long footage, a whole-video restructure). */
export type RequestScore={kind:'edit'|'answer'|'plan';difficulty:number;vision?:boolean;work?:Work;escalation?:number};
/** The kind of work a request is, which decides which model is best at it: talk (small talk, thanks, questions about the
 * app), look (a question that needs a look at the video), write (a script, ideas, an outline), fix (precise changes to
 * what exists), footage (choosing, cutting and pacing shots, b-roll), graphics (motion graphics, titles, animation,
 * drawings), sound (music, effects, the mix) and restructure (a first cut, condensing long footage, the whole video). */
export type Work='talk'|'look'|'write'|'fix'|'footage'|'graphics'|'sound'|'restructure';
export const works:Work[]=['talk','look','write','fix','footage','graphics','sound','restructure'];
type Choice=Exclude<ModelChoice,'auto'>;
/** The best models for each kind of work, by difficulty: the first that can run (and see, when the work needs eyes) does
 * it. Not chosen by price. From the editor's own requests of October 12-14, 2026: Sonnet made most edits work at the first
 * try and writes the scenes; Opus chose footage and b-roll best and keeps a whole video in mind; Haiku is enough for one
 * setting on one thing and for small talk; DeepSeek took 12 minutes over a caption colour and GPT Luna reported captions it
 * had not placed. Other providers stand in, in order, when Claude cannot run. */
export const bestFor:Record<Work,{upTo:number;models:Choice[]}[]>={
 talk:[{upTo:5,models:['haiku','gpt-luna','gemini-flash','deepseek-flash']}],
 look:[{upTo:1,models:['haiku','gemini-flash','gpt-luna']},{upTo:5,models:['sonnet','gemini-argon','gpt-sol']}],
 write:[{upTo:2,models:['sonnet','gpt-sol','gemini-argon']},{upTo:5,models:['opus','sonnet','gpt-astra']}],
 fix:[{upTo:1,models:['haiku','sonnet','gpt-luna']},{upTo:4,models:['sonnet','gpt-sol','gemini-argon']},{upTo:5,models:['opus','sonnet','gpt-astra']}],
 footage:[{upTo:2,models:['sonnet','gemini-argon','gpt-sol']},{upTo:5,models:['opus','sonnet','gemini-argon']}],
 graphics:[{upTo:4,models:['sonnet','gpt-sol','gemini-argon']},{upTo:5,models:['opus','sonnet','gpt-astra']}],
 sound:[{upTo:3,models:['sonnet','gpt-sol','gemini-argon']},{upTo:5,models:['opus','sonnet','gpt-sol']}],
 restructure:[{upTo:5,models:['opus','sonnet','gpt-astra']}],
};
/** The work a score stands for when the triage did not name it (the word rules, an older gateway). */
export function workOf(score:RequestScore):Work{
 if(score.work)return score.work;const d=Math.round(score.difficulty)||3;
 if(score.kind==='answer')return d<=2?'talk':'look';if(score.kind==='plan')return d>=4?'restructure':'write';return d>=5?'restructure':'fix';
}
/** Auto: the best model for the request's kind of work at its difficulty, among the providers that can run. A plan is
 * thinking about the whole edit: Opus from 4, Sonnet below. After the user rejected the last result of the same kind of
 * work (escalation), it climbs the ladder Haiku, Sonnet, Opus that many steps. A model the user picks always wins. */
export function autoModel(score:RequestScore,providers?:Partial<Record<Provider,boolean>>):string{
 const d=Math.min(5,Math.max(1,Math.round(score.difficulty)||3)),can=(m:ModelInfo)=>(m.provider==='anthropic'||!!providers?.[m.provider])&&(!score.vision||m.vision);
 const ranked:Choice[]=score.kind==='plan'?(d>=4?['opus','sonnet','gpt-astra']:['sonnet','opus','gpt-sol']):(bestFor[workOf(score)].find(b=>d<=b.upTo)??bestFor[workOf(score)].at(-1)!).models;
 const picked=ranked.map(choice=>modelCatalog.find(x=>x.choice===choice)).find((m):m is ModelInfo=>!!m&&can(m));
 const ladder:Tier[]=['light','strong','frontier'],step=Math.min(2,Math.max(0,Math.round(score.escalation??0)));
 if(picked&&step){const tier=ladder[Math.min(2,ladder.indexOf(picked.tier)+step)];if(tier!==picked.tier)return agentModels[tier==='strong'?'sonnet':tier==='frontier'?'opus':'haiku'];}
 return picked?.id??agentModels.sonnet;
}
