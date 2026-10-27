import {readMessageStream,type StreamEvent} from '../../../../supabase/functions/_shared/stream';
/** One call to the gateway's /ai. Requests are sent gzipped (page text can look like an attack to the firewall in front
 * of the function, as the agent's code once did), streamed as Anthropic events, and timed: the gateway's Server-Timing
 * says where its part of the wait went. */
export type GatewayCall={model:string;system?:unknown;messages:unknown[];max_tokens:number;purpose:string;stream?:boolean;tools?:unknown[];tool_choice?:unknown;requestId?:string;turnId?:string;
 /** DeepSeek's thinking for this call ('off': none; the gateway's own default otherwise). */dream_thinking?:'off'};
export type Timing={auth?:number;reserve?:number;provider?:number;headers?:number;total?:number};
export class GatewayError extends Error{
 constructor(message:string,public status:number,public type:string,public retryable=false,public retryAfterMs?:number){super(message);}
}
export type CallOptions={signal?:AbortSignal;onEvent?:(event:StreamEvent)=>void;fetch?:typeof fetch};

export async function callGateway(base:string,token:string,call:GatewayCall,options:CallOptions={}):Promise<{message:any;timing:Timing}>{
 const started=performance.now(),stream=call.stream??true;
 const body=await gzip(JSON.stringify({...call,requestId:call.requestId??crypto.randomUUID(),stream}));
 const response=await (options.fetch??fetch)(`${base}/ai`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/x-dream-json-gzip'},body,signal:options.signal});
 const timing:Timing={...parseServerTiming(response.headers.get('server-timing')),headers:performance.now()-started};
 if(!response.ok)throw await failure(response);
 if(!stream){const message=await response.json();timing.total=performance.now()-started;return{message,timing};}
 const message=await readMessageStream(response,options.onEvent);timing.total=performance.now()-started;
 return{message,timing};
}
/** GET one of the gateway's account routes (usage, account, billing). */
export async function gatewayGet(base:string,token:string,route:string,fetcher:typeof fetch=fetch){
 const response=await fetcher(`${base}/${route}`,{headers:{Authorization:`Bearer ${token}`}});
 if(!response.ok)throw await failure(response);return response.json();
}
/** POST to one of the gateway's account routes (memory sync), the body gzipped as /ai's is. */
export async function gatewayPost(base:string,token:string,route:string,body:unknown,fetcher:typeof fetch=fetch){
 const response=await fetcher(`${base}/${route}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/x-dream-json-gzip'},body:await gzip(JSON.stringify(body))});
 if(!response.ok)throw await failure(response);return response.json();
}
async function failure(response:Response){
 const body=await response.json().catch(()=>({})) as any,error=body?.error;
 const message=typeof error==='string'?error:error?.message??`The gateway answered ${response.status}.`;
 const type=typeof error==='object'&&error?.type?error.type:body?.code??(response.status===401?'session_expired':'gateway_error');
 return new GatewayError(message,response.status,type,!!body?.dream_request?.retryable||[502,503,504,529].includes(response.status),body?.dream_request?.retryAfterMs);
}
export function parseServerTiming(header:string|null):Timing{
 const timing:Record<string,number>={};
 for(const part of header?.split(',')??[]){const [name,...params]=part.trim().split(';');const dur=params.map(p=>p.trim()).find(p=>p.startsWith('dur='));if(name&&dur)timing[name]=Number(dur.slice(4));}
 return timing;
}
async function gzip(text:string){return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());}
/** The text a streamed message has produced so far, from its events: what Tab and Ctrl+K show while it streams. */
export function textOf(message:any){return(message?.content??[]).filter((b:any)=>b?.type==='text').map((b:any)=>b.text??'').join('');}
