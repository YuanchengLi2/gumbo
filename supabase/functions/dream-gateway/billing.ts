/** Billing through Stripe: plans and top-up credits. One credit is one cent of what Gumbo's AI costs Gumbo; the database
 * keeps each account's credit grants and takes every request's cost from them (migrations/202610170003_billing.sql).
 *
 * Paying happens on Stripe's own pages, opened in the browser: Checkout to start a plan or buy credits, the customer portal
 * to change or cancel a plan, see invoices and update the card. Stripe tells the gateway what happened through its webhook
 * (signed with STRIPE_WEBHOOK_SECRET, checked here), and only the webhook grants credits:
 * - a plan's invoice is paid: that plan's credits for the period it pays for (a new period replaces the last);
 * - a top-up's checkout is paid: its credits, which do not expire;
 * - a subscription changes or ends: the account's plan follows it.
 * The secrets are STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, and the prices' ids STRIPE_PRICE_PRO, STRIPE_PRICE_MAX,
 * STRIPE_PRICE_MAX20 and STRIPE_PRICE_TOPUP (scripts/stripe-setup.mjs makes them in test mode). A plan's price that
 * changed keeps its old id in STRIPE_PRICES_OLD ("pro=price_...,max=price_..."), so subscriptions still on it stay that plan. */

/** limits: what each plan includes beyond credits. creatorSearches: the composer's @ searches of YouTube channels a month
 * (the built-in style library is unlimited). styleMemory: how many of the user's other projects the agent carries their
 * style from (null: all). */
export const PLANS={
 free:{name:'Free',priceUsd:0,credits:50,limits:{creatorSearches:10,styleMemory:1}},
 pro:{name:'Pro',priceUsd:25,credits:1250,limits:{creatorSearches:200,styleMemory:6}},
 max:{name:'Max',priceUsd:100,credits:4500,limits:{creatorSearches:1000,styleMemory:20}},
 max20:{name:'Max 20x',priceUsd:200,credits:18000,limits:{creatorSearches:5000,styleMemory:null}}
} as const;
export type PlanLimits={creatorSearches:number;styleMemory:number|null};
export type PlanId=keyof typeof PLANS;
export type PaidPlan=Exclude<PlanId,'free'>;
export const paidPlans:PaidPlan[]=['pro','max','max20'];
export const TOPUP={credits:500,priceUsd:10,maxPacks:10};
/** A paid period's credits last a few days past its end, so a renewal Stripe charges late does not leave the account empty. */
export const GRACE_MS=3*86_400_000;
const MONTH_MS=30.44*86_400_000;

export type StripeConfig={secret:string;webhookSecret?:string;prices:Partial<Record<PaidPlan|'topup',string>>;oldPrices?:Partial<Record<PaidPlan,string[]>>;returnUrl:string};
export function stripeConfig(env:(name:string)=>string|undefined):StripeConfig|undefined{
 const secret=env('STRIPE_SECRET_KEY');if(!secret)return undefined;
 return{secret,webhookSecret:env('STRIPE_WEBHOOK_SECRET'),returnUrl:env('DREAM_BILLING_RETURN_URL')||'https://usegumbo.app/billing/',
  prices:{pro:env('STRIPE_PRICE_PRO'),max:env('STRIPE_PRICE_MAX'),max20:env('STRIPE_PRICE_MAX20'),topup:env('STRIPE_PRICE_TOPUP')},oldPrices:oldPrices(env('STRIPE_PRICES_OLD'))};
}
export function oldPrices(text?:string){
 const out:Partial<Record<PaidPlan,string[]>>={};
 for(const pair of (text??'').split(',')){const [plan,price]=pair.split('=').map(x=>x.trim());if(paidPlans.includes(plan as PaidPlan)&&price)(out[plan as PaidPlan]??=[]).push(price);}
 return out;
}
const planOfPrice=(config:StripeConfig,price:unknown):PaidPlan|undefined=>typeof price!=='string'||!price?undefined:paidPlans.find(plan=>config.prices[plan]===price||!!config.oldPrices?.[plan]?.includes(price));

