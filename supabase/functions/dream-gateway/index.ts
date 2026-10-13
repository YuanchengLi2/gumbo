import {InferenceRequests,requestStatus} from './inference-requests.ts';
const compressedJSON='application/x-dream-json-gzip';
import {activateAccess} from './access.ts';
import {countTokens} from './token-count.ts';
import {handleAI} from './ai.ts';
import {providerSecrets} from './providers.ts';
import {handleTranscription} from './transcribe.ts';
import {createClient} from 'npm:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:cors});
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const requests=new InferenceRequests(db);
const sha=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 const action=new URL(req.url).pathname.split('/').filter(Boolean).at(-1);
 if(action==='health')return json({service:'dream-gateway',configured:Boolean(Deno.env.get('ANTHROPIC_API_KEY'))});
 // Which other providers have a key here (never the keys themselves), so the app can offer their models and Auto can use them.
 if(action==='providers')return json(Object.fromEntries(Object.entries(providerSecrets).map(([id,secret])=>[id,Boolean(Deno.env.get(secret))])));
 if(action==='updates'){const {data}=await db.from('dream_releases').select('*').order('published_at',{ascending:false}).limit(10);return json({releases:data??[]});}
 if(action==='login-start'&&req.method==='POST'){const body=await req.json();const email=String(body.email??'').trim().toLowerCase();const {data}=await db.from('dream_invites').select('email').eq('email',email).maybeSingle();return data?json({allowed:true}):json({error:'Use the email address on your beta invitation.'},403);}
 if(action==='view'){const token=new URL(req.url).searchParams.get('token');if(!token)return json({error:'Missing share token'},400);const {data}=await db.from('dream_shares').select('title,object_key').eq('token_hash',await sha(token)).eq('status','ready').maybeSingle();if(!data)return json({error:'Video unavailable'},404);const {data:signed,error}=await db.storage.from('dream-exports').createSignedUrl(data.object_key,60);return error?json({error:'Video unavailable'},404):json({title:data.title,url:signed.signedUrl});}
 const bearer=req.headers.get('authorization')?.replace(/^Bearer /i,'');if(!bearer)return json({error:'Dream AI connection required'},401);
 const {data:auth,error:authError}=await db.auth.getUser(bearer);if(authError||!auth.user)return json({error:'Session expired'},401);
 const user=auth.user;const active=await activateAccess(db,user);if(!active)return json({error:'Dream AI is unavailable for this session'},403);
 if(action==='engine-policy')return json({version:1,profiles:['low','medium','high'],context:{router:12000,working:180000,haiku:90000},maxOutput:64000,recovery:true,maxWallMs:Math.min(350000,Number(Deno.env.get('DREAM_AI_MAX_WALL_MS'))||350000)});
 if(action==='account'){const {data}=await db.from('dream_accounts').select('email,status,daily_budget_usd,is_guest').eq('id',user.id).single();return json(data);}
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  if(action==='transcribe'){const result=await handleTranscription(req,user.id,{db,key:Deno.env.get('GROQ_API_KEY')});return json(result.body,result.status);}
  if(Number(req.headers.get('content-length')??0)>12_000_000)return json({error:'Request too large'},413);
  // The agent's requests carry its own code, which the firewall in front of this function can block as an attack (it
  // answers with an HTML page before the request arrives); the desktop sends them gzip-compressed, so nothing matches.
  const body=req.headers.get('content-type')===compressedJSON?JSON.parse(await new Response(req.body!.pipeThrough(new DecompressionStream('gzip'))).text()):await req.json();
  if(action==='ai-status'||action==='ai-cancel'){if(typeof body.requestId!=='string')return json({error:'Request ID required'},400);if(action==='ai-cancel')await requests.cancel(user.id,body.requestId);const result=requestStatus(await requests.read(user.id,body.requestId));return json(result.body,result.status);}
  if(action==='admin'||action==='admin-invite'){const {data:account}=await db.from('dream_accounts').select('is_admin').eq('id',user.id).single();if(!account?.is_admin)return json({error:'Administrator access is required.'},403);if(action==='admin-invite'){const email=String(body.email??'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:'Enter a valid email address.'},400);const {error}=await db.from('dream_invites').upsert({email});if(error)throw error;return json({invited:true});}const {data:accounts}=await db.from('dream_accounts').select('id,email,status,daily_budget_usd');const {data:usage}=await db.from('dream_usage').select('cost_usd').gte('created_at',new Date(new Date().setUTCHours(0,0,0,0)).toISOString());return json({accounts:accounts??[],requests:usage?.length??0,cost:(usage??[]).reduce((sum:number,u:any)=>sum+Number(u.cost_usd),0)});}
  if(action==='count-tokens'){const result=await countTokens(body,user.id,db,Deno.env.get('ANTHROPIC_API_KEY'));return json(result.body,result.status);}
  if(action==='ai'){const result=await handleAI(body,user.id,{db,key:Deno.env.get('ANTHROPIC_API_KEY'),providerKeys:Object.fromEntries(Object.entries(providerSecrets).map(([id,secret])=>[id,Deno.env.get(secret)])),requests,timeoutMs:Math.min(350000,Math.max(1000,Number(Deno.env.get('DREAM_AI_MAX_WALL_MS'))||350000))});if(result.finished)EdgeRuntime.waitUntil(result.finished);return result.stream?new Response(result.stream,{status:200,headers:{...cors,'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform'}}):json(result.body,result.status);}
  if(action==='share-create'){
   const id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID(),key=`${user.id}/${id}.mp4`;
   const {error}=await db.from('dream_shares').insert({id,user_id:user.id,token_hash:await sha(token),object_key:key,title:String(body.title??'Dream video').slice(0,200)});if(error)throw error;
   const {data:signed,error:uploadError}=await db.storage.from('dream-exports').createSignedUploadUrl(key);if(uploadError)throw uploadError;
   return json({id,token,objectKey:key,uploadUrl:signed.signedUrl});
  }
  if(action==='share-complete'){const {data:share}=await db.from('dream_shares').select('object_key').eq('id',body.id).eq('user_id',user.id).eq('status','uploading').single();if(!share)return json({error:'Share not found'},404);const {data:files}=await db.storage.from('dream-exports').list(user.id,{search:`${body.id}.mp4`});const file=files?.find((f:any)=>f.name===`${body.id}.mp4`);if(!file)return json({error:'Upload has not finished'},409);await db.from('dream_shares').update({status:'ready',size_bytes:file.metadata?.size??0}).eq('id',body.id).eq('user_id',user.id);return json({ready:true});}
  if(action==='share-revoke'){const {error}=await db.from('dream_shares').update({status:'revoked'}).eq('id',body.id).eq('user_id',user.id);if(error)throw error;return json({revoked:true});}
  return json({error:'Unknown command'},404);
 }catch(error){return json({error:error instanceof Error?error.message:'Request failed'},500);}
});
