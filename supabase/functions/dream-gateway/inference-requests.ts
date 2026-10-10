export type RequestRecord={status:'running'|'completed'|'failed'|'uncertain'|'cancelled';body_hash:string;response?:any;error?:string;lease_until:string;expires_at:string};
export interface RequestStore {
 claim(body:any,user:string,wallMs:number):Promise<{owner:boolean;record:RequestRecord}>;
 read(user:string,id:string):Promise<RequestRecord|null>;
 finish(user:string,id:string,status:RequestRecord['status'],response?:any,error?:string):Promise<void>;
 cancel(user:string,id:string):Promise<void>;
}
const canonical=(value:any):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export class InferenceRequests implements RequestStore {
 constructor(private db:any){}
 async claim(body:any,user:string,wallMs:number){
  const {stream:_,...identity}=body;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(identity)));
  const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const {data,error}=await this.db.rpc('dream_claim_inference',{p_user:user,p_request:body.requestId,p_hash:hash,p_wall_ms:wallMs});
  if(error)throw new Error('Could not save the AI request. Please retry.');
  if(data.record.body_hash!==hash)throw new Error('This request ID belongs to different instructions.');
  return data as {owner:boolean;record:RequestRecord};
 }
 async read(user:string,id:string){
  const {data,error}=await this.db.from('dream_inference_results').select('*').eq('user_id',user).eq('request_id',id).maybeSingle();
  if(error)throw new Error('Could not check the saved AI response.');
  if(!data||Date.parse(data.expires_at)<=Date.now())return null;
  if(data.status==='running'&&Date.parse(data.lease_until)<=Date.now()){await this.finish(user,id,'uncertain',undefined,'The AI worker stopped before confirming its response.');data.status='uncertain';}
  return data as RequestRecord;
 }
 async finish(user:string,id:string,status:RequestRecord['status'],response?:any,error?:string){
  const result=await this.db.from('dream_inference_results').update({status,response:response??null,error:error??null}).eq('user_id',user).eq('request_id',id).eq('status','running');
  if(result.error)throw new Error('Could not save the completed AI response.');
 }
 async cancel(user:string,id:string){await this.finish(user,id,'cancelled',undefined,'Stopped by you.');}
}
export function requestStatus(record:RequestRecord|null){
 if(!record)return{status:404,body:{dream_request:{status:'missing',retryable:false}}};
 if(record.status==='completed')return{status:200,body:record.response};
 if(record.status==='failed'&&record.response)return{status:409,body:record.response};
 return{status:record.status==='running'?202:409,body:{error:{type:record.status,message:record.error??'The request has not completed.'},dream_request:{status:record.status,retryable:false}}};
}
