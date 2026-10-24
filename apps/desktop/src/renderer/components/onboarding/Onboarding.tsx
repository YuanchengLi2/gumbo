import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,ArrowRight,ExternalLink,Check,Sparkles} from 'lucide-react';
import type {OnboardingAnswers} from '@dream/contracts';
import {GumboMark} from '../home/HomeScreen';
import {useAccount,signInFinished} from '../../account';
import {useBilling,billingReady,onPlanRise,watchBilling} from '../../billing';
import {PlanChooser,usePay} from '../billing/Upgrade';
import {firstAsk,forgetFirstAsk,deliverFirstAsk} from '../../first-ask';
import {onWeb} from '../../platform';
import {onboarded,markOnboarded,saveAnswers,sendAnswers,accountAnswers,restoreAnswers,makes,experiences,sources,startersFor,type MakeId} from '../../profile';

/** The first time Gumbo opens on a computer, a few screens before home, as Claude's onboarding has them: a welcome, the
 * account (signing in, or skipping it: editing by hand needs none), what to call you, what you make, how much you have
 * edited, how you found Gumbo, the plans (Free to carry on with), and requests to start from, fitted to the answers. The
 * answers go to Settings > Profile, which the agent reads with every request, and to the account (profile.ts). An account
 * that answered on another computer skips the questions. A test run never sees it unless it asks (RuntimeStatus). */
type Step='welcome'|'account'|'name'|'makes'|'experience'|'heard'|'improve'|'plan'|'ready';
const progress:Step[]=['name','makes','experience','heard','improve','plan'];

