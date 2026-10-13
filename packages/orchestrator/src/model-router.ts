import {modelCatalog,autoModel,type Provider,type ModelInfo} from '@dream/config';

/** Auto's choice for a request, made by Haiku: one short call with the request, the mode, the size of the project and the
 * models that can run, each with what it is good at and what it costs. The cheapest model that will do the job well wins.
 * Without an answer (no network, a malformed reply) the keyword rules in autoModel decide instead. */
export const modelRouterPrompt=`You choose which AI model will carry out one request in Figjam, a video editor where the model edits by writing code and editing a project file with tools, looks at footage frames, and writes motion graphics, music and sound as code.

Pick the cheapest model that will do this request well. Guidance:
- Small, precise changes to an existing edit (trim, move, mute, retitle, recolour one thing): a small, fast model.
- First cuts, re-edits, long footage, many steps, motion graphics, music and sound, or anything needing taste and judgement: a strong editing model (Claude Sonnet is the reference).
- Planning difficult, open-ended work, or work where quality matters most: the most capable model.
- Questions and explanations that change nothing: a fast, inexpensive model that reads well.
- A model that cannot see images must not get work that depends on looking at footage.

Reply with JSON only: {"model": one of the ids given, "reason": a short phrase}.`;

export type RouterInput={request:string;mode:'edit'|'plan'|'question';approvedPlan?:boolean;project:{clips:number;elements:number;audio:number;minutes:number;footage:number};providers:Partial<Record<Provider,boolean>>};
export const routerCandidates=(providers:RouterInput['providers'])=>modelCatalog.filter(m=>m.provider==='anthropic'||providers[m.provider]);
export const routerMessage=(input:RouterInput)=>JSON.stringify({request:input.request.slice(0,4000),mode:input.approvedPlan?'carry out an approved plan':input.mode,project:input.project,
 models:routerCandidates(input.providers).map(m=>({id:m.choice,name:m.label,strengths:m.detail,vision:m.vision,pricePerMillionTokens:{input:m.price[0],output:m.price[1]}}))});
/** The model id the router chose, or undefined when its reply names no runnable model. */
export function parseRouterReply(text:string,providers:RouterInput['providers']):{model:ModelInfo;reason:string}|undefined{
 try{const json=JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g,'')),model=routerCandidates(providers).find(m=>m.choice===json.model||m.id===json.model);return model?{model,reason:String(json.reason??'').slice(0,200)}:undefined;}catch{return undefined;}
}
export const fallbackModel=(input:RouterInput&{route?:{route?:string;complexity?:string}})=>autoModel({route:input.route,text:input.request,hasEdit:input.project.clips>0,planning:input.mode==='plan'&&!input.approvedPlan,providers:input.providers});
