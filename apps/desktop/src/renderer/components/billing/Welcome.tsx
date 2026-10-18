import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {X,Check,Coins,Route,Gauge,ArrowRight,ArrowLeft} from 'lucide-react';
import {useBilling,billingReady,credits,onPlanRise,watchBilling,type PlanRise} from '../../billing';
import {startersFor} from '../../profile';
import {shortcutHints} from '../../shortcuts';
import {GumboMark} from '../home/HomeScreen';

/** The welcome to a plan, opened when the account's plan goes up (billing.ts notices it, whether Checkout or Stripe's page
 * for changing plans paid for it). Like Claude's after a first purchase it walks through three screens: what the plan
 * gives, how to get the most from the credits, and requests to start from (one goes into the home screen's box through
 * the 'gumbo:prompt' event the app listens for). Moving up from one paid plan to a bigger one shows only the first. */
let open:PlanRise|null=null;const listeners=new Set<()=>void>();
export const openWelcome=(rise:PlanRise)=>{open=rise;listeners.forEach(l=>l());};
const close=()=>{open=null;listeners.forEach(l=>l());};
const renews=(at:string|null)=>at?new Date(at).toLocaleDateString(undefined,{month:'long',day:'numeric'}):null;

const tips:[typeof Coins,string,string][]=[
 [Route,'Let Auto pick the model','Auto sends each job to the model that does it best. For your biggest creative edits, pick Opus yourself in the menu under the box.'],
 [Coins,'Plan big edits first',`Switch the box to Plan first (${shortcutHints.mode}) and Gumbo shows you its plan to approve before it spends credits editing.`],
 [Gauge,'See where credits go','Settings › Usage shows what each day and each model used, and Plan shows when your credits renew.']
];

export function WelcomeLayer(){
 const [rise,setRise]=useState(open),[step,setStep]=useState(0),billing=useBilling(),b=billingReady(billing)?billing:null;
 useEffect(()=>{watchBilling();const update=()=>{setRise(open);setStep(0);};listeners.add(update);const off=onPlanRise(openWelcome);return()=>{listeners.delete(update);off();};},[]);
 useEffect(()=>{if(!rise)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')close();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[rise]);
 if(!rise)return null;
 const plan=b?.plans.find(p=>p.id===rise.to),name=plan?.name??'your new plan',first=rise.from==='free',last=first?2:0,date=renews(b?.renewsAt??null);
 const start=(text:string)=>{window.dispatchEvent(new CustomEvent('gumbo:prompt',{detail:text}));close();};
 return createPortal(<div className="welcome-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
  <section className="welcome-window plan-welcome" role="dialog" aria-modal="true" aria-label={`Welcome to ${name}`}>
   <button type="button" className="upgrade-close" aria-label="Close" onClick={close}><X size={18}/></button>
   {step===0&&<>
    <header><span className="plan-welcome-badge"><GumboMark/></span><span className="plan-welcome-plan">{name}</span>
     <h2>{first?`Welcome to Gumbo ${name}`:`You’re on ${name} now`}</h2>
     <p>{first?'Thanks for subscribing. Here’s what’s yours now.':'Your plan changed right away, and this month’s credits moved up with it.'}</p></header>
    <ul className="plan-welcome-gives">
     {plan&&<li><Check size={16}/><div><b>{credits(plan.credits)} credits every month</b><span>{date?`Your next ones arrive ${date}.`:'They renew each month.'}{b&&` ${credits(b.credits.left)} ready now.`}</span></div></li>}
     <li><Check size={16}/><div><b>Extra credits any time</b><span>{b?`${credits(b.topup.credits)} for $${b.topup.priceUsd}, if a month runs short. They never expire.`:'If a month runs short. They never expire.'}</span></div></li>
     <li><Check size={16}/><div><b>Change or cancel any time</b><span>In Settings › Plan, with your receipts and card.</span></div></li>
    </ul>
   </>}
   {step===1&&<>
    <header><h2>Get the most from your credits</h2><p>Three habits that make every edit go further.</p></header>
    <ol className="welcome-steps">{tips.map(([Icon,title,text])=><li key={title}><span className="welcome-step-icon"><Icon size={17}/></span><div><b>{title}</b><p>{text}</p></div></li>)}</ol>
   </>}
   {step===2&&<>
    <header><h2>Start your first {name} edit</h2><p>Pick one to begin; add your clips and send it.</p></header>
    <div className="welcome-prompts">{startersFor().map(([Icon,title,text])=><button key={title} type="button" onClick={()=>start(text)}><b><Icon size={14}/>{title}</b><span>{text}</span><ArrowRight size={14}/></button>)}</div>
   </>}
   <footer>
    {first&&<span className="welcome-dots" aria-hidden="true">{[0,1,2].map(i=><i key={i} className={i===step?'on':''}/>)}</span>}
    {step>0&&<button type="button" className="onboarding-back" onClick={()=>setStep(step-1)}><ArrowLeft size={15}/>Back</button>}
    <button type="button" className="onboarding-primary" onClick={()=>step<last?setStep(step+1):close()}>{step<last?'Continue':'Start creating'}</button>
   </footer>
  </section>
 </div>,document.body);
}
