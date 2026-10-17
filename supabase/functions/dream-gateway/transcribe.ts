// The provider credential and usage accounting stay in the authenticated gateway.
export function wavDuration(bytes:Uint8Array):number{
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=(at:number,n:number)=>new TextDecoder().decode(bytes.subarray(at,at+n));
 if(bytes.length<44||text(0,4)!=='RIFF'||text(8,4)!=='WAVE')throw new Error('Upload PCM WAV audio.');
 let rate=0,size=0;
 for(let at=12;at+8<=bytes.length;){const length=view.getUint32(at+4,true);if(at+8+length>bytes.length)throw new Error('Incomplete WAV audio.');
  if(text(at,4)==='fmt '){if(length<16||view.getUint16(at+8,true)!==1||view.getUint16(at+10,true)!==1||view.getUint32(at+12,true)!==16000||view.getUint16(at+22,true)!==16)throw new Error('Audio must be 16 kHz mono PCM16.');rate=32000;}
  if(text(at,4)==='data')size+=length;at+=8+length+(length%2);
 }
 const duration=size/rate;if(!Number.isFinite(duration)||duration<=0||duration>94)throw new Error('Audio chunks must be between 0 and 94 seconds.');return duration;
}
export async function handleTranscription(req:Request,userId:string,{db,key,fetcher=fetch}:{db:any;key?:string;fetcher?:typeof fetch}){
 const fail=(error:string,status:number)=>({status,body:{error}});
 if(!key)return fail('Cloud transcription is not configured.',503);
 if(Number(req.headers.get('content-length')??0)>3_100_000)return fail('Audio chunk too large.',413);
 const bytes=new Uint8Array(await req.arrayBuffer());if(bytes.length>3_100_000)return fail('Audio chunk too large.',413);
 let duration:number;try{duration=wavDuration(bytes);}catch(error){return fail((error as Error).message,400);}
 // Optional: the language spoken (ISO 639-1, e.g. vi), or task=translate for English text of speech in any language. The
 // translation model gives segments without word times.
 const query=new URL(req.url).searchParams,language=/^[a-z]{2,3}$/.test(query.get('language')??'')?query.get('language')!:undefined,translate=query.get('task')==='translate';
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
 const cacheKey=(translate?'groq-translate-v1:':language?`groq-turbo-words-v1:${language}:`:'groq-turbo-words-v1:')+hash,cost=Math.max(10,duration)*(translate?.111:.04)/3600;
 const {data:reservation,error}=await db.rpc('dream_reserve_speech',{p_user:userId,p_hash:cacheKey,p_seconds:duration,p_cost:cost});
 if(error)return fail(error.code==='D0004'?'You have used all your credits.':error.code==='D0003'?'Daily AI allowance reached.':'Could not reserve transcription.',error.code==='D0004'?402:error.code==='D0003'?429:503);
 if(reservation.result)return{status:200,body:{...reservation.result,cached:true}};
 if(reservation.busy)return{status:409,body:{error:'This audio is already being transcribed.',retryAfterMs:2000}};
 const usageId=reservation.usage_id;
 const finish=async(status:string,result:unknown,providerStatus?:number)=>{
  const {error}=await db.rpc('dream_finish_speech',{p_user:userId,p_hash:cacheKey,p_usage:usageId,p_status:status,p_result:result,p_provider_status:providerStatus??null});
  if(error)throw new Error('Could not save the transcription receipt.');
 };
 const form=new FormData();form.set('file',new Blob([bytes],{type:'audio/wav'}),'speech.wav');form.set('model',translate?'whisper-large-v3':'whisper-large-v3-turbo');form.set('response_format','verbose_json');if(!translate){form.append('timestamp_granularities[]','word');form.append('timestamp_granularities[]','segment');}if(language&&!translate)form.set('language',language);form.set('temperature','0');
 let response:Response;
 try{response=await fetcher('https://api.groq.com/openai/v1/audio/'+(translate?'translations':'transcriptions'),{method:'POST',headers:{Authorization:`Bearer ${key}`},body:form,signal:AbortSignal.timeout(90_000)});}
 catch{await finish('uncertain',null);return fail('Transcription connection ended. Retry to continue from saved chunks.',503);}
 if(!response.ok){await finish('failed',null,response.status);return{status:response.status===429?429:502,body:{error:response.status===429?'Transcription capacity reached. Please retry shortly.':'The speech provider could not transcribe this chunk.',retryAfterMs:response.status===429?Math.min(30000,Math.max(1000,Number(response.headers.get('retry-after')??5)*1000)):undefined}};}
 let result:any;try{result=await response.json();if(translate)result.words??=[];if(!Array.isArray(result.words)||result.words.some((w:any)=>typeof w.word!=='string'||!Number.isFinite(w.start)||!Number.isFinite(w.end)))throw new Error();}catch{await finish('uncertain',null,response.status);return fail('The speech provider returned an invalid transcript.',502);}
 const output={words:result.words,segments:(result.segments??[]).map((s:any)=>({start:s.start,end:s.end,avg_logprob:s.avg_logprob,no_speech_prob:s.no_speech_prob,...(typeof s.text==='string'?{text:s.text.trim()}:{})})),language:translate?'english':result.language??language,durationSec:duration,...(translate?{translated:true}:{})};
 await finish('completed',output,response.status);return{status:200,body:{...output,cached:false}};
}
