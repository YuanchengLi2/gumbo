import {describe,it,expect} from 'vitest';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PLANS,TOPUP,GRACE_MS,stripeForm,verifyStripeSignature,billingSummary,startCheckout,handleStripeEvent,oldPrices,type BillingPorts,type BillingAccount,type StripeConfig} from '../../supabase/functions/dream-gateway/billing';

const config:StripeConfig={secret:'sk_test_x',webhookSecret:'whsec_x',returnUrl:'https://usegumbo.app/billing/',prices:{pro:'price_pro',max:'price_max',max20:'price_max20',topup:'price_topup'}};
/** An account and its grants in memory, recording what billing does to them. */
function memory(start:Partial<BillingAccount>={}){
 const account:BillingAccount={email:'a@test',plan:'free',stripe_customer_id:null,stripe_subscription_id:null,subscription_status:null,period_end:null,cancel_at_period_end:false,credit_overdraft:0,...start};
 const grants:{kind:'plan'|'topup';plan:any;credits:number;remaining:number;source:string;expires_at:string|null}[]=[],ended:string[]=[];
 const ports:BillingPorts={
  account:async()=>account,grants:async()=>grants.filter(g=>!g.expires_at||new Date(g.expires_at)>new Date()),ensureFree:async()=>{},
  setCustomer:async(_u,c)=>{account.stripe_customer_id=c;},userOfCustomer:async c=>c===account.stripe_customer_id?'user-1':undefined,
  updateSubscription:async(_u,patch)=>{Object.assign(account,patch);},
  grant:async(_u,kind,plan,credits,source,_s,expires)=>{if(grants.some(g=>g.source===source))return false;grants.push({kind,plan,credits,remaining:credits,source,expires_at:expires?.toISOString()??null});return true;},
  endPlanGrants:async u=>{ended.push(u);}
 };
 return{account,grants,ended,ports};
}
const sign=(payload:string,secret:string,t=Math.floor(Date.now()/1000))=>`t=${t},v1=${createHmac('sha256',secret).update(`${t}.${payload}`).digest('hex')}`;

