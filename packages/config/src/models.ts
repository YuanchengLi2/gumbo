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
/** detail is shown under the model's name in the menu; guide is what Auto's router (Haiku) reads to choose it: what it is
 * best at in this editor, and where it falls short. */
export type ModelInfo={choice:Exclude<ModelChoice,'auto'>;id:string;provider:Provider;label:string;detail:string;guide:string;cost:string;tier:Tier;vision:boolean;price:[number,number];cachedRead:number;
 /** Billing beyond the list price, as the gateway bills it (its providers.ts): a price change announced for a date, a rate for
  * prompts above a size, the share charged outside the provider's peak hours. */
 change?:{from:string;price:[number,number];cachedRead:number};longContext?:{above:number;price:[number,number];cachedRead:number};offPeak?:number};
export const modelCatalog:ModelInfo[]=[
 {choice:'opus',guide:"Strongest judgement, at about twice Sonnet's cost: worth it for whole-video work (a first cut of long footage, restructuring a video, a plan for it) and for hard creative calls a cheaper model already got wrong.",id:'claude-opus-5-5',provider:'anthropic',label:'Claude Opus 5.5',detail:'Best judgement, for the hardest edits and plans',cost:'$$$$',tier:'frontier',vision:true,price:[4,20],cachedRead:.2},
 {choice:'sonnet',guide:"Does nearly every edit well with Figjam's tools: choosing footage and b-roll, precise fixes, motion graphics and scenes written in code, captions, sound. The usual choice for real editing.",id:'claude-sonnet-5-5',provider:'anthropic',label:'Claude Sonnet 5.5',detail:'Strong all-round editor, motion graphics',cost:'$$$',tier:'strong',vision:true,price:[2,10],cachedRead:.2},
 {choice:'haiku',guide:'Fast and inexpensive: one setting on one thing, small talk, quick answers. Weaker judgement on anything creative.',id:'claude-haiku-5-5',provider:'anthropic',label:'Claude Haiku 5.5',detail:'Fast and inexpensive, small precise edits',cost:'$',tier:'light',vision:true,price:[.1,.5],cachedRead:.01},
 {choice:'gpt-astra',guide:"Frontier reasoning for the hardest problems, at five times Sonnet's price; rarely worth it for editing.",id:'gpt-6-astra',provider:'openai',label:'GPT-6 Astra',detail:'Frontier reasoning, very expensive',cost:'$$$$$',tier:'frontier',vision:true,price:[10,50],cachedRead:1,longContext:{above:272_000,price:[20,75],cachedRead:2}},
 {choice:'gpt-sol',guide:'Capable all-rounder that follows instructions carefully: scripts and written answers, straightforward edits.',id:'gpt-6.1-sol',provider:'openai',label:'GPT-6.1 Sol',detail:'Capable all-rounder',cost:'$$$',tier:'strong',vision:true,price:[2,10],cachedRead:.1,longContext:{above:272_000,price:[4,15],cachedRead:.2}},
 {choice:'gpt-luna',guide:'Fast and inexpensive: small talk, short answers, simple questions.',id:'gpt-6-luna',provider:'openai',label:'GPT-6 Luna',detail:'Fast and inexpensive, small edits and questions',cost:'$',tier:'light',vision:true,price:[.1,.5],cachedRead:.01,longContext:{above:272_000,price:[.2,.75],cachedRead:.02}},
 {choice:'gemini-argon',guide:'Strong reasoning over long footage and many clips: understanding and choosing from a lot of material, questions about the whole video.',id:'gemini-4-argon',provider:'google',label:'Gemini 4 Argon',detail:'Strong reasoning, long footage',cost:'$$$',tier:'strong',vision:true,price:[2,10],cachedRead:.1,change:{from:'2026-12-01T00:00:00Z',price:[4,20],cachedRead:.2}},
 {choice:'gemini-flash',guide:'Fast, and reads footage well: quick questions about what is in the video or the edit.',id:'gemini-3.8-flash',provider:'google',label:'Gemini 3.8 Flash',detail:'Fast, reads footage and answers questions',cost:'$$',tier:'light',vision:true,price:[.75,3.75],cachedRead:.075,change:{from:'2027-01-01T00:00:00Z',price:[1.5,7.5],cachedRead:.15}},
 {choice:'deepseek-flash',guide:'Inexpensive text work: drafts, rewrites, brainstorming. Slow and error-prone at multi-step editing with tools (12 minutes over a caption colour).',id:'deepseek-flash',provider:'deepseek',label:'DeepSeek V4.1 Flash',detail:'Inexpensive, small edits',cost:'$',tier:'light',vision:true,price:[.3,1.2],cachedRead:.006,offPeak:.5}
];
export const providerLabels:Record<Provider,string>={anthropic:'Claude',openai:'OpenAI',google:'Google',deepseek:'DeepSeek'};
export const modelInfo=(idOrChoice:string)=>modelCatalog.find(m=>m.id===idOrChoice||m.choice===idOrChoice);
/** What a typical editing request costs on a model, in dollars: scaled from measured runs on the vlog (about $0.55 on Opus
 * for ten to thirteen steps), by the model's list price. What Auto's router weighs against how hard the request is. */
