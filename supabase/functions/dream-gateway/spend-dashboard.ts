/** The spending dashboard's data (usegumbo.app/dashboard/): every billed call, for whoever has the dashboard password.
 * The password is the DREAM_DASHBOARD_PASSWORD secret, compared by digest in constant time; it is never in the page or
 * this repository. Wrong guesses are counted per network address (stored only as a digest) and an address that makes
 * too many in a quarter of an hour is refused until they age out. Accounts are named by a label, never their email. */
export type SpendCall={user_id:string;turn_id:string;model:string;status:string;cost_usd:number|string;reserved_usd:number|string;input_tokens:number;output_tokens:number;cache_read_tokens:number;cache_write_tokens:number;audio_seconds:number|string|null;error_code:string|null;provider_status:number|null;created_at:string};
export type SpendAccount={id:string;status:string;is_guest:boolean;daily_budget_usd:number|string;created_at:string};
export type SpendPorts={password?:string;calls():Promise<SpendCall[]>;accounts():Promise<SpendAccount[]>;
 failures(address:string,since:Date):Promise<number>;fail(address:string):Promise<void>;
 /** The balance last read off each provider's own billing page, and saving a new one. */
 balances?():Promise<{provider:string;balance_usd:number|string;set_at:string}[]>;setBalance?(provider:string,usd:number):Promise<void>;
 /** Which providers have a key here, and a provider's live balance where it publishes one (DeepSeek). */
 keys?:Partial<Record<BalanceProvider,boolean>>;liveBalance?(provider:BalanceProvider):Promise<LiveBalance|undefined>};
export const MAX_FAILURES=8,FAILURE_WINDOW_MS=15*60_000;

/** The API accounts Gumbo pays. Only DeepSeek publishes its balance (GET /user/balance); Anthropic, OpenAI, Google and
 * Groq show it only on their billing pages, so the dashboard keeps the balance read off that page and subtracts what the
 * gateway billed on that provider since. Calls made with the same key outside the gateway are not seen. */
export const balanceProviders=['Anthropic','OpenAI','Google','DeepSeek','Groq'] as const;
export type BalanceProvider=typeof balanceProviders[number];
export type LiveBalance={amount:number;currency:string;available:boolean};
export const providerKeys:Record<BalanceProvider,string>={Anthropic:'ANTHROPIC_API_KEY',OpenAI:'OPENAI_API_KEY',Google:'GEMINI_API_KEY',DeepSeek:'DEEPSEEK_API_KEY',Groq:'GROQ_API_KEY'};
/** DeepSeek's balance: the USD entry when the account has one, else its first currency. */
export async function deepseekBalance(key:string,fetcher=fetch):Promise<LiveBalance>{
 const response=await fetcher('https://api.deepseek.com/user/balance',{headers:{Authorization:'Bearer '+key,Accept:'application/json'},signal:AbortSignal.timeout(10_000)});
 if(!response.ok)throw new Error('DeepSeek answered '+response.status);
 const body:any=await response.json(),infos:any[]=Array.isArray(body?.balance_infos)?body.balance_infos:[],info=infos.find(i=>i?.currency==='USD')??infos[0];
 if(!info)throw new Error('DeepSeek sent no balance');
 return {amount:Number(info.total_balance),currency:String(info.currency),available:body.is_available!==false};
}
const billed=(c:SpendCall)=>c.status==='reserved'?0:Number(c.cost_usd);
async function balanceRows(ports:SpendPorts,calls:SpendCall[]){
 const saved=new Map((await ports.balances?.()??[]).map(b=>[b.provider,b]));
 return Promise.all(balanceProviders.filter(p=>ports.keys?.[p]||saved.has(p)||calls.some(c=>providerOf(c.model)===p)).map(async provider=>{
  let live:LiveBalance|undefined,liveError:string|undefined;
  if(ports.keys?.[provider]&&ports.liveBalance)try{live=await ports.liveBalance(provider);}catch(error){liveError=(error as Error).message;}
  const entry=saved.get(provider),at=entry?new Date(entry.set_at):undefined;
  const spentSince=at?calls.filter(c=>providerOf(c.model)===provider&&new Date(c.created_at)>=at).reduce((s,c)=>s+billed(c),0):0;
  return {provider,key:!!ports.keys?.[provider],...(live?{live}:{}),...(liveError?{liveError}:{}),
   ...(entry?{entered:{usd:Number(entry.balance_usd),at:at!.toISOString()},spentSince,remaining:Number(entry.balance_usd)-spentSince}:{})};
 }));
}

