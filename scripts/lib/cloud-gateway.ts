import {exec} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import postgres from 'postgres';
/** The deployed gateway, as a temporary test account with the budget in credits, for live evaluations that must run on
 * what users get (the gateway holds every provider's key: Cerebras, DeepSeek, …). The account is exempt from the daily
 * limits (an administrator), so the budget alone caps it, and is deleted when the run ends; a run that was stopped leaves
 * its account behind, and the next run with the same prefix deletes it. That needs the Supabase CLI logged in, and
 * DREAM_DB_PASSWORD in .env.local with the pooler address `supabase link` saved (as scripts/gift-credits.ts does).
 * Shared by scripts/eval-roux.ts and the extension's live tests (apps/extension/test/standin.ts). */
export type Gateway={connection:()=>Promise<{url:string;token:string;accountId:string}>;providers:Record<string,boolean>;close:()=>Promise<void>};
const root=resolve(import.meta.dirname,'../..');
export const readEnv=(path:string)=>existsSync(path)?Object.fromEntries(readFileSync(path,'utf8').split(/\r?\n/).map(line=>/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)).filter(Boolean).map(m=>[m![1],m![2].replace(/^["']|["']$/g,'')])):{};

export async function cloudGateway({budget,prefix,app}:{budget:number;
 /** What the test accounts' emails start with (one kind of run cleans up only its own). */prefix:string;
 /** The database connection's application name. */app:string}):Promise<Gateway>{
 const ref=readFileSync(resolve(root,'supabase/.temp/project-ref'),'utf8').trim(),base=`https://${ref}.supabase.co`,gateway=`${base}/functions/v1/dream-gateway`;
 // Asked without blocking: a test's stand-in server shares this process and must keep serving pages meanwhile.
 const keys=JSON.parse((await promisify(exec)(`npx supabase projects api-keys --project-ref ${ref} --output json`,{encoding:'utf8',cwd:root})).stdout);
 const service=keys.find((k:any)=>k.name==='service_role')?.api_key;if(!service)throw new Error('Could not read the project keys; is the Supabase CLI logged in?');
 const api=async(path:string,body?:unknown,token=service,method=body?'POST':'GET')=>{const response=await fetch(base+path,{method,headers:{apikey:service,Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const text=await response.text();if(!response.ok)throw new Error(`${path.split('?')[0]} failed (${response.status}): ${text.slice(0,200)}`);return text?JSON.parse(text):null;};
 const env=readEnv(resolve(root,'.env.local')),pooler=new URL(readFileSync(resolve(root,'supabase/.temp/pooler-url'),'utf8').trim());pooler.password=encodeURIComponent(env.DREAM_DB_PASSWORD??'');
 const sql=postgres(pooler.toString(),{ssl:'require',max:1,idle_timeout:5,connect_timeout:15,connection:{application_name:app}});
 // Gumbo's spending today, so the run never takes the day's capacity from real users.
 const [{spent:today,limit}]=await sql`select coalesce((select sum(cost_usd) from public.dream_usage where created_at>=date_trunc('day',now() at time zone 'utc') at time zone 'utc'),0)::float as spent,(select global_daily_usd from public.dream_limits where id)::float as limit`;
 if(today+budget>limit*.8){await sql.end();throw new Error(`Gumbo has spent $${today.toFixed(2)} of its $${limit} daily limit today; a $${budget} run would leave too little for users.`);}
 // A run that was stopped leaves its test account behind; it goes now.
 for(const {id} of await sql`select id from auth.users where email like ${prefix+'%@example.invalid'}`)await api(`/auth/v1/admin/users/${id}`,undefined,service,'DELETE');
 const email=`${prefix}${randomUUID()}@example.invalid`,password=randomUUID()+randomUUID(),user=await api('/auth/v1/admin/users',{email,password,email_confirm:true});
 let session:any,signedAt=0;const signIn=async()=>{session=await api('/auth/v1/token?grant_type=password',{email,password});signedAt=Date.now();};
 const remove=async()=>{await sql.end().catch(()=>{});await api(`/auth/v1/admin/users/${user.id}`,undefined,service,'DELETE').catch(error=>console.log(`Could not delete the test account ${email}: ${(error as Error).message}`));};
 try{
  await signIn();
  // The first call to the gateway makes the account; then it gets the credits and the exemption.
  const providers=await (await fetch(`${gateway}/account`,{headers:{Authorization:'Bearer '+session.access_token}})).json().then(()=>fetch(`${gateway}/providers`,{headers:{Authorization:'Bearer '+session.access_token}})).then(r=>r.json());
  await sql`update public.dream_accounts set is_admin=true where id=${user.id}`;
  await sql`select public.dream_grant_credits(${user.id},'gift',null,${Math.ceil(budget*100)},${'eval:'+email},now(),null)`;
  console.log(`Signed in to the deployed gateway as a test account with $${budget} of credits (Gumbo has spent $${today.toFixed(2)} of $${limit} today).`);
  return{connection:async()=>{if(Date.now()-signedAt>40*60_000)await signIn();return{url:gateway,token:session.access_token,accountId:user.id};},providers,close:remove};
 }catch(error){await remove();throw error;}
}