describe('billing',()=>{
 it('keeps the free plan\'s credits the same in the gateway and the database',()=>{
  // The migration that last defines the free credits is the one the database runs.
  const {readdirSync}=require('node:fs') as typeof import('node:fs'),latest=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync('supabase/migrations/'+f,'utf8')).filter(sql=>sql.includes('function public.dream_free_credits()')).at(-1);
  expect(latest).toContain(`select ${PLANS.free.credits}::numeric`);expect(PLANS.free.credits).toBe(20);
  expect([PLANS.pro.priceUsd,PLANS.max.priceUsd,PLANS.max20.priceUsd,PLANS.pro.credits,PLANS.max.credits,PLANS.max20.credits,TOPUP.credits,TOPUP.priceUsd]).toEqual([25,100,200,1250,4500,18000,500,10]);
 });
 it('encodes Stripe\'s nested form fields',()=>{
  expect(stripeForm({mode:'payment',line_items:[{price:'p',quantity:2}],metadata:{user_id:'u'},skip:undefined}).toString()).toBe('mode=payment&line_items%5B0%5D%5Bprice%5D=p&line_items%5B0%5D%5Bquantity%5D=2&metadata%5Buser_id%5D=u');
 });
 it('accepts only a webhook Stripe signed, recently',async()=>{
  const payload='{"id":"evt_1"}';
  expect(await verifyStripeSignature(payload,sign(payload,'whsec_x'),'whsec_x')).toBe(true);
  expect(await verifyStripeSignature(payload,sign(payload,'whsec_other'),'whsec_x')).toBe(false);
  expect(await verifyStripeSignature(payload+' ',sign(payload,'whsec_x'),'whsec_x')).toBe(false);
  expect(await verifyStripeSignature(payload,sign(payload,'whsec_x',Math.floor(Date.now()/1000)-3600),'whsec_x')).toBe(false);
  expect(await verifyStripeSignature(payload,null,'whsec_x')).toBe(false);
 });
 it('opens Checkout for a plan, for credits, and the portal for an account already paying',async()=>{
  const calls:{url:string;body:string}[]=[];const fetcher=(async(url:string,init:any)=>{calls.push({url,body:String(init.body)});return Response.json(url.includes('/subscriptions/')?{items:{data:[{id:'si_1'}]}}:{url:'https://checkout.stripe.com/x'});}) as typeof fetch;
  const {ports,account}=memory();
  expect(await startCheckout('user-1',{plan:'max'},ports,config,fetcher)).toEqual({url:'https://checkout.stripe.com/x'});
  const plan=new URLSearchParams(calls[0].body);expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
  expect([plan.get('mode'),plan.get('line_items[0][price]'),plan.get('client_reference_id'),plan.get('customer_email')]).toEqual(['subscription','price_max','user-1','a@test']);
  await startCheckout('user-1',{packs:3},ports,config,fetcher);
  const topup=new URLSearchParams(calls[1].body);expect([topup.get('mode'),topup.get('line_items[0][quantity]'),topup.get('metadata[credits]')]).toEqual(['payment','3','1500']);
  await expect(startCheckout('user-1',{packs:0},ports,config,fetcher)).rejects.toThrow(/between 1 and/);
  await expect(startCheckout('user-1',{plan:'gold'},ports,config,fetcher)).rejects.toThrow(/Choose/);
  Object.assign(account,{plan:'pro',stripe_customer_id:'cus_1',stripe_subscription_id:'sub_1'});
  // A paying account changes plan on Stripe's confirm step for that plan, prorated.
  await startCheckout('user-1',{plan:'max20'},ports,config,fetcher);expect(calls[2].url).toBe('https://api.stripe.com/v1/subscriptions/sub_1');expect(calls[3].url).toBe('https://api.stripe.com/v1/billing_portal/sessions');
  const change=new URLSearchParams(calls[3].body);expect([change.get('flow_data[type]'),change.get('flow_data[subscription_update_confirm][items][0][id]'),change.get('flow_data[subscription_update_confirm][items][0][price]')]).toEqual(['subscription_update_confirm','si_1','price_max20']);
  await expect(startCheckout('user-1',{plan:'pro'},ports,config,fetcher)).rejects.toThrow(/already on that plan/);
  const {openPortal}=await import('../../supabase/functions/dream-gateway/billing');await openPortal('user-1',ports,config,fetcher,{cancel:true});
  expect(new URLSearchParams(calls.at(-1)!.body).get('flow_data[type]')).toBe('subscription_cancel');
 });
 it('keeps a subscription on a plan\'s old price on that plan, at the plan\'s credits now',async()=>{
  expect(oldPrices('pro=price_pro_30, max=price_max_old,gold=x,pro=')).toEqual({pro:['price_pro_30'],max:['price_max_old']});
  const {ports,account}=memory({stripe_customer_id:'cus_1'}),start=Math.floor(Date.now()/1000),end=start+30*86400,withOld={...config,oldPrices:{pro:['price_pro_30']}};
  const event={type:'invoice.paid',data:{object:{id:'in_old',customer:'cus_1',billing_reason:'subscription_cycle',parent:{subscription_details:{subscription:'sub_1'}},lines:{data:[{amount:3000,pricing:{price_details:{price:'price_pro_30'}},period:{start,end}}]}}}};
  expect(await handleStripeEvent(event,ports,config)).toBe('invoice without a plan');
  expect(await handleStripeEvent(event,ports,withOld)).toBe('Pro: 1250 credits');expect(account.plan).toBe('pro');
 });
 it('grants a paid invoice\'s plan credits once, lasting a few days past the period',async()=>{
  const {ports,account,grants}=memory({stripe_customer_id:'cus_1'});const start=Math.floor(Date.now()/1000),end=start+30*86400;
  const event={type:'invoice.paid',data:{object:{id:'in_1',customer:'cus_1',billing_reason:'subscription_create',parent:{subscription_details:{subscription:'sub_1'}},lines:{data:[{amount:3000,pricing:{price_details:{price:'price_pro'}},period:{start,end}}]}}}};
  expect(await handleStripeEvent(event,ports,config)).toBe('Pro: 1250 credits');
  expect(await handleStripeEvent(event,ports,config)).toBe('invoice already granted');
  expect(grants).toHaveLength(1);expect(new Date(grants[0].expires_at!).getTime()).toBe(end*1000+GRACE_MS);
  expect([account.plan,account.stripe_subscription_id,account.period_end]).toEqual(['pro','sub_1',new Date(end*1000).toISOString()]);
 });
 it('gives a mid-period change of plan only the rest of the period\'s share of credits',async()=>{
  const {ports,grants}=memory({stripe_customer_id:'cus_1',plan:'pro'});const now=Math.floor(Date.now()/1000),end=now+Math.round(15.22*86400);
  await handleStripeEvent({type:'invoice.paid',data:{object:{id:'in_2',customer:'cus_1',billing_reason:'subscription_update',lines:{data:[
   {amount:-1500,price:{id:'price_pro'},period:{start:now,end}},{amount:5000,price:{id:'price_max'},period:{start:now,end}}]}}}},ports,config);
  expect(grants[0]).toMatchObject({plan:'max',credits:2250});
 });
 it('grants a paid top-up, links the customer, and waits for a payment still pending',async()=>{
  const {ports,account,grants}=memory();
  const session=(id:string,payment_status:string)=>({type:'checkout.session.completed',data:{object:{id,mode:'payment',payment_status,customer:'cus_9',client_reference_id:'user-1',metadata:{kind:'topup',credits:'1000'}}}});
  expect(await handleStripeEvent(session('cs_1','unpaid'),ports,config)).toBe('top-up awaiting payment');
  expect(await handleStripeEvent(session('cs_2','paid'),ports,config)).toBe('top-up of 1000 credits');
  expect(account.stripe_customer_id).toBe('cus_9');expect(grants).toMatchObject([{kind:'topup',credits:1000,expires_at:null}]);
 });
 it('follows the subscription: a new price, cancelling at the period end, and ending',async()=>{
  const {ports,account,ended}=memory({stripe_customer_id:'cus_1',plan:'pro'});const end=Math.floor(Date.now()/1000)+86400*10;
  await handleStripeEvent({type:'customer.subscription.updated',data:{object:{id:'sub_1',customer:'cus_1',status:'active',cancel_at_period_end:true,items:{data:[{price:{id:'price_max'},current_period_end:end}]}}}},ports,config);
  expect([account.plan,account.cancel_at_period_end,account.period_end]).toEqual(['max',true,new Date(end*1000).toISOString()]);
  await handleStripeEvent({type:'customer.subscription.deleted',data:{object:{id:'sub_1',customer:'cus_1',status:'canceled',items:{data:[{price:{id:'price_max'},current_period_end:Math.floor(Date.now()/1000)}]}}}},ports,config);
  expect([account.plan,account.stripe_subscription_id]).toEqual(['free',null]);expect(ended).toEqual(['user-1']);
 });
 it('sums the plan\'s and top-ups\' credits, less an overdraft, and says whether paying is set up',async()=>{
  const {ports,grants}=memory({credit_overdraft:'5'});
  grants.push({kind:'plan',plan:'free',credits:100,remaining:40,source:'free',expires_at:new Date(Date.now()+864e5).toISOString()},{kind:'topup',plan:null,credits:500,remaining:500,source:'cs',expires_at:null});
  const summary=await billingSummary('user-1',ports,config);
  expect(summary.credits).toEqual({left:535,plan:40,planTotal:100,topups:500,overdraft:5});expect(summary.payments).toBe(true);
  expect((await billingSummary('user-1',ports,undefined)).payments).toBe(false);
 });
});

