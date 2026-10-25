import {useEffect,useState} from 'react';
import {trying,freeRequestsLeft,useFreeRequest} from './trial';

/** Who is signed in, for the parts of the app that need Gumbo AI. The app opens and edits by hand without an account;
 * anything that asks the AI first asks for sign-in (requireSignIn), which shows the sign-in dialog and carries on once
 * the user is signed in. */
/** waitlisted: signed in, but not invited from the paid beta's waitlist yet, so edits are refused. */
/** admin: the owner's account, whose every edit is kept as training data. */
export type AccountStatus={signedIn:boolean;email:string;plan?:string;status?:string;waitlisted?:boolean;admin?:boolean};
let current:AccountStatus|null=null;const listeners=new Set<()=>void>();
const notify=()=>listeners.forEach(l=>l());
export async function refreshAccount():Promise<AccountStatus>{
 try{const info=await window.dream.command<any>({type:'account',action:'get'});current={signedIn:!!info?.signedIn,email:String(info?.email??''),plan:info?.plan===undefined?undefined:String(info.plan),status:info?.status,waitlisted:!!info?.signedIn&&info?.beta_access===false,admin:info?.is_admin===true};}
 catch{current=current??{signedIn:false,email:''};}
 notify();return current!;
}
export function useAccount(){
 const [value,setValue]=useState(current);
 useEffect(()=>{const update=()=>setValue(current);listeners.add(update);if(!current)void refreshAccount();
  const off=window.dream.onEvent(event=>{if(event.type==='account.signed_in')void refreshAccount();});return()=>{listeners.delete(update);off();};},[]);
 return value;
}
/** The account as last asked, without asking again (undefined before the first answer). */
export const accountNow=()=>current??undefined;
/** Marks the account signed out here (after Sign out), without asking the service again. */
export function signedOut(){current={signedIn:false,email:''};notify();}

type Waiting=(signedIn:boolean)=>void;
const waiting=new Set<Waiting>();
/** Resolves true once there is a signed-in account: at once when there is one, otherwise after the sign-in dialog;
 * false when the user closes it. */
/** guest: a request to Gumbo AI, which a try (trial.ts) may send once without an account. reason says why sign-in is
 * asked for, for the dialog: the try was used, or an export from a try. */
export type SignInReason='try-used'|'export';
export async function requireSignIn(options:{guest?:boolean;reason?:SignInReason}={}):Promise<boolean>{
 const status=current??await refreshAccount();if(status.signedIn)return true;
 let reason=options.reason;
 if(options.guest&&trying()){
  if(freeRequestsLeft()>0)try{await window.dream.command({type:'account',action:'guest'});useFreeRequest();return true;}catch{}
  reason='try-used';
 }
 return new Promise<boolean>(resolve=>{waiting.add(resolve);window.dispatchEvent(new CustomEvent('dream:sign-in',{detail:reason}));});
}
/** The dialog ended: signed in (everything waiting carries on) or closed (it stops). */
export function signInFinished(signedIn:boolean){for(const resolve of waiting)resolve(signedIn);waiting.clear();if(signedIn)void refreshAccount();}
