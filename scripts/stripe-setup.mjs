#!/usr/bin/env node
/** Sets up Gumbo's billing in a Stripe account, in test mode unless --live is given, and prints the gateway secrets.
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
 *
 * It makes (or finds again, so it can be run more than once):
 * - the plans, monthly: Pro $30, Max $100, Max 20x $200, and the credits pack, $10 for 500 credits. Prices are found by
 *   their lookup key (gumbo_pro_monthly, gumbo_max_monthly, gumbo_max20_monthly, gumbo_credits_500);
 * - the customer portal: switch between the plans (prorated and invoiced at once, which grants the new plan's share of
 *   credits), cancel at the end of the period, invoices and the card;
 * - the webhook to the gateway's /stripe-webhook, with the events billing.ts handles. Its signing secret is shown only
 *   when it is made; to see it again, roll it in Stripe's dashboard or delete the endpoint and run this again.
 * The numbers match supabase/functions/dream-gateway/billing.ts. */
const key=process.env.STRIPE_SECRET_KEY,live=process.argv.includes('--live');
const gateway=(process.env.SUPABASE_URL||'https://qewguvfkkwvdoqptiljd.supabase.co').replace(/\/$/,'')+'/functions/v1/dream-gateway';
if(!key){console.error('Set STRIPE_SECRET_KEY to your Stripe secret key (sk_test_... for test mode).');process.exit(1);}
if(key.startsWith('sk_live_')&&!live){console.error('That is a live key: real cards would be charged. Use a test key, or pass --live if you mean it.');process.exit(1);}

const form=(params,prefix='',out=new URLSearchParams())=>{for(const [k,v] of Object.entries(params)){const name=prefix?`${prefix}[${k}]`:k;if(v===undefined)continue;if(Array.isArray(v))v.forEach((x,i)=>typeof x==='object'?form(x,`${name}[${i}]`,out):out.append(`${name}[${i}]`,String(x)));else if(typeof v==='object')form(v,name,out);else out.append(name,String(v));}return out;};
async function stripe(path,params,method=params?'POST':'GET'){
 const response=await fetch('https://api.stripe.com/v1/'+path,{method,headers:{Authorization:'Bearer '+key,...(params?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:params?form(params):undefined});
 const body=await response.json();if(!response.ok)throw new Error(`${path}: ${body.error?.message??response.status}`);return body;
}

const items=[
 {id:'pro',name:'Gumbo Pro',lookup:'gumbo_pro_monthly',cents:3000,recurring:true,description:'900 credits a month for Gumbo AI'},
 {id:'max',name:'Gumbo Max',lookup:'gumbo_max_monthly',cents:10000,recurring:true,description:'4,500 credits a month for Gumbo AI (5x Pro)'},
 {id:'max20',name:'Gumbo Max 20x',lookup:'gumbo_max20_monthly',cents:20000,recurring:true,description:'18,000 credits a month for Gumbo AI (20x Pro)'},
 {id:'topup',name:'Gumbo credits',lookup:'gumbo_credits_500',cents:1000,recurring:false,description:'500 credits for Gumbo AI, which do not expire'}
];
const prices={},products={};
for(const item of items){
 const found=(await stripe('prices?'+new URLSearchParams({'lookup_keys[]':item.lookup,active:'true'}))).data[0];
 if(found){prices[item.id]=found.id;products[item.id]=found.product;console.log(`${item.name}: ${found.id} (already there)`);continue;}
 const product=await stripe('products',{name:item.name,description:item.description,metadata:{gumbo:item.id}});
 const price=await stripe('prices',{product:product.id,currency:'usd',unit_amount:item.cents,lookup_key:item.lookup,...(item.recurring?{recurring:{interval:'month'}}:{}),metadata:{gumbo:item.id}});
 prices[item.id]=price.id;products[item.id]=product.id;console.log(`${item.name}: ${price.id}`);
}

const portal={business_profile:{headline:'Gumbo: manage your plan'},default_return_url:'https://usegumbo.app/billing/?status=portal',
 features:{customer_update:{enabled:true,allowed_updates:['email','address']},invoice_history:{enabled:true},payment_method_update:{enabled:true},
  subscription_cancel:{enabled:true,mode:'at_period_end',cancellation_reason:{enabled:true,options:['too_expensive','missing_features','unused','other']}},
  subscription_update:{enabled:true,default_allowed_updates:['price'],proration_behavior:'always_invoice',products:['pro','max','max20'].map(id=>({product:products[id],prices:[prices[id]]}))}}};
const existingPortal=(await stripe('billing_portal/configurations?is_default=true&limit=1')).data[0];
if(existingPortal){await stripe('billing_portal/configurations/'+existingPortal.id,portal);console.log('Customer portal: updated');}
else{await stripe('billing_portal/configurations',portal);console.log('Customer portal: made');}

const events=['checkout.session.completed','checkout.session.async_payment_succeeded','invoice.paid','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'];
const url=gateway+'/stripe-webhook',hooks=(await stripe('webhook_endpoints?limit=100')).data,hook=hooks.find(h=>h.url===url);
let secret;
if(hook){await stripe('webhook_endpoints/'+hook.id,{enabled_events:events});console.log(`Webhook: ${url} (already there; its secret is in Stripe's dashboard)`);}
else{const made=await stripe('webhook_endpoints',{url,enabled_events:events,description:'Gumbo gateway: credits and plans'});secret=made.secret;console.log(`Webhook: ${url}`);}

// With --write <file>, the gateway's secrets go to that file (for `supabase secrets set --env-file <file>`), so neither
// key is printed; otherwise the command to set them is printed.
const out=process.argv[process.argv.indexOf('--write')+1];
if(process.argv.includes('--write')&&out){
 const {writeFileSync,readFileSync,existsSync}=await import('node:fs');
 // A webhook made earlier keeps the signing secret written then (Stripe shows it only once).
 const kept=existsSync(out)?readFileSync(out,'utf8').match(/^STRIPE_WEBHOOK_SECRET=(.+)$/m)?.[1]:undefined,hookSecret=secret??kept;
 writeFileSync(out,[`STRIPE_SECRET_KEY=${key}`,`STRIPE_PRICE_PRO=${prices.pro}`,`STRIPE_PRICE_MAX=${prices.max}`,`STRIPE_PRICE_MAX20=${prices.max20}`,`STRIPE_PRICE_TOPUP=${prices.topup}`,...(hookSecret?[`STRIPE_WEBHOOK_SECRET=${hookSecret}`]:[])].join('\n')+'\n');
 console.log(`\nGateway secrets written to ${out} (${live?'LIVE':'test mode'})${hookSecret?'':'; the webhook signing secret is missing: roll it in Stripe and add STRIPE_WEBHOOK_SECRET'}.`);
}else{
 console.log(`\nSet these on the gateway (${live?'LIVE':'test mode'}):\n`);
 console.log(`supabase secrets set STRIPE_SECRET_KEY=<the key you used> STRIPE_PRICE_PRO=${prices.pro} STRIPE_PRICE_MAX=${prices.max} STRIPE_PRICE_MAX20=${prices.max20} STRIPE_PRICE_TOPUP=${prices.topup}${secret?` STRIPE_WEBHOOK_SECRET=${secret}`:''}`);
}