const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const hex=(bytes:Uint8Array)=>Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
async function matches(given:string,expected:string){const [a,b]=await Promise.all([digest(given),digest(expected)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;}
export const providerOf=(model:string)=>/^claude/.test(model)?'Anthropic':/^gpt|^o\d/.test(model)?'OpenAI':/^gemini/.test(model)?'Google':/^deepseek/.test(model)?'DeepSeek':/^whisper/.test(model)?'Groq':'Other';

export async function handleSpendDashboard(body:unknown,address:string,ports:SpendPorts){
 if(!ports.password)return {status:503,body:{error:'The dashboard is not set up yet.'}};
 const who=hex(await digest('dashboard:'+address));
 if(await ports.failures(who,new Date(Date.now()-FAILURE_WINDOW_MS))>=MAX_FAILURES)return {status:429,body:{error:'Too many wrong passwords. Try again in 15 minutes.'}};
 const given=typeof (body as any)?.password==='string'?(body as any).password:'';
 if(!given||!await matches(given,ports.password)){await ports.fail(who);return {status:401,body:{error:'Wrong password.'}};}
 // A balance read off a provider's billing page, entered on the dashboard: the remaining amount counts down from it.
 const set=(body as any)?.setBalance;
 if(set!==undefined){
  const usd=Number(set?.usd);
  if(!balanceProviders.includes(set?.provider)||typeof set?.usd!=='number'||!Number.isFinite(usd)||usd<0||usd>1_000_000)return {status:400,body:{error:'Give a provider and a balance in dollars.'}};
  if(!ports.setBalance)return {status:503,body:{error:'Balances cannot be saved here.'}};
  await ports.setBalance(set.provider,Math.round(usd*100)/100);
 }
 const [calls,accounts]=await Promise.all([ports.calls(),ports.accounts()]);
 const balances=await balanceRows(ports,calls);
 // Each account gets a stable label from when it was made; ids and emails stay on the server.
 const ordered=[...accounts].sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime());
 const label=new Map(ordered.map((a,i)=>[a.id,{key:'a'+(i+1),name:`${a.is_guest?'Guest':'Account'} ${i+1}`}]));
 const keyOf=(id:string)=>label.get(id)?.key??'a0';
 return {status:200,body:{generatedAt:new Date().toISOString(),balances,
  accounts:ordered.map(a=>({key:label.get(a.id)!.key,name:label.get(a.id)!.name,status:a.status,guest:a.is_guest,dailyBudget:Number(a.daily_budget_usd),since:new Date(a.created_at).toISOString()})),
  calls:calls.map(c=>({account:keyOf(c.user_id),turn:c.turn_id,model:c.model,provider:providerOf(c.model),status:c.status,cost:Number(c.cost_usd),reserved:Number(c.reserved_usd),
   input:c.input_tokens,output:c.output_tokens,cacheRead:c.cache_read_tokens,cacheWrite:c.cache_write_tokens,audio:Number(c.audio_seconds??0),error:c.error_code,http:c.provider_status,at:new Date(c.created_at).toISOString()}))}};
}

/** The ports over the gateway's database client: every call, a page of 1,000 at a time (the most one select returns).
 * secret reads the gateway's secrets, for which providers have a key and DeepSeek's live balance. */
export function supabaseSpendPorts(db:any,password?:string,secret:(name:string)=>string|undefined=()=>undefined):SpendPorts{
 return {password,
  keys:Object.fromEntries(balanceProviders.map(p=>[p,!!secret(providerKeys[p])])),
  async liveBalance(provider){const key=secret(providerKeys[provider]);return provider==='DeepSeek'&&key?deepseekBalance(key):undefined;},
  async balances(){const {data,error}=await db.from('dream_provider_balances').select('provider,balance_usd,set_at');if(error)throw error;return data??[];},
  async setBalance(provider,usd){const {error}=await db.from('dream_provider_balances').upsert({provider,balance_usd:usd,set_at:new Date().toISOString()});if(error)throw error;},
  async calls(){const rows:SpendCall[]=[];for(let from=0;from<500_000;from+=1000){const {data,error}=await db.from('dream_usage').select('user_id,turn_id,model,status,cost_usd,reserved_usd,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,audio_seconds,error_code,provider_status,created_at').order('created_at').range(from,from+999);if(error)throw error;rows.push(...(data??[]));if(!data||data.length<1000)break;}return rows;},
  async accounts(){const {data,error}=await db.from('dream_accounts').select('id,status,is_guest,daily_budget_usd,created_at');if(error)throw error;return data??[];},
  async failures(address,since){const {count,error}=await db.from('dream_dashboard_attempts').select('address',{count:'exact',head:true}).eq('address',address).gte('created_at',since.toISOString());if(error)throw error;return count??0;},
  async fail(address){await db.from('dream_dashboard_attempts').insert({address});}};
}