export const typicalCost=(m:ModelInfo)=>Math.max(.01,Math.round(.55*(m.price[0]+m.price[1])/24*100)/100);
/** Model ids by composer choice (Auto excluded: it resolves per request). */
export const agentModels=Object.fromEntries(modelCatalog.map(m=>[m.choice,m.id])) as Record<Exclude<ModelChoice,'auto'>,string>;

/** What a request is and how hard, as scored for Auto (see the orchestrator's triage): edit changes the project, answer
 * only replies, plan returns a plan first. Difficulty runs from 1 (one setting on one thing, small talk) to 5 (a first cut
 * of long footage, a whole-video restructure). */
export type RequestScore={kind:'edit'|'answer'|'plan';difficulty:number;vision?:boolean;work?:Work;model?:string};
/** The kind of work a request is, which decides which model is best at it: talk (small talk, thanks, questions about the
 * app), look (a question that needs a look at the video), write (a script, ideas, an outline), fix (precise changes to
 * what exists), footage (choosing, cutting and pacing shots, b-roll), graphics (motion graphics, titles, animation,
 * drawings), sound (music, effects, the mix) and restructure (a first cut, condensing long footage, the whole video). */
export type Work='talk'|'look'|'write'|'fix'|'footage'|'graphics'|'sound'|'restructure';
export const works:Work[]=['talk','look','write','fix','footage','graphics','sound','restructure'];
type Choice=Exclude<ModelChoice,'auto'>;
/** The fallback when the router's own pick cannot run: for each kind of work and difficulty, the least expensive model that
 * does it well, first that can run (and see, when the work needs eyes). From the requests of October 12-14, 2026: Haiku is
 * enough for one setting on one thing and small talk; Sonnet does nearly every real edit well; Opus, at twice Sonnet's cost,
 * only for whole-video work. Other providers stand in, in order, when Claude cannot run. */
export const bestFor:Record<Work,{upTo:number;models:Choice[]}[]>={
 talk:[{upTo:5,models:['haiku','gpt-luna','gemini-flash','deepseek-flash']}],
 look:[{upTo:1,models:['haiku','gemini-flash','gpt-luna']},{upTo:5,models:['sonnet','gemini-argon','gpt-sol']}],
 write:[{upTo:4,models:['sonnet','gpt-sol','gemini-argon']},{upTo:5,models:['opus','sonnet','gpt-sol']}],
 fix:[{upTo:1,models:['haiku','sonnet','gpt-luna']},{upTo:4,models:['sonnet','gpt-sol','gemini-argon']},{upTo:5,models:['opus','sonnet','gpt-sol']}],
 footage:[{upTo:4,models:['sonnet','gemini-argon','gpt-sol']},{upTo:5,models:['opus','sonnet','gemini-argon']}],
 graphics:[{upTo:4,models:['sonnet','gpt-sol','gemini-argon']},{upTo:5,models:['opus','sonnet','gpt-sol']}],
 sound:[{upTo:4,models:['sonnet','gpt-sol','gemini-argon']},{upTo:5,models:['opus','sonnet','gpt-sol']}],
 restructure:[{upTo:3,models:['sonnet','gemini-argon','gpt-sol']},{upTo:5,models:['opus','sonnet','gpt-sol']}],
};
/** The work a score stands for when the triage did not name it (the word rules, an older gateway). */
export function workOf(score:RequestScore):Work{
 if(score.work)return score.work;const d=Math.round(score.difficulty)||3;
 if(score.kind==='answer')return d<=2?'talk':'look';if(score.kind==='plan')return d>=4?'restructure':'write';return d>=5?'restructure':'fix';
}
/** Auto: the model Haiku chose for the request from every model that can run, weighing how hard it is against what each
 * costs (model), or else the fallback for its kind of work at its difficulty (bestFor). A plan of the whole edit is Opus
 * from difficulty 4. A model the user picks always wins over Auto. */
export function autoModel(score:RequestScore,providers?:Partial<Record<Provider,boolean>>):string{
 const d=Math.min(5,Math.max(1,Math.round(score.difficulty)||3)),can=(m:ModelInfo)=>(m.provider==='anthropic'||!!providers?.[m.provider])&&(!score.vision||m.vision);
 const ranked:Choice[]=score.kind==='plan'?(d>=4?['opus','sonnet','gpt-astra']:['sonnet','opus','gpt-sol']):(bestFor[workOf(score)].find(b=>d<=b.upTo)??bestFor[workOf(score)].at(-1)!).models;
 const chosen=score.model?modelInfo(score.model):undefined,picked=chosen&&can(chosen)?chosen:ranked.map(choice=>modelCatalog.find(x=>x.choice===choice)).find((m):m is ModelInfo=>!!m&&can(m));
 return picked?.id??agentModels.sonnet;
}
