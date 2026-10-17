import {useEffect,useState} from 'react';

/** Who is signed in, for the parts of the app that need Gumbo AI. The app opens and edits by hand without an account;
 * anything that asks the AI first asks for sign-in (requireSignIn), which shows the sign-in dialog and carries on once
 * the user is signed in. */
export type AccountStatus={signedIn:boolean;email:string;plan?:string;status?:string};
let current:AccountStatus|null=null;const listeners=new Set<()=>void>();
const notify=()=>listeners.forEach(l=>l());
export async function refreshAccount():Promise<AccountStatus>{
 try{const info=await window.dream.command<any>({type:'account',action:'get'});current={signedIn:!!info?.signedIn,email:String(info?.email??''),plan:info?.plan===undefined?undefined:String(info.plan),status:info?.status};}
 catch{current=current??{signedIn:false,email:''};}
 notify();return current!;
}
export function useAccount(){
 const [value,setValue]=useState(current);
 useEffect(()=>{const update=()=>setValue(current);listeners.add(update);if(!current)void refreshAccount();
  const off=window.dream.onEvent(event=>{if(event.type==='account.signed_in')void refreshAccount();});return()=>{listeners.delete(update);off();};},[]);
 return value;
}
/** Marks the account signed out here (after Sign out), without asking the service again. */
export function signedOut(){current={signedIn:false,email:''};notify();}

type Waiting=(signedIn:boolean)=>void;
const waiting=new Set<Waiting>();
/** Resolves true once there is a signed-in account: at once when there is one, otherwise after the sign-in dialog;
 * false when the user closes it. */
export async function requireSignIn():Promise<boolean>{
 const status=current??await refreshAccount();if(status.signedIn)return true;
 return new Promise<boolean>(resolve=>{waiting.add(resolve);window.dispatchEvent(new CustomEvent('dream:sign-in'));});
}
/** The dialog ended: signed in (everything waiting carries on) or closed (it stops). */
export function signInFinished(signedIn:boolean){for(const resolve of waiting)resolve(signedIn);waiting.clear();if(signedIn)void refreshAccount();}
