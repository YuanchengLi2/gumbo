import React,{useEffect,useState} from 'react';
import {Plus,Check,ArrowRight} from 'lucide-react';
import type {UsageSummary,PlanId} from '@dream/contracts';
import {requireSignIn} from '../../account';
import {useBilling,billingReady,buyCredits,manageBilling,choosePlan,cancelPlan,credits} from '../../billing';

const dollars=(n:number)=>`$${n%1?n.toFixed(2):n}`,day=(iso:string)=>new Date(iso).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const unwrap=(e:unknown)=>(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
const order:PlanId[]=['free','pro','max','max20'];
const blurbs:Record<PlanId,string>={free:'To try Gumbo',pro:'For regular videos',max:'5x Pro, for weekly creators',max20:'20x Pro, for studios'};

/** Opens a Stripe page in its window over Gumbo, keeping its error for the page to show. */
function usePay(){
 const [error,setError]=useState<string|null>(null);
 return{error,pay:async(go:()=>Promise<unknown>)=>{setError(null);try{await go();}catch(e){setError(unwrap(e));}}};
}
function SignedOut(p:{what:string}){return <div className="billing-empty"><p>Sign in to see your {p.what}.</p><button type="button" className="settings-button-primary" onClick={()=>void requireSignIn()}>Sign in</button></div>;}

/** Settings > Usage: the credits left with what they're made of, what was used (today, the last 30 days, each day), and
 * topping up. Changing plan is its own page (Plan). */
export function UsagePage(p:{onPlans:()=>void}){
 const billing=useBilling(),b=billingReady(billing)?billing:null,{error,pay}=usePay();
 const [usage,setUsage]=useState<UsageSummary|{unavailable:true}|null|undefined>(undefined);
 useEffect(()=>{window.dream.command<UsageSummary|{unavailable:true}|null>({type:'account',action:'usage'}).then(setUsage,()=>setUsage({unavailable:true}));},[]);
 const u=usage&&!('unavailable' in usage)?usage:null;
 if(billing===null)return <SignedOut what="credits and usage"/>;
 if(billing&&'unavailable' in billing)return <p className="settings-note">Your Gumbo service needs its latest update to show credits here.</p>;
 if(!b)return <p className="settings-note">Loading…</p>;
 const used=Math.max(0,b.credits.planTotal-b.credits.plan),share=b.credits.planTotal>0?Math.min(1,used/b.credits.planTotal):1,peak=Math.max(1,...(u?.days??[]).map(d=>d.credits));
 return <div className="billing-stack">
  <section className="billing-card">
   <header><h3>Credits</h3><button type="button" className="billing-link" onClick={p.onPlans}>{b.planName} plan<ArrowRight size={13}/></button></header>
   <div className="credits-hero"><strong>{credits(b.credits.left)}</strong><span>credits left</span></div>
   <div className="credit-lines">
    <div className="credit-line"><div><span>Plan credits</span><small>{b.renewsAt?`${b.cancelAtPeriodEnd?'Ends':'Resets'} ${day(b.renewsAt)}`:'Monthly'}</small></div>
     <div className="credit-bar" role="meter" aria-label="Plan credits used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(share*100)}><i className={share>=.9?'high':undefined} style={{width:`${Math.floor(share*100)}%`}}/></div>
     <div className="credit-figure"><b>{Math.floor(share*100)}% used</b><span>{credits(used)} / {credits(b.credits.planTotal)}</span></div></div>
    <div className="credit-line"><div><span>Bought credits</span><small>Never expire</small></div><div/><div className="credit-figure"><span>{credits(b.credits.topups)} left</span></div></div>
    {b.credits.overdraft>0&&<div className="credit-line"><div><span>Over</span><small>Taken from your next credits</small></div><div/><div className="credit-figure"><span>{credits(b.credits.overdraft)}</span></div></div>}
   </div>
  </section>
  <section className="billing-card">
   <header><h3>Usage</h3>{u&&<small>{u.requests} AI calls in 30 days</small>}</header>
   {usage===undefined?<p className="settings-note">Loading…</p>:!u?<p className="settings-note">Usage isn't available yet.</p>:<>
    <div className="usage-tiles"><div><strong>{credits(u.todayCredits)}</strong><span>Today</span></div><div><strong>{credits(u.days.slice(-7).reduce((n,d)=>n+d.credits,0))}</strong><span>Last 7 days</span></div><div><strong>{credits(u.monthCredits)}</strong><span>Last 30 days</span></div></div>
    <div className="usage-days" role="img" aria-label="Credits used each day over the last 30 days">{u.days.map(d=><i key={d.date} title={`${day(d.date+'T12:00:00Z')}: ${credits(d.credits)} credits`} style={{height:`${Math.max(d.credits>0?5:2,Math.round(d.credits/peak*100))}%`}}/>)}</div>
    <div className="usage-axis"><span>{day(u.days[0].date+'T12:00:00Z')}</span><span>Today</span></div>
   </>}
  </section>
  <section className="billing-card topup-card">
   <div><h3>Need more credits?</h3><p>{credits(b.topup.credits)} credits for {dollars(b.topup.priceUsd)}. They never expire and are used after your plan's.</p></div>
   <button type="button" className="settings-button-primary" disabled={!b.payments} onClick={()=>void pay(()=>buyCredits(1))}><Plus size={15}/>Buy credits</button>
  </section>
  {error&&<p className="settings-error" role="alert">{error}</p>}
  {!b.payments&&<p className="settings-note">Paying isn't set up on your Gumbo service yet.</p>}
  <p className="settings-note">One credit is one cent of AI. A small change uses a few; a whole video usually 100 to 300.</p>
 </div>;
}

/** Settings > Plan: the plan you're on (price, credits, when it renews or ends, managing billing, cancelling) and every plan
 * to move to, up or down. Paid changes are confirmed on Stripe's page and prorated; choosing Free cancels at the period's end. */
export function PlanPage(){
 const billing=useBilling(),b=billingReady(billing)?billing:null,{error,pay}=usePay();
 if(billing===null)return <SignedOut what="plan"/>;
 if(billing&&'unavailable' in billing)return <p className="settings-note">Your Gumbo service needs its latest update to show plans here.</p>;
 if(!b)return <p className="settings-note">Loading…</p>;
 const current=b.plans.find(x=>x.id===b.plan)!,paid=b.plan!=='free',ending=b.cancelAtPeriodEnd;
 return <div className="billing-stack">
  <section className="billing-card plan-current">
   <div className="plan-current-main">
    <span className="plan-eyebrow">Your plan</span>
    <h3>{current.name}</h3>
    <p>{paid?`${dollars(current.priceUsd)} a month · ${credits(current.credits)} credits each month`:`${credits(current.credits)} credits each month, free`}</p>
    {b.renewsAt&&<p className={'plan-renew'+(ending?' ending':'')}>{ending?`Ends ${day(b.renewsAt)}. You keep your credits until then.`:paid?`Renews ${day(b.renewsAt)}`:`New credits ${day(b.renewsAt)}`}</p>}
   </div>
   <div className="plan-current-actions">
    {b.portal&&<button type="button" className="settings-button-secondary" onClick={()=>void pay(manageBilling)}>{ending?'Resume plan':'Manage billing'}</button>}
    {paid&&!ending&&<button type="button" className="plan-cancel" onClick={()=>void pay(cancelPlan)}>Cancel plan</button>}
   </div>
  </section>
  <h3 className="billing-heading">Change plan</h3>
  <div className="plan-grid">{b.plans.map(plan=>{const here=plan.id===b.plan,up=order.indexOf(plan.id)>order.indexOf(b.plan);
   return <div key={plan.id} className={'plan-option'+(here?' current':'')}>
    <div className="plan-option-head"><strong>{plan.name}</strong>{here&&<span className="plan-badge">Current</span>}</div>
    <small>{blurbs[plan.id]}</small>
    <div className="plan-option-price">{plan.priceUsd?<>{dollars(plan.priceUsd)}<span>/month</span></>:'Free'}</div>
    <ul><li><Check size={13}/>{credits(plan.credits)} credits a month</li>{plan.id!=='free'&&<li><Check size={13}/>Buy extra credits any time</li>}</ul>
    {here?<span className="plan-option-current">Your plan</span>
     :plan.id==='free'?<button type="button" className="settings-button-secondary" disabled={!paid||ending} onClick={()=>void pay(cancelPlan)}>{ending?'At period end':'Downgrade'}</button>
     :<button type="button" className={up?'settings-button-primary':'settings-button-secondary'} disabled={!b.payments} onClick={()=>void pay(()=>choosePlan(plan.id as 'pro'|'max'|'max20'))}>{b.plan==='free'?`Get ${plan.name}`:up?'Upgrade':'Downgrade'}</button>}
   </div>;})}</div>
  {error&&<p className="settings-error" role="alert">{error}</p>}
  <p className="settings-note">Changes between paid plans are prorated: you pay or are credited the difference for the rest of the month, and get that share of the new plan's credits. Cancelling keeps your plan until the end of the period you paid for.</p>
 </div>;
}
