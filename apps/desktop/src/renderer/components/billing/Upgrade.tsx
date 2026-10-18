import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {X,Check,Sparkles,Plus} from 'lucide-react';
import type {BillingSummary,PlanId} from '@dream/contracts';
import {useBilling,billingReady,choosePlan,buyCredits,credits,planOrder} from '../../billing';
import {useAccount} from '../../account';

/** Whether the upgrade window is open, for the whole app (the home sidebar, the profile menu and the editor all open it).
 * 'out' opens it because a request found no credits left: it says so and offers buying credits first. */
let open:null|'upgrade'|'out'=null;const listeners=new Set<()=>void>();
export const openUpgrade=(why:'upgrade'|'out'='upgrade')=>{open=why;listeners.forEach(l=>l());};
const close=()=>{open=null;listeners.forEach(l=>l());};
const unwrap=(e:unknown)=>(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
/** The plans Gumbo sells, what each gives, and the top plan: Upgrade is offered only below it. */
export const topPlan=(plan:PlanId)=>plan==='max20';
const blurbs:Record<'free'|'pro'|'max',string>={free:'To try Gumbo',pro:'For regular videos',max:'For weekly creators and studios'};

/** Opening Checkout in the browser, with what happened (or why not) for the button's place. */
export function usePay(){
 const [opened,setOpened]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
 const pay=async(key:string,go:()=>Promise<unknown>)=>{setError(null);setOpened(key);try{await go();}catch(e){setOpened(null);setError(unwrap(e));}};
 return{opened,error,pay};
}

/** The plans side by side, as Claude shows them: Free (while it is yours), Pro, and Max with its two sizes on a switch in
 * its card. The current plan is marked; another starts Checkout, or from a paid plan Stripe's page confirming the change,
 * which starts right away and charges only the difference for the rest of the month (billing.ts in the gateway). The
 * onboarding gives Free a button of its own to carry on with. */
export function PlanChooser(p:{b:BillingSummary;opened:string|null;pay:(key:string,go:()=>Promise<unknown>)=>void;free?:{label:string;onClick:()=>void}}){
 const {b}=p,[size,setSize]=useState<'max'|'max20'>(b.plan==='max20'?'max20':'max');
 const find=(id:PlanId)=>b.plans.find(x=>x.id===id),free=find('free'),pro=find('pro');
 const cards=[...(b.plan==='free'?['free' as const]:[]),'pro' as const,size].map(find).filter(Boolean) as BillingSummary['plans'];
 return <>
  <div className="upgrade-plans" style={{'--plan-count':cards.length} as React.CSSProperties}>{cards.map(plan=>{
   const kind=plan.id==='max20'?'max':plan.id as 'free'|'pro'|'max',current=plan.id===b.plan,up=planOrder.indexOf(plan.id)>planOrder.indexOf(b.plan);
   const times=kind==='pro'&&free?.credits?`${Math.round(plan.credits/free.credits)}x the credits of Free`:kind==='max'&&pro?.credits?`${Math.round(plan.credits/pro.credits)}x the credits of Pro`:'Unlimited editing by hand';
   return <div key={kind} className={'upgrade-plan'+(current?' current':'')+(kind==='max'?' featured':'')}>
    {kind==='max'&&!current&&<span className="upgrade-tag">Most popular</span>}
    <div className="upgrade-plan-head"><strong>{kind==='max'?'Max':plan.name}</strong>
     {kind==='max'&&<div className="upgrade-size" role="radiogroup" aria-label="Max size">{(['max','max20'] as const).map(id=><button key={id} type="button" role="radio" aria-checked={size===id} onClick={()=>setSize(id)}>{id==='max'?'5x':'20x'}</button>)}</div>}</div>
    <small>{blurbs[kind]}</small>
    <div className="upgrade-price">${plan.priceUsd}<span>/month</span></div>
    <ul><li><Check size={14}/>{credits(plan.credits)} credits every month</li><li><Check size={14}/>{times}</li>
     {kind!=='free'&&<><li><Check size={14}/>Extra credits any time</li><li><Check size={14}/>Change or cancel any time</li></>}</ul>
    {kind==='free'?(p.free?<button type="button" className="upgrade-secondary" onClick={p.free.onClick}>{p.free.label}</button>:<span className="upgrade-current">Your plan</span>)
     :current?<span className="upgrade-current">Your plan</span>
     :<button type="button" className={up?'upgrade-primary':'upgrade-secondary'} disabled={!b.payments} onClick={()=>void p.pay(plan.id,()=>choosePlan(plan.id as 'pro'|'max'|'max20'))}>{p.opened===plan.id?'Finish on Stripe’s page':b.plan==='free'?`Get ${plan.name}`:up?`Upgrade to ${plan.name}`:`Switch to ${plan.name}`}</button>}
   </div>;})}</div>
  {b.plan!=='free'&&<p className="upgrade-note">A new plan starts right away: Stripe charges only the difference for the rest of this month, and your credits move to the new plan.</p>}
 </>;
}

/** The upgrade window: the plans side by side (the current one marked), and credits to buy. Paying is on Stripe's page in
 * a window over Gumbo; this closes on its own once the plan goes up (the welcome to it opens) or, when a request ran out,
 * once credits are back. */
export function UpgradeLayer(){
 const [why,setWhy]=useState(open),billing=useBilling(),b=billingReady(billing)?billing:null,{opened,error,pay}=usePay();
 useEffect(()=>{const update=()=>setWhy(open);listeners.add(update);return()=>{listeners.delete(update);};},[]);
 useEffect(()=>{if(!why)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')close();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[why]);
 useEffect(()=>{if(why==='out'&&b&&b.credits.left>0&&opened)close();},[why,b,opened]);
 const plan=b?.plan;useEffect(()=>{if(why&&opened&&plan&&plan===opened)close();},[why,opened,plan]);
 if(!why)return null;
 const out=why==='out'||(!!b&&b.credits.left<=0);
 return createPortal(<div className="upgrade-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
  <section className="upgrade-window" role="dialog" aria-modal="true" aria-label={out?'Out of credits':'Upgrade your plan'}>
   <button type="button" className="upgrade-close" aria-label="Close" onClick={close}><X size={18}/></button>
   <header><h2>{out?'You’re out of credits':b?.plan==='free'?'Choose your plan':'Upgrade your plan'}</h2><p>{out?'Top up or move to a bigger plan to keep editing. Your edit is saved and waiting.':'More credits every month for more videos. Change or cancel any time.'}</p></header>
   {!b?<p className="upgrade-loading">Loading plans…</p>:<>
    <PlanChooser b={b} opened={opened} pay={pay}/>
    <div className={'upgrade-topup'+(out?' first':'')}>
     <div><strong>Just need a few more?</strong><span>{credits(b.topup.credits)} credits for ${b.topup.priceUsd}. They never expire.</span></div>
     <button type="button" className={out?'upgrade-primary':'upgrade-secondary'} disabled={!b.payments} onClick={()=>void pay('credits',()=>buyCredits(1))}><Plus size={15}/>{opened==='credits'?'Finish on Stripe’s page':`Buy ${credits(b.topup.credits)} credits`}</button>
    </div>
    {error&&<p className="upgrade-error" role="alert">{error}</p>}
    {opened&&<p className="upgrade-note">Finish on Stripe's page, then come back: your plan and credits show here in a few seconds.</p>}
    {!b.payments&&<p className="upgrade-note">Paying isn't set up on your Gumbo service yet.</p>}
   </>}
  </section>
 </div>,document.body);
}

/** The home sidebar's foot, above you: Upgrade plan (below the top plan), or Buy credits once they've run out. */
export function SidebarUpgrade(){
 const account=useAccount(),billing=useBilling(),b=billingReady(billing)?billing:null,{opened,pay}=usePay();
 if(!account?.signedIn||!b)return null;
 if(b.credits.left<=0)return <div className="side-upgrade out"><span>You're out of credits</span>
  <button type="button" className="side-buy" disabled={!b.payments} onClick={()=>void pay('credits',()=>buyCredits(1))}><Plus size={15}/>{opened?'Opened in your browser':'Buy credits'}</button>
  {!topPlan(b.plan)&&<button type="button" className="side-link" onClick={()=>openUpgrade('out')}>or upgrade your plan</button>}</div>;
 if(topPlan(b.plan))return null;
 return <button type="button" className="side-upgrade-button" onClick={()=>openUpgrade()}><Sparkles size={15}/>Upgrade plan</button>;
}

/** Over the editor's chat box once credits run out: top up or upgrade, without waiting for a request to fail. */
export function OutOfCredits(){
 const billing=useBilling(),b=billingReady(billing)?billing:null,{opened,pay}=usePay();
 if(!b||b.credits.left>0)return null;
 return <div className="out-of-credits" role="status"><span><strong>You're out of credits.</strong> Top up or upgrade to keep editing.</span>
  <button type="button" className="out-buy" disabled={!b.payments} onClick={()=>void pay('credits',()=>buyCredits(1))}>{opened?'Opened in browser':`Buy ${credits(b.topup.credits)} · $${b.topup.priceUsd}`}</button>
  {!topPlan(b.plan)&&<button type="button" className="out-upgrade" onClick={()=>openUpgrade('out')}>Upgrade</button>}</div>;
}
