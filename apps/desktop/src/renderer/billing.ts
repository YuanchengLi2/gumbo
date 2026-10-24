import {useEffect,useState} from 'react';
import type {BillingSummary,PlanId} from '@dream/contracts';
import {accountNow,refreshAccount} from './account';

/** The plan and credits, for the profile menu and Settings > Usage and billing: asked of the gateway when something shows
 * it, again when the window comes back to the front (paying happens in the browser, so that is when a new plan or credits
 * arrive), and after Gumbo AI finishes a request. undefined while loading; null when signed out; unavailable when the
 * gateway is older than billing. */
export type Billing=BillingSummary|{unavailable:true}|null|undefined;
let current:Billing,loading:Promise<void>|undefined;const listeners=new Set<()=>void>();
const notify=()=>listeners.forEach(l=>l());
export function refreshBilling(){
 loading??=window.dream.command<Billing>({type:'account',action:'billing'}).then(async b=>{current=b;if(billingReady(b))await noticePlan(b);},()=>{current=current??{unavailable:true};}).finally(()=>{loading=undefined;notify();});
 return loading;
}

/** A plan that went up since this computer last saw the account's: Free to a paid plan, or to a bigger one. The welcome to
 * the plan (components/billing/Welcome) opens on it, whether Checkout or the portal paid for it. The first plan seen for an
 * account is only remembered: an account that was already on Pro is not welcomed to it again. */
export const planOrder:PlanId[]=['free','pro','max','max20'];
export type PlanRise={from:PlanId;to:PlanId};
const rises=new Set<(rise:PlanRise)=>void>();
export function onPlanRise(listener:(rise:PlanRise)=>void){rises.add(listener);return()=>{rises.delete(listener);};}
async function noticePlan(b:BillingSummary){
 // Billing can answer before the account does after a sign-in, while the account here still says signed out.
 const known=accountNow(),email=(known?.signedIn?known:await refreshAccount()).email;if(!email)return;
 const key='gumbo-plan:'+email.toLowerCase();let before:PlanId|null=null;try{before=localStorage.getItem(key) as PlanId|null;localStorage.setItem(key,b.plan);}catch{}
 if(before&&planOrder.includes(before)&&planOrder.indexOf(b.plan)>planOrder.indexOf(before))rises.forEach(l=>l({from:before!,to:b.plan}));
}
/** After Stripe's window closes the plan changes when Stripe's webhook reaches the gateway, a few seconds later: the plan is
 * asked for every two seconds until it changes, for half a minute at most. */
function watchPlan(){
 const start=billingReady(current)?current.plan:undefined;let tries=0;
 const tick=()=>void refreshBilling().then(()=>{if((billingReady(current)?current.plan:undefined)===start&&++tries<15)setTimeout(tick,2000);});
 tick();
}
let wired=false;
function wire(){
 if(wired)return;wired=true;
 window.addEventListener('focus',()=>{if(listeners.size)void refreshBilling();});
 window.dream.onEvent(raw=>{const event=raw as {type?:string;payload?:{status?:string}};
  if(event.type==='billing.returned'&&['subscribed','portal','closed'].includes(event.payload?.status??''))watchPlan();
  else if(event.type==='account.signed_in'||event.type==='app.link'||event.type==='billing.returned'||event.type==='ai.status'&&event.payload?.status!=='running')void refreshBilling();});
}
/** The billing events reach the app before anything shows the plan (the onboarding's last step, a welcome waiting for it). */
export function watchBilling(){wire();}
export function useBilling(){
 const [value,setValue]=useState(current);
 useEffect(()=>{wire();const update=()=>setValue(current);listeners.add(update);void refreshBilling();return()=>{listeners.delete(update);};},[]);
 return value;
}
export const billingReady=(b:Billing):b is BillingSummary=>!!b&&!('unavailable' in b);
/** Whether plans and credits can be bought: Stripe is set up and paying has been opened. Until then they show as coming soon. */
export const payingOpen=(b:BillingSummary)=>b.payments&&b.paymentsOpen===true;
/** Opens Stripe in the browser: Checkout for a plan or packs of credits, or the portal to manage the plan. */
export const choosePlan=(plan:'pro'|'max'|'max20')=>window.dream.command({type:'account',action:'checkout',plan});
export const buyCredits=(packs=1)=>window.dream.command({type:'account',action:'checkout',packs});
export const manageBilling=()=>window.dream.command({type:'account',action:'portal'});
/** Stripe's step to cancel the plan at the end of the period (choosing Free). */
export const cancelPlan=()=>window.dream.command({type:'account',action:'portal',flow:'cancel'});
export const credits=(n:number)=>Math.max(0,Math.floor(n)).toLocaleString();
