/** Every model a request can run on, as the composer lists it, and Auto's choice among them.
 * Claude models always run; GPT, Gemini and DeepSeek run once their key is on the gateway (OPENAI_API_KEY, GEMINI_API_KEY,
 * DEEPSEEK_API_KEY). Prices per million tokens (input, output, cache read) from the official pages on October 13, 2026. */
export type Provider='anthropic'|'openai'|'google'|'deepseek';
export type ModelChoice='auto'|'sonnet'|'haiku'|'opus'|'gpt-astra'|'gpt-sol'|'gpt-luna'|'gemini-flash'|'deepseek-pro'|'deepseek-flash';
export type ModelInfo={choice:Exclude<ModelChoice,'auto'>;id:string;provider:Provider;label:string;detail:string;price:[number,number];cachedRead:number};
export const modelCatalog:ModelInfo[]=[
 {choice:'opus',id:'claude-opus-5-5',provider:'anthropic',label:'Claude Opus 5.5',detail:'Most capable Claude, for demanding creative work.',price:[4,20],cachedRead:.2},
 {choice:'sonnet',id:'claude-sonnet-5-5',provider:'anthropic',label:'Claude Sonnet 5.5',detail:'First cuts, long edits, motion graphics and everything in between.',price:[2,10],cachedRead:.2},
 {choice:'haiku',id:'claude-haiku-5-5',provider:'anthropic',label:'Claude Haiku 5.5',detail:'Cheapest and fastest Claude, for small, precise changes.',price:[.1,.5],cachedRead:.01},
 {choice:'gpt-astra',id:'gpt-6-astra',provider:'openai',label:'GPT-6 Astra',detail:'OpenAI\'s flagship. The most expensive model here.',price:[10,50],cachedRead:1},
 {choice:'gpt-sol',id:'gpt-6.1-sol',provider:'openai',label:'GPT-6.1 Sol',detail:'OpenAI\'s everyday model, priced like Sonnet.',price:[2,10],cachedRead:.1},
 {choice:'gpt-luna',id:'gpt-6-luna',provider:'openai',label:'GPT-6 Luna',detail:'OpenAI\'s small, fast model.',price:[.1,.5],cachedRead:.01},
 {choice:'gemini-flash',id:'gemini-3.8-flash',provider:'google',label:'Gemini 3.8 Flash',detail:'Fast and inexpensive, good at reading and answering.',price:[.75,3.75],cachedRead:.075},
 {choice:'deepseek-pro',id:'deepseek-v4-pro',provider:'deepseek',label:'DeepSeek V4 Pro',detail:'Strong and inexpensive. Cannot see images.',price:[1.32,3.96],cachedRead:.044},
 {choice:'deepseek-flash',id:'deepseek-flash',provider:'deepseek',label:'DeepSeek V4.1 Flash',detail:'The cheapest model here.',price:[.3,1.2],cachedRead:.006}
];
export const providerLabels:Record<Provider,string>={anthropic:'Claude',openai:'OpenAI',google:'Google',deepseek:'DeepSeek'};
export const modelInfo=(idOrChoice:string)=>modelCatalog.find(m=>m.id===idOrChoice||m.choice===idOrChoice);
/** Model ids by composer choice (Auto excluded: it resolves per request). */
export const agentModels=Object.fromEntries(modelCatalog.map(m=>[m.choice,m.id])) as Record<Exclude<ModelChoice,'auto'>,string>;

// Work that needs Sonnet however it is phrased: new visuals, sound, captions, or anything across the whole video.
const bigWork=/\b(?:motion|graphics?|animat\w*|scenes?|intro|outro|title cards?|chapters?|lower thirds?|overlays?|3d|music|score|soundtrack|sound effects?|voice-?over|captions?|subtitles?|first cut|re-?edit|from scratch|whole|entire|every|throughout|restructure|story)\b/i;
/** A plain follow-up edit: an instruction to change the video, not a question, plan or script. */
export const plainEdit=(text:string)=>text.length<400&&/^(?:(?:ok(?:ay)?|now|also|and|please|then)[,]?\s+)*(?:add|make|put|cut|trim|remove|delete|drop|swap|replace|change|move|speed|slow|open|start|end|use|shorten|lengthen|mute|unmute|fade|grade|colou?r|crop|zoom|split|reorder|insert|turn|give|set|apply|lower|raise|increase|decrease|keep|caption|title|tighten|brighten|darken|warm|cool|boost|reduce|fix|extend|stretch|shrink|rotate|flip)\b/i.test(text.trim())&&!/\?|\b(?:plan|script|ideas?|concepts?|outline|storyboard)\b/i.test(text);

/** Auto: the best model for this request among those that can run. Claude does the editing (the tools and prompts are
 * built around it): Haiku for a small, precise change to an edit that exists, Opus to plan difficult work (a plan is a few
 * calls, and the approved plan then runs on the model Auto picks for doing it), Sonnet for everything else. A question that changes nothing goes to Gemini Flash when its
 * key is set: it reads footage and answers well for a third of Sonnet's price. A model the user picks always wins over Auto. */
export function autoModel(input:{route?:{route?:string;complexity?:string};text:string;hasEdit:boolean;planning?:boolean;providers?:Partial<Record<Provider,boolean>>}):string{
 const r=input.route,can=(p:Provider)=>p==='anthropic'||!!input.providers?.[p];
 if(r?.route==='question'&&can('google'))return agentModels['gemini-flash'];
 if(input.planning&&r?.complexity==='difficult')return agentModels.opus;
 if(r?.route==='local'&&input.hasEdit&&!bigWork.test(input.text)&&(r.complexity==='simple'||plainEdit(input.text)))return agentModels.haiku;
 return agentModels.sonnet;
}
