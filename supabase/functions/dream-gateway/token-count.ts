import {validProfile,inferencePolicy,cachedPrompt,providerHeaders} from './inference-policy.ts';
const models=new Set(['claude-haiku-5-5','claude-haiku-4-5-20251001','claude-sonnet-5-5','claude-opus-5-5']);
export async function countTokens(body:any,userId:string,db:any,key:string|undefined,fetcher=fetch){
 if(!key)return{status:503,body:{error:'AI service is not configured'}};
 if(!models.has(body.model)||!Array.isArray(body.messages)||!validProfile(body.profile)||new TextEncoder().encode(JSON.stringify(body)).length>12_000_000)return{status:400,body:{error:'Invalid token-count request'}};
 const {data,error}=await db.rpc('dream_allow_token_count',{p_user:userId});if(error||!data)return{status:429,body:{error:'Token-count rate limit reached; retry shortly'}};
 const policy=inferencePolicy(body.model,body.purpose,body.profile);
 const response=await fetcher('https://api.anthropic.com/v1/messages/count_tokens',{method:'POST',headers:providerHeaders(key),body:JSON.stringify({model:body.model,...cachedPrompt(body.system,body.tools,body.cacheTtl),messages:body.messages,tool_choice:body.tool_choice,thinking:policy.thinking,output_config:policy.output_config}),signal:AbortSignal.timeout(30000)});
 return{status:response.status,body:await response.json()};
}
