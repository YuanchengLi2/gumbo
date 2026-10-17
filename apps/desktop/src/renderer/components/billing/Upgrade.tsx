import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {X,Check,Sparkles,Plus} from 'lucide-react';
import type {PlanId} from '@dream/contracts';
import {useBilling,billingReady,choosePlan,buyCredits,credits} from '../../billing';
import {useAccount} from '../../account';

/** Whether the upgrade window is open, for the whole app (the home sidebar, the profile menu and the editor all open it).
 * 'out' opens it because a request found no credits left: it says so and offers buying credits first. */
let open:null|'upgrade'|'out'=null;const listeners=new Set<()=>void>();
export const openUpgrade=(why:'upgrade'|'out'='upgrade')=>{open=why;listeners.forEach(l=>l());};
const close=()=>{open=null;listeners.forEach(l=>l());};
const order:PlanId[]=['free','pro','max','max20'];
const unwrap=(e:unknown)=>(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
/** The plans Gumbo sells, what each gives, and the top plan: Upgrade is offered only below it. */
export const topPlan=(plan:PlanId)=>plan==='max20';
const blurbs:Record<PlanId,string>={free:'To try Gumbo',pro:'For regular videos',max:'5x Pro, for weekly creators',max20:'20x Pro, for studios'};

/** Opening Checkout in the browser, with what happened (or why not) for the button's place. */
function usePay(){
 const [opened,setOpened]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
 const pay=async(key:string,go:()=>Promise<unknown>)=>{setError(null);setOpened(key);try{await go();}catch(e){setOpened(null);setError(unwrap(e));}};
 return{opened,error,pay};
}

/** The upgrade window: the paid plans side by side (the current one marked), and credits to buy. Paying is on Stripe's
 * page in the browser; this closes on its own once a request that ran out finds credits again. */
export function UpgradeLayer(){
 const [why,setWhy]=useState(open),billing=useBilling(),b=billingReady(billing)?billing:null,{opened,error,pay}=usePay();
 useEffect(()=>{const update=()=>setWhy(open);listeners.add(update);return()=>{listeners.delete(update);};},[]);
 useEffect(()=>{if(!why)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')close();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[why]);
 useEffect(()=>{if(why==='out'&&b&&b.credits.left>0&&opened)close();},[why,b,opened]);
 if(!why)return null;
 const out=why==='out'||(!!b&&b.credits.left<=0);
 return createPortal(<div className="upgrade-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
  <section className="upgrade-window" role="dialog" aria-modal="true" aria-label={out?'Out of credits':'Upgrade your plan'}>
   <button type="button" className="upgrade-close" aria-label="Close" onClick={close}><X size={18}/></button>
   <header><h2>{out?'You’re out of credits':'Upgrade your plan'}</h2><p>{out?'Top up or move to a bigger plan to keep editing. Your edit is saved and waiting.':'More credits every month for more videos. Change or cancel any time.'}</p></header>
   {!b?<p className="upgrade-loading">Loading plans…</p>:<>
    <div className="upgrade-plans">{b.plans.filter(p=>p.id!=='free').map(plan=>{const current=plan.id===b.plan,up=order.indexOf(plan.id)>order.indexOf(b.plan);
     return <div key={plan.id} className={'upgrade-plan'+(current?' current':'')+(plan.id==='max'?' featured':'')}>
      {plan.id==='max'&&!current&&<span className="upgrade-tag">Most popular</span>}
      <strong>{plan.name}</strong><small>{blurbs[plan.id]}</small>
      <div className="upgrade-price">${plan.priceUsd}<span>/month</span></div>
      <ul><li><Check size={14}/>{credits(plan.credits)} credits a month</li><li><Check size={14}/>Renews every month</li><li><Check size={14}/>Buy extra credits any time</li></ul>
      {current?<span className="upgrade-current">Your plan</span>:
       <button type="button" className={up?'upgrade-primary':'upgrade-secondary'} disabled={!b.payments} onClick={()=>void pay(plan.id,()=>choosePlan(plan.id as 'pro'|'max'|'max20'))}>{opened===plan.id?'Opened in your browser':b.plan==='free'?`Get ${plan.name}`:up?`Upgrade to ${plan.name}`:`Switch to ${plan.name}`}</button>}
     </div>;})}</div>
    <div className={'upgrade-topup'+(out?' first':'')}>
     <div><strong>Just need a few more?</strong><span>{credits(b.topup.credits)} credits for ${b.topup.priceUsd}. They never expire.</span></div>
     <button type="button" className={out?'upgrade-primary':'upgrade-secondary'} disabled={!b.payments} onClick={()=>void pay('credits',()=>buyCredits(1))}><Plus size={15}/>{opened==='credits'?'Opened in your browser':`Buy ${credits(b.topup.credits)} credits`}</button>
    </div>
    {error&&<p className="upgrade-error" role="alert">{error}</p>}
    {opened&&<p className="upgrade-note">Finish on Stripe's page in your browser, then come back: your credits show here in a few seconds.</p>}
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