export function OnboardingLayer(){
 const [step,setStep]=useState<Step|null>(null),[answers,setAnswers]=useState<OnboardingAnswers>({name:'',makes:[]}),[returning,setReturning]=useState(false);
 const account=useAccount(),signedIn=!!account?.signedIn,billing=useBilling(),b=billingReady(billing)?billing:null,{opened,error:payError,pay}=usePay();
 const [signInUrl,setSignInUrl]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 // A request typed on usegumbo.app before Gumbo opened waits in the home screen's box once this ends (first-ask.ts).
 const finish=()=>{markOnboarded();setStep(null);deliverFirstAsk();};
 useEffect(()=>{watchBilling();void sendAnswers();void window.dream.runtime().then(r=>{if(r.onboarding||!r.automated&&!onboarded())setStep('welcome');else deliverFirstAsk();},()=>{if(!onboarded())setStep('welcome');else deliverFirstAsk();});},[]);
 // Answers given before signing in go to the account at sign-in.
 useEffect(()=>window.dream.onEvent(event=>{if(event.type==='account.signed_in')void sendAnswers();}),[]);
 // A plan bought on the plans step ends the onboarding: the welcome to the plan takes over.
 const showing=step!==null;useEffect(()=>onPlanRise(()=>{if(showing)finish();}),[showing]);

 /** Signed in: an account that already answered (on another computer) goes straight to the end; a new one gets the questions. */
 const signedInNext=async()=>{
  const prior=await accountAnswers();
  if(prior){await restoreAnswers(prior);setAnswers({name:prior.name,makes:prior.makes,...(prior.experience?{experience:prior.experience}:{})});setReturning(true);setStep('ready');}else setStep('name');
 };
 const start=()=>{if(signedIn)void signedInNext();else setStep('account');};
 // Sign-in happens in the browser, as from the sign-in dialog; the app hears when it is done.
 useEffect(()=>{if(step!=='account')return;
  return window.dream.onEvent(event=>{if(event.type==='account.signed_in'){signInFinished(true);void signedInNext();}if(event.type==='account.error'){setSignInUrl(null);setError(String((event.payload as {message?:string})?.message??'Sign-in failed.'));}});},[step]);
 const openSignIn=async()=>{setBusy(true);setError(null);try{const result=await window.dream.command<{url:string}>({type:'account',action:'browser'});setSignInUrl(result.url);}catch(e){setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''));}finally{setBusy(false);}};
 const answered=async(next:OnboardingAnswers)=>{setAnswers(next);await saveAnswers(next);setStep('improve');};
 // Helping improve Gumbo (renderer/improve.ts): kept in settings.json, changed any time in Settings > Privacy.
 const improve=async(on:boolean)=>{await window.dream.saveSettings({improve:on} as never).catch(()=>{});setStep(signedIn&&b?.payments&&b.plan==='free'?'plan':'ready');};

 const name=useRef<HTMLInputElement>(null);useEffect(()=>{if(step==='name')name.current?.focus();},[step]);
 // The app underneath can't be reached (Tab, a screen reader) while the onboarding is up.
 useEffect(()=>{const root=document.getElementById('root');if(!root||!step)return;root.inert=true;return()=>{root.inert=false;};},[!!step]);
 if(!step)return null;
 const toggle=(id:MakeId)=>setAnswers(a=>({...a,makes:a.makes.includes(id)?a.makes.filter(m=>m!==id):[...a.makes,id]}));
 const previous:Partial<Record<Step,Step>>={account:'welcome',name:signedIn?'welcome':'account',makes:'name',experience:'makes',heard:'experience',improve:'heard',plan:'improve'};
 const at=progress.indexOf(step),first=answers.name.trim().split(/\s+/)[0];
 const ask=firstAsk();
 const pick=(text:string)=>{forgetFirstAsk();window.dispatchEvent(new CustomEvent('gumbo:prompt',{detail:text}));finish();};

 return createPortal(<div className="onboarding" role="dialog" aria-modal="true" aria-label="Welcome to Gumbo">
  <div className="onboarding-drag" aria-hidden="true"/>
  <Backdrop/>
  {at>=0&&<div className="onboarding-progress" aria-hidden="true"><i style={{width:`${(at+1)/progress.length*100}%`}}/></div>}
  {previous[step]&&!returning&&<button type="button" className="onboarding-back corner" onClick={()=>setStep(previous[step]!)}><ArrowLeft size={15}/>Back</button>}
  <main key={step} className={'onboarding-body step-'+step}>

   {step==='welcome'&&<>
    <GumboMark/><h1>Welcome to Gumbo</h1>
    <p>{ask?<>Gumbo will make <strong>“{ask.replace(/[.…\s]+$/,'')}”</strong> for you. A few quick questions first, so it fits the videos you make.</>:'Edit videos by saying what you want. A few quick questions first, so Gumbo fits the videos you make.'}</p>
    <button type="button" className="onboarding-primary" onClick={start}>Get started<ArrowRight size={16}/></button>
   </>}

   {step==='account'&&<>
    <h1>{signInUrl&&!onWeb()?'Continue in your browser':'Create your account'}</h1>
    <p>{onWeb()?'Gumbo AI needs an account. Sign in with Google or your email; new here, it makes your account, and you come straight back here.':signInUrl?'Sign in on the page that opened, with Google or your email. Gumbo carries on as soon as you finish.':'Gumbo AI needs an account. Your browser opens to sign in with Google or your email; new here, it makes your account.'}</p>
    {error&&<p className="onboarding-error" role="alert">{error}</p>}
    {!signInUrl?<button type="button" className="onboarding-primary" disabled={busy} onClick={()=>void openSignIn()}>{!onWeb()&&<ExternalLink size={15}/>}{busy?'Opening…':onWeb()?'Sign in':'Sign in with your browser'}</button>
     :<div className="onboarding-waiting" role="status"><span className="sign-in-spinner" aria-hidden="true"/>Waiting for you to sign in…<button type="button" onClick={()=>void openSignIn()}>Open the page again</button></div>}
    <button type="button" className="onboarding-skip" onClick={()=>setStep('name')}>Skip for now: editing by hand needs no account</button>
   </>}

   {step==='name'&&<form onSubmit={e=>{e.preventDefault();if(answers.name.trim())setStep('makes');}}>
    <h1>What should Gumbo call you?</h1>
    <p>Gumbo uses it when it talks to you. You can change it in Settings.</p>
    <input ref={name} className="onboarding-input" aria-label="Your name" value={answers.name} maxLength={80} placeholder="Your name" autoComplete="given-name" onChange={e=>setAnswers({...answers,name:e.target.value})}/>
    <button type="submit" className="onboarding-primary" disabled={!answers.name.trim()}>Continue</button>
   </form>}

   {step==='makes'&&<>
    <h1>What do you make{first?`, ${first}`:''}?</h1>
    <p>Pick all that fit. Gumbo's AI keeps it in mind with every edit.</p>
    <div className="onboarding-chips" role="group" aria-label="What you make">{makes.map(([id,label])=><button key={id} type="button" aria-pressed={answers.makes.includes(id)} onClick={()=>toggle(id)}>{answers.makes.includes(id)&&<Check size={14}/>}{label}</button>)}</div>
    <button type="button" className="onboarding-primary" disabled={!answers.makes.length} onClick={()=>setStep('experience')}>Continue</button>
   </>}

   {step==='experience'&&<>
    <h1>How much have you edited?</h1>
    <p>So Gumbo knows how much to explain.</p>
    <div className="onboarding-options" role="radiogroup" aria-label="Editing experience">{experiences.map(([id,label,detail])=><button key={id} type="button" role="radio" aria-checked={answers.experience===id} onClick={()=>{setAnswers({...answers,experience:id});setStep('heard');}}><b>{label}</b><span>{detail}</span><ArrowRight size={15}/></button>)}</div>
   </>}

   {step==='heard'&&<>
    <h1>How did you hear about Gumbo?</h1>
    <p>It helps us find more people like you.</p>
    <div className="onboarding-chips" role="radiogroup" aria-label="How you heard about Gumbo">{sources.map(([id,label])=><button key={id} type="button" role="radio" aria-checked={answers.heard===id} onClick={()=>void answered({...answers,heard:id})}>{label}</button>)}</div>
    <button type="button" className="onboarding-skip" onClick={()=>void answered({name:answers.name,makes:answers.makes,...(answers.experience?{experience:answers.experience}:{})})}>Skip</button>
   </>}

   {step==='improve'&&<>
    <h1>Help improve Gumbo’s AI?</h1>
    <p>Gumbo sends us a log of each request to find and fix problems: your request, every step the AI took and the code it wrote. Never your footage. Say yes and we may also use them, with any rating you give, to train Gumbo’s own model. You can change this any time in Settings, under Privacy.</p>
    <div className="onboarding-options" role="radiogroup" aria-label="Help improve Gumbo">
     <button type="button" role="radio" aria-checked={false} onClick={()=>void improve(true)}><b>Yes, help train Gumbo</b><span>Helps Gumbo get better at the videos you make.</span><ArrowRight size={15}/></button>
     <button type="button" role="radio" aria-checked={false} onClick={()=>void improve(false)}><b>No thanks</b><span>Your logs are used only to fix problems.</span><ArrowRight size={15}/></button>
    </div>
   </>}

   {step==='plan'&&b&&<>
    <h1>Choose your plan</h1>
    <p>Start free, or get more credits every month. You can change or cancel any time.</p>
    <div className="onboarding-plans"><PlanChooser b={b} opened={opened} pay={pay} free={{label:'Continue with Free',onClick:()=>setStep('ready')}}/></div>
    {payError&&<p className="onboarding-error" role="alert">{payError}</p>}
    {opened&&<p className="onboarding-note">Finish on Stripe's page. Gumbo carries on by itself once your plan starts.</p>}
   </>}

   {step==='ready'&&<>
    <GumboMark/><h1>{returning?`Welcome back${first?`, ${first}`:''}`:`You’re all set${first?`, ${first}`:''}`}</h1>
    <p>{answers.experience==='pro'?'Say what you want and Gumbo cuts it on a real timeline. Open the Editor at the top of a project any time to work frame by frame.':'Add your clips and say what you want. Gumbo cuts it on a real timeline you can watch, change and export.'}</p>
    <h2>{ask?'Start with your request':'Start with one of these'}</h2>
    <div className="welcome-prompts">{ask&&<button type="button" onClick={()=>pick(ask)}><b><Sparkles size={14}/>Your request</b><span>{ask}</span><ArrowRight size={14}/></button>}{startersFor(answers.makes).map(([Icon,title,text])=><button key={title} type="button" onClick={()=>pick(text)}><b><Icon size={14}/>{title}</b><span>{text}</span><ArrowRight size={14}/></button>)}</div>
    <button type="button" className="onboarding-primary" onClick={finish}>Start creating</button>
   </>}
  </main>
 </div>,document.body);
}

