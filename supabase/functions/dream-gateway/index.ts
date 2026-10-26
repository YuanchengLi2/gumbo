import {InferenceRequests,requestStatus} from './inference-requests.ts';
const compressedJSON='application/x-dream-json-gzip';
import {activateAccess} from './access.ts';
import {AuthCache,serverTiming} from './auth-cache.ts';
import {memoryKey} from './memory-key.ts';
import {handleMemorySync,readSyncProfile,supabaseMemorySyncPorts} from './memory-sync.ts';
import {countTokens} from './token-count.ts';
import {handleAI} from './ai.ts';
import {providerSecrets} from './providers.ts';
import {handleTranscription} from './transcribe.ts';
import {handleMediaSearch,mediaKeys} from './media-search.ts';
import {handleFetchUrl} from './fetch-url.ts';
import {sceneRenderPass} from './scene-render.ts';
import {handleCreators} from './creators.ts';
import {usageSummary} from './usage-summary.ts';
import {tokenActivity} from './activity.ts';
import {handleReport,supabaseReportPorts} from './reports.ts';
import {handleEditLog,supabaseEditLogPorts} from './edit-logs.ts';
import {handleWaitlistJoin,supabaseWaitlistPorts,waitlistAlert,WAITLISTED} from './waitlist.ts';
import {shareStory} from './share.ts';
import {handleFeedback,supabaseFeedbackPorts,feedbackAlert} from './feedback.ts';
import {handleSpendDashboard,supabaseSpendPorts} from './spend-dashboard.ts';
import {readProfile,saveProfile,supabaseProfilePorts} from './profiles.ts';
import {billingSummary,startCheckout,openPortal,handleStripeEvent,verifyStripeSignature,stripeConfig,supabaseBillingPorts,PLANS,PAYMENTS_CLOSED} from './billing.ts';
import {createClient} from 'npm:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Expose-Headers':'server-timing','Timing-Allow-Origin':'*'};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:cors});
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const requests=new InferenceRequests(db),sessions=new AuthCache();
const sha=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 const action=new URL(req.url).pathname.split('/').filter(Boolean).at(-1);
 if(action==='health')return json({service:'dream-gateway',configured:Boolean(Deno.env.get('ANTHROPIC_API_KEY')),promptCacheKey:'user-and-prompt',deepseekRoute:Deno.env.get('DEEPSEEK_ROUTE')==='messages'?'messages':'chat'});
 // Which other providers have a key here (never the keys themselves), so the app can offer their models and Auto can use them.
 if(action==='providers')return json(Object.fromEntries(Object.entries(providerSecrets).map(([id,secret])=>[id,Boolean(Deno.env.get(secret))])));
 if(action==='updates'){const {data}=await db.from('dream_releases').select('*').order('published_at',{ascending:false}).limit(10);return json({releases:data??[]});}
 // The spending dashboard (usegumbo.app/dashboard/) has its own password, not an account; see spend-dashboard.ts.
 if(action==='spend-dashboard'&&req.method==='POST'){let body:unknown={};try{body=await req.json();}catch{}const address=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||req.headers.get('cf-connecting-ip')||'unknown';const result=await handleSpendDashboard(body,address,supabaseSpendPorts(db,Deno.env.get('DREAM_DASHBOARD_PASSWORD'),name=>Deno.env.get(name)));return Response.json(result.body,{status:result.status,headers:{...cors,'Cache-Control':'no-store'}});}
 // Stripe's webhook (see billing.ts): signed by Stripe, not an account. A failure answers 500 so Stripe sends it again.
 if(action==='stripe-webhook'&&req.method==='POST'){const config=stripeConfig(name=>Deno.env.get(name)),payload=await req.text();
  if(!config?.webhookSecret)return json({error:'Billing is not set up'},503);
  if(!await verifyStripeSignature(payload,req.headers.get('stripe-signature'),config.webhookSecret))return json({error:'Invalid signature'},400);
  try{const event=JSON.parse(payload),note=await handleStripeEvent(event,supabaseBillingPorts(db),config);console.log(`Stripe ${event.type} ${event.id}: ${note}`);return json({received:true});}
  catch(error){console.error('Stripe webhook failed',error);return json({error:(error as Error).message},500);}}
 // The waitlist on usegumbo.app (waitlist.ts): no account needed.
 if(action==='waitlist-join'&&req.method==='POST'){let body:unknown={};try{body=await req.json();}catch{}const address=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||req.headers.get('cf-connecting-ip')||'unknown';const result=await handleWaitlistJoin(body,address,{...supabaseWaitlistPorts(db),alert:waitlistAlert(name=>Deno.env.get(name))});return json(result.body,result.status);}
 // Feedback from under the prompt box (feedback.ts): no account needed; a signed-in sender is known by their account.
 if(action==='feedback'&&req.method==='POST'){let body:unknown={};try{body=await req.json();}catch{}const address=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||req.headers.get('cf-connecting-ip')||'unknown';
  const bearer=req.headers.get('authorization')?.replace(/^Bearer /i,''),{data:signed}=bearer?await db.auth.getUser(bearer):{data:null};
  const result=await handleFeedback(body,address,signed?.user?.id??null,{...supabaseFeedbackPorts(db),alert:feedbackAlert(name=>Deno.env.get(name))});return json(result.body,result.status);}
 if(action==='login-start'&&req.method==='POST'){const body=await req.json();const email=String(body.email??'').trim().toLowerCase();const {data}=await db.from('dream_invites').select('email').eq('email',email).maybeSingle();return data?json({allowed:true}):json({error:'Use the email address on your beta invitation.'},403);}
 if(action==='view'){const token=new URL(req.url).searchParams.get('token');if(!token)return json({error:'Missing share token'},400);const {data}=await db.from('dream_shares').select('id,title,object_key,prompts,source,duration_sec,views').eq('token_hash',await sha(token)).eq('status','ready').maybeSingle();if(!data)return json({error:'Video unavailable'},404);
  // The address lasts an hour, long enough to watch; the page asks again when it is opened again. Each opening counts as a view.
  const {data:signed,error}=await db.storage.from('dream-exports').createSignedUrl(data.object_key,3600);if(error)return json({error:'Video unavailable'},404);await db.from('dream_shares').update({views:(data.views??0)+1}).eq('id',data.id);
  return json({title:data.title,url:signed.signedUrl,prompts:data.prompts??[],source:data.source??null,durationSec:data.duration_sec===null?null:Number(data.duration_sec)});}
 const bearer=req.headers.get('authorization')?.replace(/^Bearer /i,'');if(!bearer)return json({error:'Dream AI connection required'},401);
 const authStarted=performance.now();
 // A session let in during the last minute is let in again without asking the database (auth-cache.ts).
 let session=await sessions.get(bearer);
 if(!session){
  const {data:auth,error:authError}=await db.auth.getUser(bearer);if(authError||!auth.user)return json({error:'Session expired'},401);
  const active=await activateAccess(db,auth.user);if(!active)return json({error:'Dream AI is unavailable for this session'},403);
  session={user:auth.user};
 }
 const user=session.user;
 // The paid beta: what costs money (the AI, transcription, media search, sharing, checkout) or reads the web for the
 // agent is for accounts invited from the waitlist. Anyone can sign in and see where they stand.
 if(['ai','count-tokens','transcribe','media-search','fetch-url','creators','billing-checkout','share-create'].includes(action)&&!session.beta){const {data:access}=await db.from('dream_accounts').select('beta_access').eq('id',user.id).single();if(!access?.beta_access)return json({error:WAITLISTED,code:'waitlist'},403);session.beta=true;}
 await sessions.set(bearer,session);const authMs=performance.now()-authStarted;
 if(action==='engine-policy')return json({version:1,profiles:['low','medium','high'],context:{router:12000,working:180000,haiku:90000},maxOutput:64000,recovery:true,maxWallMs:Math.min(350000,Number(Deno.env.get('DREAM_AI_MAX_WALL_MS'))||350000)});
 if(action==='account'){const {data}=await db.from('dream_accounts').select('email,status,plan,is_guest,beta_access,is_admin').eq('id',user.id).single();return json(data);}
 // The key that seals the extension's memory on the user's computer (memory-key.ts); no memory comes here.
 if(action==='memory-key'){const secret=Deno.env.get('DREAM_MEMORY_SECRET');if(!secret)return json({error:'Memory keys are not set up on the gateway.',code:'not_configured'},503);return Response.json({key:await memoryKey(secret,user.id)},{headers:{...cors,'Cache-Control':'no-store'}});}
 // Memory sync's key profile (memory-sync.ts): the salt and check value of the user's own key, never the key.
 if(action==='memory-sync'&&req.method==='GET'){try{const result=await readSyncProfile(user.id,supabaseMemorySyncPorts(db));return json(result.body,result.status);}catch(error){return json({error:(error as Error).message},500);}}
 // Quick render: a pass for the cloud scene renderer, for the plans that have it (scene-render.ts).
 if(action==='scene-render-pass'){const {data}=await db.from('dream_accounts').select('plan,is_admin').eq('id',user.id).single();const result=await sceneRenderPass(user,data,name=>Deno.env.get(name));return json(result.body,result.status);}
 // Settings > Usage and billing: the credits requests took today, over the last 30 days, by day and by model.
 if(action==='usage'){const since=new Date(Date.now()-30*86_400_000);
  const {data:rows}=await db.from('dream_usage').select('model,cost_usd,reserved_usd,status,created_at').eq('user_id',user.id).gte('created_at',since.toISOString()).limit(50000);
  return json(usageSummary(rows??[],new Date()));}
 // Settings > Profile: tokens over the last year, by day, with the longest task and the streaks (activity.ts).
 if(action==='activity'){const since=new Date(Date.now()-371*86_400_000);
  const {data:rows,error}=await db.from('dream_usage').select('turn_id,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,created_at').eq('user_id',user.id).gte('created_at',since.toISOString()).order('created_at').limit(100000);
  if(error)return json({error:error.message},500);return json(tokenActivity(rows??[],new Date()));}
 // The plan, the credits left and what is on offer (billing.ts).
 if(action==='billing'){try{return json({...await billingSummary(user.id,supabaseBillingPorts(db),stripeConfig(name=>Deno.env.get(name))),paymentsOpen:Deno.env.get('DREAM_PAYMENTS_OPEN')==='1'});}catch(error){return json({error:(error as Error).message},500);}}
 // The onboarding's answers (profiles.ts): read back by the app on another computer, saved below when they are given.
 if(action==='profile'&&req.method==='GET'){try{return json(await readProfile(user.id,supabaseProfilePorts(db)));}catch(error){return json({error:(error as Error).message},500);}}
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  if(action==='transcribe'){const result=await handleTranscription(req,user.id,{db,key:Deno.env.get('GROQ_API_KEY')});return json(result.body,result.status);}
  if(Number(req.headers.get('content-length')??0)>12_000_000)return json({error:'Request too large'},413);
  // The agent's requests carry its own code, which the firewall in front of this function can block as an attack (it
  // answers with an HTML page before the request arrives); the desktop sends them gzip-compressed, so nothing matches.
  const body=req.headers.get('content-type')===compressedJSON?JSON.parse(await new Response(req.body!.pipeThrough(new DecompressionStream('gzip'))).text()):await req.json();
  if(action==='ai-status'||action==='ai-cancel'){if(typeof body.requestId!=='string')return json({error:'Request ID required'},400);if(action==='ai-cancel')await requests.cancel(user.id,body.requestId);const result=requestStatus(await requests.read(user.id,body.requestId));return json(result.body,result.status);}
  if(action==='admin'||action==='admin-invite'){const {data:account}=await db.from('dream_accounts').select('is_admin').eq('id',user.id).single();if(!account?.is_admin)return json({error:'Administrator access is required.'},403);if(action==='admin-invite'){const email=String(body.email??'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:'Enter a valid email address.'},400);const {error}=await db.from('dream_invites').upsert({email});if(error)throw error;return json({invited:true});}const {data:accounts}=await db.from('dream_accounts').select('id,email,status,daily_budget_usd');const {data:usage}=await db.from('dream_usage').select('cost_usd').gte('created_at',new Date(new Date().setUTCHours(0,0,0,0)).toISOString());return json({accounts:accounts??[],requests:usage?.length??0,cost:(usage??[]).reduce((sum:number,u:any)=>sum+Number(u.cost_usd),0)});}
  // YouTube creators for the @ menu and the agent's study_creator tool (see creators.ts).
  if(action==='creators'){const allow=async()=>{const {data:account}=await db.from('dream_accounts').select('plan').eq('id',user.id).single();const limit=(PLANS as any)[account?.plan??'free']?.limits?.creatorSearches??0;const {data:used,error}=await db.rpc('dream_use_allowance',{p_account:user.id,p_kind:'creator_search',p_limit:limit});return{ok:!error&&Number(used)>=0,limit};};
   const result=await handleCreators(body,{key:Deno.env.get('YOUTUBE_API_KEY'),allow});return json(result.body,result.status);}
  // Free-to-use music, sound, footage and images for the agent (see media-search.ts).
  // Web pages for the agent's fetch_url in the browser, which cannot read other sites itself (fetch-url.ts).
  if(action==='fetch-url'){const result=await handleFetchUrl(body,{fetch,resolve:async host=>[...await Deno.resolveDns(host,'A').catch(()=>[]),...await Deno.resolveDns(host,'AAAA').catch(()=>[])]});return json(result.body,result.status);}
  if(action==='media-search'){const result=await handleMediaSearch(body,{keys:Object.fromEntries(Object.entries(mediaKeys).map(([id,secret])=>[id,Deno.env.get(secret)]))});return json(result.body,result.status);}
  // Paying, on Stripe's pages: Checkout for a plan or credits, the portal to manage the plan (billing.ts).
  // Paying is closed during the free beta (no plans, no credit top-ups) until DREAM_PAYMENTS_OPEN=1; the portal stays so
  // anyone already subscribed can still cancel.
  if(action==='billing-checkout'&&Deno.env.get('DREAM_PAYMENTS_OPEN')!=='1')return json({error:PAYMENTS_CLOSED,code:'payments_closed'},503);
  if(action==='billing-checkout'||action==='billing-portal'){const config=stripeConfig(name=>Deno.env.get(name));if(!config)return json({error:'Paying is not set up on the gateway yet.'},503);
   try{return json(action==='billing-portal'?await openPortal(user.id,supabaseBillingPorts(db),config,fetch,body.flow==='cancel'?{cancel:true}:undefined):await startCheckout(user.id,{plan:body.plan,packs:body.packs},supabaseBillingPorts(db),config));}catch(error){return json({error:(error as Error).message},400);}}
  // Send log: one edit's log a user chose to send (reports.ts).
  if(action==='report'){const result=await handleReport(body,user.id,supabaseReportPorts(db));return json(result.body,result.status);}
  // Every request's log, sent by the app on its own when a run of it ends (edit-logs.ts).
  if(action==='edit-log'){const result=await handleEditLog(body,user.id,supabaseEditLogPorts(db));return json(result.body,result.status);}
  if(action==='profile'){const result=await saveProfile(body,user.id,supabaseProfilePorts(db));return json(result.body,result.status);}
  // Memory sync (memory-sync.ts): records sealed on the user's computers, kept and handed back as ciphertext.
  if(action?.startsWith('memory-sync-')){const result=await handleMemorySync(action,body,user.id,supabaseMemorySyncPorts(db));return json(result.body,result.status);}
  if(action==='count-tokens'){const result=await countTokens(body,user.id,db,Deno.env.get('ANTHROPIC_API_KEY'));return json(result.body,result.status);}
  if(action==='ai'){const timing:Record<string,number>={auth:authMs};const result=await handleAI(body,user.id,{db,deepseekThinking:Deno.env.get('DREAM_DEEPSEEK_THINKING')??'auto',key:Deno.env.get('ANTHROPIC_API_KEY'),providerKeys:Object.fromEntries(Object.entries(providerSecrets).map(([id,secret])=>[id,Deno.env.get(secret)])),requests,timeoutMs:Math.min(350000,Math.max(1000,Number(Deno.env.get('DREAM_AI_MAX_WALL_MS'))||350000)),deepseekRoute:Deno.env.get('DEEPSEEK_ROUTE'),timing});if(result.finished)EdgeRuntime.waitUntil(result.finished);
   // Where the time before the first word went (auth, the usage reservation, the provider's first byte), for the
   // extension's latency meter.
   const timed={...cors,'Server-Timing':serverTiming(timing)};
   return result.stream?new Response(result.stream,{status:200,headers:{...timed,'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform'}}):Response.json(result.body,{status:result.status,headers:timed});}
  if(action==='share-create'){
   const id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID(),key=`${user.id}/${id}.mp4`;
   const story=shareStory(body);const {error}=await db.from('dream_shares').insert({id,user_id:user.id,token_hash:await sha(token),object_key:key,title:String(body.title??'Gumbo video').slice(0,200),prompts:story.prompts,source:story.source,duration_sec:story.durationSec});if(error)throw error;
   const {data:signed,error:uploadError}=await db.storage.from('dream-exports').createSignedUploadUrl(key);if(uploadError)throw uploadError;
   return json({id,token,objectKey:key,uploadUrl:signed.signedUrl});
  }
  if(action==='share-complete'){const {data:share}=await db.from('dream_shares').select('object_key').eq('id',body.id).eq('user_id',user.id).eq('status','uploading').single();if(!share)return json({error:'Share not found'},404);const {data:files}=await db.storage.from('dream-exports').list(user.id,{search:`${body.id}.mp4`});const file=files?.find((f:any)=>f.name===`${body.id}.mp4`);if(!file)return json({error:'Upload has not finished'},409);await db.from('dream_shares').update({status:'ready',size_bytes:file.metadata?.size??0}).eq('id',body.id).eq('user_id',user.id);return json({ready:true});}
  if(action==='share-revoke'){const {error}=await db.from('dream_shares').update({status:'revoked'}).eq('id',body.id).eq('user_id',user.id);if(error)throw error;return json({revoked:true});}
  return json({error:'Unknown command'},404);
 }catch(error){return json({error:error instanceof Error?error.message:'Request failed'},500);}
});