import {vi} from 'vitest';
vi.mock('electron',()=>({shell:{openExternal:async()=>{}}}));
it('opens only Stripe\'s own pages from the app',async()=>{
 const {stripePage}=await import('../../apps/desktop/src/main/pay-page');
 expect(['https://checkout.stripe.com/c/pay/cs_test_1','https://billing.stripe.com/p/session/x'].map(stripePage)).toEqual([true,true]);
 expect(['http://checkout.stripe.com/x','https://checkout.stripe.com.evil.test/x','https://evil.test/?checkout.stripe.com','javascript:alert(1)','not a url'].map(stripePage)).toEqual([false,false,false,false,false]);
});

it('counts tokens by day, the busiest day, the longest task and the streaks',async()=>{
 const {tokenActivity}=await import('../../supabase/functions/dream-gateway/activity');
 const row=(turn:string,at:string,tokens:number)=>({turn_id:turn,input_tokens:tokens,output_tokens:0,cache_read_tokens:0,cache_write_tokens:0,created_at:at});
 const a=tokenActivity([row('t1','2026-10-14T10:00:00Z',100),row('t1','2026-10-14T10:30:00Z',50),row('t2','2026-10-15T09:00:00Z',300),row('t3','2026-10-16T09:00:00Z',20),row('t3','2026-10-16T09:00:05Z',5)],new Date('2026-10-17T12:00:00Z'));
 expect([a.lifetimeTokens,a.peakTokens,a.longestTaskMs,a.longestStreak,a.currentStreak,a.days.length]).toEqual([475,300,30*60_000,3,3,365]);
 expect(a.days.at(-2)).toEqual({date:'2026-10-16',tokens:25});
});

describe('plan limits',()=>{
 it('gives each plan its @ searches and style memory, and the summary carries them with this month\'s use',async()=>{
  expect(Object.fromEntries(Object.entries(PLANS).map(([id,p])=>[id,p.limits]))).toEqual({
   free:{creatorSearches:10,styleMemory:1},pro:{creatorSearches:200,styleMemory:6},
   max:{creatorSearches:1000,styleMemory:20},max20:{creatorSearches:5000,styleMemory:null}});
  const ports={account:async()=>({email:'a@b.c',plan:'pro',subscription_status:'active',period_end:null,cancel_at_period_end:false,credit_overdraft:0,stripe_customer_id:null,stripe_subscription_id:null}),grants:async()=>[],ensureFree:async()=>{},usage:async()=>({creatorSearches:12})} as unknown as BillingPorts;
  const summary:any=await billingSummary('u',ports,undefined);
  expect(summary.limits).toEqual({creatorSearches:200,styleMemory:6});expect(summary.usage).toEqual({creatorSearches:12});
  expect(summary.plans.find((p:any)=>p.id==='max20').limits.styleMemory).toBeNull();
 });
});