/** Behind the questions, a quiet editing timeline: rows of clips drift past a playhead, the way footage moves through
 * Gumbo's own timeline, faded out where the words are. Only the rows move (one transform each), so it costs the GPU next to
 * nothing, and it holds still when the system asks for reduced motion. Each row is two identical runs of clips, so moving
 * it by half its width loops without a seam. */
const ROWS:[number[],'video'|'audio'][]=[
 [[220,130,310,90,180,260,150,120,280],'video'],
 [[160,280,110,210,340,130,190,240],'video'],
 [[420,260,380,300,460],'audio'],
 [[140,230,170,300,110,260,200,150],'video'],
 [[260,150,320,120,220,180,290,140],'video'],
 [[360,480,300,420,340],'audio'],
 [[190,120,270,160,330,140,210,250],'video'],
];
function Backdrop(){
 return <div className="onboarding-backdrop" aria-hidden="true">
  {ROWS.map(([clips,kind],row)=><div key={row} className={'onboarding-track '+kind} style={{top:`${6+row*14.5}%`}}>
   <div style={{animationDuration:`${150+row*23}s`,animationDelay:`${-row*37}s`}}>
    {[0,1].flatMap(copy=>[...clips,...clips].map((width,n)=><i key={copy+'-'+n} style={{width}}/>))}
   </div>
  </div>)}
  <span className="onboarding-playhead"/>
 </div>;
}
