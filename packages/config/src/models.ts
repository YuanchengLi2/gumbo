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
export type RequestScore={kind:'edit'|'answer'|'plan';difficulty:number;vision?:boolean};
/** The tier a scored request needs: an edit of 1 is light, 2–4 strong, 5 frontier; a plan of 4–5 is frontier work; an
 * answer of 1–2 is light, harder answers strong. */
export function tierFor(score:RequestScore):Tier{
 const d=Math.min(5,Math.max(1,Math.round(score.difficulty)||3));
 if(score.kind==='answer')return d<=2?'light':'strong';
 if(score.kind==='plan')return d>=4?'frontier':'strong';
 return d<=1?'light':d>=5?'frontier':'strong';
}
const listPrice=(m:ModelInfo)=>m.price[0]+m.price[1];
/** Auto: the cheapest model in the scored tier among the providers that can run (a price tie goes to the first listed, so
 * Claude, whose tools and prompts the editor is built around); work that needs to look at footage skips models that
 * cannot see. A model the user picks always wins over Auto. */
export function autoModel(score:RequestScore,providers?:Partial<Record<Provider,boolean>>):string{
 const can=(p:Provider)=>p==='anthropic'||!!providers?.[p],tier=tierFor(score);
 const pool=modelCatalog.filter(m=>m.tier===tier&&can(m.provider)&&(!score.vision||m.vision));
 return pool.reduce<ModelInfo|undefined>((best,m)=>!best||listPrice(m)<listPrice(best)?m:best,undefined)?.id??agentModels.sonnet;
}
