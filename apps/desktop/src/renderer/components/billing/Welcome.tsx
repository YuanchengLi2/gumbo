import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {X,MessageSquareText,Clapperboard,Wand2,ArrowRight} from 'lucide-react';
import {useBilling,billingReady,credits} from '../../billing';
import {GumboMark} from '../home/HomeScreen';

/** The welcome: shown when a plan starts (Stripe's window came back subscribed) and the first time someone signs in. It
 * says what the plan gives, how Gumbo works in three steps, and offers requests to start from; choosing one puts it in
 * the home screen's box (the 'gumbo:prompt' event the app listens for) so the user adds clips and sends. */
let open:null|'plan'|'first'=null;const listeners=new Set<()=>void>();
export const openWelcome=(why:'plan'|'first')=>{open=why;listeners.forEach(l=>l());};
const close=()=>{open=null;listeners.forEach(l=>l());try{localStorage.setItem('gumbo-welcomed','1');}catch{}};
export const welcomedBefore=()=>{try{return localStorage.getItem('gumbo-welcomed')==='1';}catch{return true;}};

const steps:[typeof MessageSquareText,string,string][]=[
 [MessageSquareText,'Say what you want','Describe the video in plain words: the length, the feel, where it’s going.'],
 [Clapperboard,'Add your clips','Drop in footage, or let Gumbo find it on your computer or in free libraries.'],
 [Wand2,'Watch it cut, then refine','Gumbo edits on a real timeline you can see. Ask for changes, or drag things yourself.']
];
const prompts:[string,string][]=[
 ['YouTube Short','Turn my clips into a punchy 30-second YouTube Short in 9:16, with captions and music.'],
 ['Travel recap','Make a cinematic travel recap of my best moments, with titles and music on the beat.'],
 ['Cut the silences','Remove the long silences and every um, keeping every word, and tighten the pacing.'],
 ['Product demo','Make a 45-second product demo from my screen recording, with zooms on the clicks and captions.']
];

export function WelcomeLayer(){
 const [why,setWhy]=useState(open),billing=useBilling(),b=billingReady(billing)?billing:null;
 useEffect(()=>{const update=()=>setWhy(open);listeners.add(update);return()=>{listeners.delete(update);};},[]);
 useEffect(()=>{if(!why)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')close();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[why]);
 if(!why)return null;
 const plan=b?.plans.find(p=>p.id===b.plan),paid=why==='plan'&&b&&b.plan!=='free';
 const start=(text:string)=>{window.dispatchEvent(new CustomEvent('gumbo:prompt',{detail:text}));close();};
 return createPortal(<div className="welcome-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
  <section className="welcome-window" role="dialog" aria-modal="true" aria-label="Welcome to Gumbo">
   <button type="button" className="upgrade-close" aria-label="Close" onClick={close}><X size={18}/></button>
   <header><GumboMark/><h2>{paid?`Welcome to ${plan?.name}`:'Welcome to Gumbo'}</h2>
    <p>{paid&&plan?`${credits(plan.credits)} credits are yours this month. Here's how to get the most from them.`:'Edit videos by saying what you want. Here’s how it works.'}</p></header>
   <ol className="welcome-steps">{steps.map(([Icon,title,text],i)=><li key={title}><span className="welcome-step-icon"><Icon size={17}/></span><div><b>{i+1}. {title}</b><p>{text}</p></div></li>)}</ol>
   <h3>Start with one of these</h3>
   <div className="welcome-prompts">{prompts.map(([title,text])=><button key={title} type="button" onClick={()=>start(text)}><b>{title}</b><span>{text}</span><ArrowRight size={14}/></button>)}</div>
   <footer><button type="button" className="upgrade-primary" onClick={close}>Start creating</button></footer>
  </section>
 </div>,document.body);
}
