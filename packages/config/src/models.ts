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
 {choice:'opus',guide:"Frontier judgement for the hardest work: a first cut of long footage, restructuring a whole video, a plan for it, and hard creative calls a less expensive model already got wrong.",id:'claude-opus-5-5',provider:'anthropic',label:'Claude Opus 5.5',detail:'Frontier judgement, the hardest edits and plans',cost:'$$$$',tier:'frontier',vision:true,price:[4,20],cachedRead:.2},
 {choice:'sonnet',guide:"Capable editor for real edits with Gumbo's tools: choosing footage and b-roll, precise fixes, motion graphics and scenes written in code, captions, sound; also scripts and questions about the whole video.",id:'claude-sonnet-5-5',provider:'anthropic',label:'Claude Sonnet 5.5',detail:'Strong all-round editor',cost:'$$$',tier:'strong',vision:true,price:[2,10],cachedRead:.2},
 {choice:'haiku',guide:"Fast and inexpensive: one setting on one thing, small talk, quick answers and short questions about the video. Weaker judgement on anything creative.",id:'claude-haiku-5-5',provider:'anthropic',label:'Claude Haiku 5.5',detail:'Fast and inexpensive, small edits and questions',cost:'$',tier:'light',vision:true,price:[.1,.5],cachedRead:.01},
 {choice:'gpt-astra',guide:"Frontier judgement for the hardest work: a first cut of long footage, restructuring a whole video, a plan for it, and hard creative calls a less expensive model already got wrong.",id:'gpt-6-astra',provider:'openai',label:'GPT-6 Astra',detail:'Frontier judgement, the hardest edits and plans',cost:'$$$$$',tier:'frontier',vision:true,price:[10,50],cachedRead:1,longContext:{above:272_000,price:[20,75],cachedRead:2}},
 {choice:'gpt-sol',guide:"Capable editor for real edits with Gumbo's tools: choosing footage and b-roll, precise fixes, motion graphics and scenes written in code, captions, sound; also scripts and questions about the whole video.",id:'gpt-6.1-sol',provider:'openai',label:'GPT-6.1 Sol',detail:'Strong all-round editor',cost:'$$$',tier:'strong',vision:true,price:[2,10],cachedRead:.1,longContext:{above:272_000,price:[4,15],cachedRead:.2}},
 {choice:'gpt-luna',guide:"Fast and inexpensive: one setting on one thing, small talk, quick answers and short questions about the video. Weaker judgement on anything creative.",id:'gpt-6-luna',provider:'openai',label:'GPT-6 Luna',detail:'Fast and inexpensive, small edits and questions',cost:'$',tier:'light',vision:true,price:[.1,.5],cachedRead:.01,longContext:{above:272_000,price:[.2,.75],cachedRead:.02}},
 {choice:'gemini-argon',guide:"Capable editor for real edits with Gumbo's tools: choosing footage and b-roll, precise fixes, motion graphics and scenes written in code, captions, sound; also scripts and questions about the whole video.",id:'gemini-4-argon',provider:'google',label:'Gemini 4 Argon',detail:'Strong all-round editor',cost:'$$$',tier:'strong',vision:true,price:[2,10],cachedRead:.1,change:{from:'2026-12-01T00:00:00Z',price:[4,20],cachedRead:.2}},
 {choice:'gemini-flash',guide:"Fast and inexpensive: one setting on one thing, small talk, quick answers and short questions about the video. Weaker judgement on anything creative.",id:'gemini-3.8-flash',provider:'google',label:'Gemini 3.8 Flash',detail:'Fast and inexpensive, small edits and questions',cost:'$$',tier:'light',vision:true,price:[.75,3.75],cachedRead:.075,change:{from:'2027-01-01T00:00:00Z',price:[1.5,7.5],cachedRead:.15}},
 {choice:'deepseek-flash',guide:"Fast and inexpensive: one setting on one thing, small talk, quick answers and short questions about the video. Weaker judgement on anything creative.",id:'deepseek-flash',provider:'deepseek',label:'DeepSeek V4.1 Flash',detail:'Fast and inexpensive, small edits and questions',cost:'$',tier:'light',vision:true,price:[.3,1.2],cachedRead:.006,offPeak:.5}
];
export const providerLabels:Record<Provider,string>={anthropic:'Claude',openai:'OpenAI',google:'Google',deepseek:'DeepSeek'};
export const modelInfo=(idOrChoice:string)=>modelCatalog.find(m=>m.id===idOrChoice||m.choice===idOrChoice);
/** What a typical editing request costs on a model, in dollars: scaled from measured runs on the vlog (about $0.55 on Opus
 * for ten to thirteen steps), by the model's list price. What Auto's router weighs against how hard the request is. */
export const typicalCost=(m:ModelInfo,at=new Date())=>{const price=m.change&&at>=new Date(m.change.from)?m.change.price:m.price;return Math.max(.01,Math.round(.55*(price[0]+price[1])/24*100)/100);};
/** Model ids by composer choice (Auto excluded: it resolves per request). */
export const agentModels=Object.fromEntries(modelCatalog.map(m=>[m.choice,m.id])) as Record<Exclude<ModelChoice,'auto'>,string>;

type Choice=Exclude<ModelChoice,'auto'>;
export const tiers:Tier[]=['light','strong','frontier'];
export const isTier=(value:unknown):value is Tier=>tiers.includes(value as Tier);
/** Roux 1 (Auto)'s models. Its agent runs on DeepSeek V4.1 Flash, chosen on October 18 for value: GPT-6.1 Sol edits cost
 * 20 to 115 credits, and DeepSeek's input is about a seventh of Sol's price, its cached input a sixteenth, and its cache
 * lasts hours (a stop and continue does not pay for the whole conversation again). When DeepSeek cannot run (no key on the
 * gateway), GPT-6.1 Sol, then Claude Sonnet 5.5, stands in. Claude Haiku 5.5 does the small work in the background
 * (describing shots, writing footage overviews, condensing a long conversation). Every other model runs only when the
 * user picks it, and the user's pick always wins. */
export const autoModels:{agent:Choice[];light:Choice[]}={agent:['deepseek-flash','gpt-sol','sonnet'],light:['haiku']};
const runs=(m:ModelInfo,providers?:Partial<Record<Provider,boolean>>)=>m.provider==='anthropic'||!!providers?.[m.provider];
/** The model Auto's agent runs on: the first of its models whose provider has a key on the gateway. */
export function autoModel(providers?:Partial<Record<Provider,boolean>>):string{return autoModels.agent.map(choice=>modelInfo(choice)!).find(m=>runs(m,providers))?.id??agentModels.sonnet;}
/** Auto's stand-in when its model stops responding: Claude Haiku 5.5 for the agent's model, and the agent's model for
 * Haiku, so Roux 1's two models stand in for each other. None for a model Auto does not run. */
export function autoFallback(model:string,providers?:Partial<Record<Provider,boolean>>):string|undefined{
 const own=(choices:Choice[])=>choices.some(choice=>modelInfo(choice)?.id===model);
 const other=own(autoModels.agent)?autoModels.light:own(autoModels.light)?autoModels.agent:undefined;
 return other?.map(choice=>modelInfo(choice)!).find(m=>m.id!==model&&runs(m,providers))?.id;
}
