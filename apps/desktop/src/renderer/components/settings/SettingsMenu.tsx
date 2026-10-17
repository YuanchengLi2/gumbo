import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Settings,Gauge,LogOut,LogIn,Sun,Moon,Monitor,User} from 'lucide-react';
import type {UsageSummary} from '@dream/contracts';
import {SettingsPage,type SettingsSection} from './SettingsPage';
import {useAccount,requireSignIn,signedOut} from '../../account';
import {useTheme,setThemeChoice,type ThemeChoice} from '../../theme';

/** Whether Settings is open, and on which page, for the whole app: the profile menu on the home screen and in the editor's
 * header are different components (one replaces the other when a project opens), and Settings stays open across that. */
let open:SettingsSection|null=null;const listeners=new Set<()=>void>();
export const openSettings=(section:SettingsSection='profile')=>{open=section;listeners.forEach(l=>l());};
const closeSettings=()=>{open=null;listeners.forEach(l=>l());};
const money=(n:number)=>n>=10?`$${n.toFixed(0)}`:`$${n.toFixed(2)}`;
const themes:[ThemeChoice,string,typeof Sun][]=[['light','Light',Sun],['dark','Dark',Moon],['system','System',Monitor]];

/** You, as a circle with your initial: it opens a small menu with who is signed in, today's AI use, Settings, the theme and
 * signing in or out. It replaces the Settings gear. up opens the menu above (the home sidebar's foot); otherwise it opens
 * below, right-aligned (the editor's header). A header is a window-drag area on Windows, so the anchor is not. */
export function ProfileMenu(p:{up?:boolean;label?:boolean}){
 const account=useAccount(),choice=useTheme(),[menu,setMenu]=useState(false),[usage,setUsage]=useState<UsageSummary|null>(null),anchor=useRef<HTMLDivElement>(null);
 const signedIn=!!account?.signedIn,email=account?.email??'',name=email.split('@')[0]||'You',initial=(signedIn?name[0]:'')?.toUpperCase();
 useEffect(()=>{if(!menu)return;
  const away=(e:MouseEvent)=>{if(!anchor.current?.contains(e.target as Node))setMenu(false);},key=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(false);};
  document.addEventListener('mousedown',away);document.addEventListener('keydown',key);
  // Today's use, asked for each time the menu opens; the menu shows without it until it arrives.
  if(signedIn)window.dream.command<any>({type:'account',action:'usage'}).then(u=>setUsage(u&&!u.unavailable?u:null),()=>setUsage(null));
  return()=>{document.removeEventListener('mousedown',away);document.removeEventListener('keydown',key);};
 },[menu,signedIn]);
 const go=(section:SettingsSection)=>{setMenu(false);openSettings(section);};
 const signOut=async()=>{setMenu(false);await window.dream.command({type:'account',action:'signout'});signedOut();};
 return <div className={'profile-anchor'+(p.up?' up':'')} ref={anchor}>
  <button type="button" className={'profile-button'+(p.label?' labelled':'')} aria-label="Profile" title={signedIn?email:'Profile'} aria-haspopup="menu" aria-expanded={menu} onClick={()=>setMenu(v=>!v)}>
   <span className={'profile-avatar'+(signedIn?'':' signed-out')} aria-hidden="true">{initial||<User size={15}/>}</span>
   {p.label&&<span className="profile-name"><strong>{signedIn?name:'Not signed in'}</strong><small>{signedIn?'Early access':'Sign in for Gumbo AI'}</small></span>}
  </button>
  {menu&&<div className="profile-menu" role="menu">
   <header><span className={'profile-avatar'+(signedIn?'':' signed-out')} aria-hidden="true">{initial||<User size={15}/>}</span><span><strong>{signedIn?name:'Not signed in'}</strong><small>{signedIn?email:'Your projects work without an account.'}</small></span></header>
   {signedIn&&usage&&usage.dailyBudgetUsd>0&&<button type="button" role="menuitem" className="profile-usage" onClick={()=>go('usage')}>
    <span><Gauge size={14}/>Today</span><span>{money(usage.todayUsd)} of {money(usage.dailyBudgetUsd)}</span>
    <i role="meter" aria-label="Today's AI use" aria-valuemin={0} aria-valuemax={usage.dailyBudgetUsd} aria-valuenow={usage.todayUsd}><b style={{width:`${Math.round(Math.min(1,usage.todayUsd/usage.dailyBudgetUsd)*100)}%`}}/></i>
   </button>}
   <div className="profile-theme" role="group" aria-label="Theme">{themes.map(([value,label,Icon])=><button key={value} type="button" aria-pressed={choice===value} title={label} onClick={()=>setThemeChoice(value)}><Icon size={14}/>{label}</button>)}</div>
   <button type="button" role="menuitem" onClick={()=>go('profile')}><Settings size={15}/>Settings</button>
   {signedIn?<button type="button" role="menuitem" onClick={()=>void signOut()}><LogOut size={15}/>Sign out</button>:<button type="button" role="menuitem" onClick={()=>{setMenu(false);void requireSignIn();}}><LogIn size={15}/>Sign in</button>}
  </div>}
 </div>;
}
/** Settings itself, mounted once at the top of the app. */
export function SettingsLayer(){
 const [section,setSection]=useState(open);
 useEffect(()=>{const update=()=>setSection(open);listeners.add(update);return()=>{listeners.delete(update);};},[]);
 return section?createPortal(<SettingsPage key={section} initial={section} onClose={closeSettings}/>,document.body):null;
}