/** Stripe's form encoding, nested keys in brackets: {line_items:[{price:'p',quantity:1}]} is line_items[0][price]=p&... */
export function stripeForm(params:Record<string,unknown>){
 const out=new URLSearchParams();
 const add=(key:string,value:unknown)=>{
  if(value===undefined||value===null)return;
  if(Array.isArray(value))value.forEach((v,i)=>add(`${key}[${i}]`,v));
  else if(typeof value==='object')for(const [k,v] of Object.entries(value as Record<string,unknown>))add(`${key}[${k}]`,v);
  else out.append(key,String(value));
 };
 for(const [k,v] of Object.entries(params))add(k,v);
 return out;
}
export async function stripeCall(config:StripeConfig,path:string,params?:Record<string,unknown>,fetcher:typeof fetch=fetch):Promise<any>{
 const response=await fetcher('https://api.stripe.com/v1/'+path,{method:params?'POST':'GET',headers:{Authorization:'Bearer '+config.secret,...(params?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:params?stripeForm(params):undefined,signal:AbortSignal.timeout(20_000)});
 const body:any=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(body?.error?.message||`Stripe answered ${response.status}`);
 return body;
}

/** Stripe-Signature is t=<seconds>,v1=<hex HMAC-SHA256 of "t.payload">[,v1=...]; an event older than tolerance is refused. */
export async function verifyStripeSignature(payload:string,header:string|null,secret:string,now=Date.now(),toleranceSec=300){
 if(!header)return false;
 const parts=header.split(',').map(p=>p.split('=') as [string,string]),t=Number(parts.find(([k])=>k==='t')?.[1]),signatures=parts.filter(([k])=>k==='v1').map(([,v])=>v);
 if(!Number.isFinite(t)||!signatures.length||Math.abs(now/1000-t)>toleranceSec)return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const expected=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${t}.${payload}`)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 const same=(a:string,b:string)=>{if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;};
 return signatures.some(s=>same(s,expected));
}

export type BillingAccount={email:string;plan:PlanId;stripe_customer_id:string|null;stripe_subscription_id:string|null;subscription_status:string|null;period_end:string|null;cancel_at_period_end:boolean;credit_overdraft:number|string};
export type CreditGrant={kind:'plan'|'topup'|'gift';plan:PlanId|null;credits:number|string;remaining:number|string;expires_at:string|null};
export type SubscriptionPatch=Partial<Pick<BillingAccount,'plan'|'stripe_subscription_id'|'subscription_status'|'period_end'|'cancel_at_period_end'>>;
/** The database, as billing uses it (supabaseBillingPorts; tests give their own). */
export type BillingPorts={
 account(user:string):Promise<BillingAccount|null>;
 /** The grants still running (not expired). */
 grants(user:string):Promise<CreditGrant[]>;
 /** This month's use of the plan's allowances (creator searches). */
 usage?(user:string):Promise<{creatorSearches:number}>;
 ensureFree(user:string):Promise<void>;
 setCustomer(user:string,customer:string):Promise<void>;
 userOfCustomer(customer:string):Promise<string|undefined>;
 updateSubscription(user:string,patch:SubscriptionPatch):Promise<void>;
 grant(user:string,kind:'plan'|'topup',plan:PlanId|null,credits:number,source:string,starts:Date,expires:Date|null):Promise<boolean>;
 /** Ends the paid plan's running grant (a subscription that stopped before its period did). */
 endPlanGrants(user:string):Promise<void>;
};

const round=(n:number)=>Math.round(n*100)/100;
/** Settings > Usage and billing, and the profile menu: the plan, the credits left (the plan's and top-ups'), when the plan's
 * renew, the plans on offer, and whether paying is set up on this gateway. */
export async function billingSummary(user:string,ports:BillingPorts,config:StripeConfig|undefined){
 await ports.ensureFree(user);
 const [account,grants,usage]=await Promise.all([ports.account(user),ports.grants(user),ports.usage?.(user)??Promise.resolve({creatorSearches:0})]);
 if(!account)throw new Error('No such account');
 const planGrant=grants.find(g=>g.kind==='plan'),topups=grants.filter(g=>g.kind!=='plan').reduce((n,g)=>n+Number(g.remaining),0),overdraft=Number(account.credit_overdraft)||0;
 const planLeft=planGrant?Number(planGrant.remaining):0;
 return{
  plan:account.plan,planName:PLANS[account.plan].name,status:account.subscription_status,cancelAtPeriodEnd:account.cancel_at_period_end,
  renewsAt:account.plan==='free'?(planGrant?.expires_at??null):account.period_end,
  credits:{left:round(planLeft+topups-overdraft),plan:round(planLeft),planTotal:planGrant?Number(planGrant.credits):PLANS[account.plan].credits,topups:round(topups),overdraft:round(overdraft)},
  limits:PLANS[account.plan].limits as PlanLimits,usage,
  plans:(Object.keys(PLANS) as PlanId[]).map(id=>({id,name:PLANS[id].name,priceUsd:PLANS[id].priceUsd,credits:PLANS[id].credits,limits:PLANS[id].limits as PlanLimits})),
  topup:{credits:TOPUP.credits,priceUsd:TOPUP.priceUsd,maxPacks:TOPUP.maxPacks},
  payments:!!config&&paidPlans.every(p=>config.prices[p])&&!!config.prices.topup,
  portal:!!account.stripe_customer_id
 };
}

/** A Checkout page for a plan, or for packs of credits. An account already on a paid plan changes plan in the portal
 * (Stripe prorates it there), so asking for a plan then opens the portal instead. */
export async function startCheckout(user:string,request:{plan?:unknown;packs?:unknown},ports:BillingPorts,config:StripeConfig,fetcher:typeof fetch=fetch):Promise<{url:string}>{
 const account=await ports.account(user);if(!account)throw new Error('No such account');
 const who=account.stripe_customer_id?{customer:account.stripe_customer_id}:{customer_email:account.email||undefined};
 const back=(status:string)=>`${config.returnUrl}?status=${status}`;
 if(request.plan!==undefined){
  const plan=request.plan as PaidPlan;if(!paidPlans.includes(plan))throw new Error('Choose Pro, Max or Max 20x.');
  if(!config.prices[plan])throw new Error('Plans are not set up on the gateway yet.');
  if(account.plan===plan)throw new Error('You are already on that plan.');
  if(account.plan!=='free'&&account.stripe_subscription_id&&account.stripe_customer_id)return openPortal(user,ports,config,fetcher,{change:plan});
  const session=await stripeCall(config,'checkout/sessions',{mode:'subscription',...who,client_reference_id:user,line_items:[{price:config.prices[plan],quantity:1}],
   metadata:{user_id:user,kind:'plan',plan},subscription_data:{metadata:{user_id:user}},allow_promotion_codes:true,success_url:back('subscribed'),cancel_url:back('cancelled')},fetcher);
  return{url:session.url};
 }
 const packs=Math.floor(Number(request.packs??1));if(!(packs>=1&&packs<=TOPUP.maxPacks))throw new Error(`Buy between 1 and ${TOPUP.maxPacks} packs of credits.`);
 if(!config.prices.topup)throw new Error('Credits are not set up on the gateway yet.');
 const session=await stripeCall(config,'checkout/sessions',{mode:'payment',...who,...(account.stripe_customer_id?{}:{customer_creation:'always'}),client_reference_id:user,
  line_items:[{price:config.prices.topup,quantity:packs}],metadata:{user_id:user,kind:'topup',credits:packs*TOPUP.credits},invoice_creation:{enabled:true},
  success_url:back('credits'),cancel_url:back('cancelled')},fetcher);
 return{url:session.url};
}

/** The customer portal: invoices, the card, and the plan. With a flow it opens straight on one step: confirming a change
 * to another paid plan (Stripe prorates it), or cancelling at the end of the period (which is how Free is chosen). */
export async function openPortal(user:string,ports:BillingPorts,config:StripeConfig,fetcher:typeof fetch=fetch,flow?:{change:PaidPlan}|{cancel:true}):Promise<{url:string}>{
 const account=await ports.account(user);
 if(!account?.stripe_customer_id)throw new Error('There is nothing to manage yet: choose a plan or buy credits first.');
 const back=`${config.returnUrl}?status=portal`,subscription=account.stripe_subscription_id;
 let flow_data:Record<string,unknown>|undefined;
 if(flow&&!subscription)throw new Error('You have no plan to change: choose one first.');
 if(flow&&'cancel' in flow)flow_data={type:'subscription_cancel',subscription_cancel:{subscription},after_completion:{type:'redirect',redirect:{return_url:back}}};
 if(flow&&'change' in flow){
  const sub=await stripeCall(config,'subscriptions/'+subscription,undefined,fetcher),item=sub?.items?.data?.[0]?.id;if(!item)throw new Error('Your plan could not be found on Stripe.');
  flow_data={type:'subscription_update_confirm',subscription_update_confirm:{subscription,items:[{id:item,price:config.prices[flow.change],quantity:1}]},after_completion:{type:'redirect',redirect:{return_url:back}}};
 }
 const session=await stripeCall(config,'billing_portal/sessions',{customer:account.stripe_customer_id,return_url:back,...(flow_data?{flow_data}:{})},fetcher);
 return{url:session.url};
}

// Stripe moved some fields between API versions; these read either place.
const subscriptionOfInvoice=(invoice:any):string|undefined=>invoice.subscription??invoice.parent?.subscription_details?.subscription??undefined;
const priceOfLine=(line:any):string|undefined=>line?.price?.id??line?.pricing?.price_details?.price??line?.plan?.id??undefined;
const periodOfSubscription=(sub:any):number|undefined=>sub.current_period_end??sub.items?.data?.[0]?.current_period_end;
const id=(value:any):string|undefined=>typeof value==='string'?value:value?.id;

/** What a verified webhook event does. Returns a short note of what changed, for the log. Unknown events are ignored. */
export async function handleStripeEvent(event:any,ports:BillingPorts,config:StripeConfig):Promise<string>{
 const object=event?.data?.object??{};
 const userFor=async(customer?:string,fallback?:string)=>(customer?await ports.userOfCustomer(customer):undefined)??fallback;
 switch(event?.type){
  case 'checkout.session.completed':case 'checkout.session.async_payment_succeeded':{
   const user=object.client_reference_id??object.metadata?.user_id;if(!user)return 'checkout without an account';
   const customer=id(object.customer);if(customer)await ports.setCustomer(user,customer);
   if(object.mode==='payment'&&object.metadata?.kind==='topup'){
    if(object.payment_status!=='paid')return 'top-up awaiting payment';
    const credits=Number(object.metadata.credits);if(!(credits>0))return 'top-up without credits';
    const granted=await ports.grant(user,'topup',null,credits,'checkout:'+object.id,new Date(),null);
    return granted?`top-up of ${credits} credits`:'top-up already granted';
   }
   if(object.mode==='subscription'){const subscription=id(object.subscription);if(subscription)await ports.updateSubscription(user,{stripe_subscription_id:subscription});return 'subscription checkout';}
   return 'checkout ignored';
  }
  case 'invoice.paid':{
   const customer=id(object.customer),user=await userFor(customer,object.subscription_details?.metadata?.user_id??object.parent?.subscription_details?.metadata?.user_id);
   if(!user)return 'invoice for an unknown customer';
   const lines:any[]=object.lines?.data??[],line=lines.find(l=>planOfPrice(config,priceOfLine(l))&&Number(l.amount)>=0)??lines.find(l=>planOfPrice(config,priceOfLine(l)));
   const plan=line?planOfPrice(config,priceOfLine(line)):undefined;if(!plan)return 'invoice without a plan';
   const start=new Date(Number(line.period?.start??object.period_start)*1000),end=new Date(Number(line.period?.end??object.period_end)*1000);
   // A change of plan mid-period is invoiced for the rest of the period only (prorated), so it brings that share of the
   // new plan's credits, replacing what was left of the old plan's: upgrading late in a month cannot buy a whole month.
   const share=object.billing_reason==='subscription_update'?Math.min(1,Math.max(0,(end.getTime()-start.getTime())/MONTH_MS)):1,credits=Math.round(PLANS[plan].credits*share);
   await ports.updateSubscription(user,{plan,stripe_subscription_id:subscriptionOfInvoice(object)??null,subscription_status:'active',period_end:end.toISOString()});
   const granted=await ports.grant(user,'plan',plan,credits,'invoice:'+object.id,start,new Date(end.getTime()+GRACE_MS));
   return granted?`${PLANS[plan].name}: ${credits} credits`:'invoice already granted';
  }
  case 'customer.subscription.created':case 'customer.subscription.updated':case 'customer.subscription.deleted':{
   const user=await userFor(id(object.customer),object.metadata?.user_id);if(!user)return 'subscription of an unknown customer';
   const ended=event.type==='customer.subscription.deleted'||['canceled','unpaid','incomplete_expired'].includes(object.status);
   const plan=planOfPrice(config,priceOfLine(object.items?.data?.[0])),end=periodOfSubscription(object);
   if(ended){
    await ports.updateSubscription(user,{plan:'free',stripe_subscription_id:null,subscription_status:object.status??'canceled',cancel_at_period_end:false,period_end:null});
    // Credits the period paid for stay until it ends; a subscription stopped early (a refund, a failed renewal) ends them now.
    if(!end||end*1000<=Date.now()+60_000)await ports.endPlanGrants(user);
    return 'subscription ended';
   }
   // The plan follows the subscription's price; its credits come with the invoice that pays for it.
   await ports.updateSubscription(user,{...(plan&&['active','trialing','past_due'].includes(object.status)?{plan}:{}),stripe_subscription_id:object.id,subscription_status:object.status,cancel_at_period_end:!!object.cancel_at_period_end,period_end:end?new Date(end*1000).toISOString():null});
   return `subscription ${object.status}`;
  }
  default:return 'ignored';
 }
}

/** The ports over the gateway's Supabase client (service role). */
export function supabaseBillingPorts(db:any):BillingPorts{
 const check=({data,error}:{data:any;error:any})=>{if(error)throw new Error(error.message);return data;};
 return{
  account:async user=>check(await db.from('dream_accounts').select('email,plan,stripe_customer_id,stripe_subscription_id,subscription_status,period_end,cancel_at_period_end,credit_overdraft').eq('id',user).maybeSingle()),
  usage:async user=>{const period=new Date().toISOString().slice(0,7),row=check(await db.from('dream_usage_counters').select('count').eq('account_id',user).eq('period',period).eq('kind','creator_search').maybeSingle());return{creatorSearches:Number(row?.count)||0};},
  grants:async user=>check(await db.from('dream_credit_grants').select('kind,plan,credits,remaining,expires_at').eq('user_id',user).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order('created_at',{ascending:false}))??[],
  ensureFree:async user=>{check(await db.rpc('dream_ensure_free_grant',{p_user:user}));},
  setCustomer:async(user,customer)=>{check(await db.from('dream_accounts').update({stripe_customer_id:customer}).eq('id',user));},
  userOfCustomer:async customer=>check(await db.from('dream_accounts').select('id').eq('stripe_customer_id',customer).maybeSingle())?.id,
  updateSubscription:async(user,patch)=>{check(await db.from('dream_accounts').update(patch).eq('id',user));},
  grant:async(user,kind,plan,credits,source,starts,expires)=>!!check(await db.rpc('dream_grant_credits',{p_user:user,p_kind:kind,p_plan:plan,p_credits:credits,p_source:source,p_starts:starts.toISOString(),p_expires:expires?.toISOString()??null})),
  endPlanGrants:async user=>{check(await db.from('dream_credit_grants').update({expires_at:new Date().toISOString()}).eq('user_id',user).eq('kind','plan').neq('plan','free').or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`));}
 };
}
