import {endpoints,SIGN_IN_PAGE,RETURN_PAGE} from '../shared/config';
/** The extension's own Gumbo session (never the site's, so the two refresh tokens never collide), in
 * chrome.storage.local. Sign-in goes through usegumbo.app/signin with a PKCE challenge whose verifier stays here;
 * Google or the emailed link returns to usegumbo.app/app/?ext=1&code=…, where the sign-in content script hands the code
 * over. The session is refreshed a minute before it expires, once, however many callers ask at the same time. */
export type Session={access_token:string;refresh_token:string;expires_at:number;user:{id:string;email?:string}};
const SESSION='session',PENDING='signin';
const base64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
let refreshing:Promise<Session|null>|undefined;

export async function session():Promise<Session|null>{return((await chrome.storage.local.get(SESSION))[SESSION] as Session|undefined)??null;}
/** Opens the sign-in page in a new tab. */
export async function signIn(){
 const verifier=base64url(crypto.getRandomValues(new Uint8Array(32)));
 const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
 await chrome.storage.local.set({[PENDING]:{verifier,at:Date.now()}});
 const url=new URL(SIGN_IN_PAGE);url.searchParams.set('web',RETURN_PAGE);url.searchParams.set('challenge',challenge);
 await chrome.tabs.create({url:url.toString()});
}
/** Finishes a sign-in with the code the sign-in page returned. */
export async function finishSignIn(code?:string,error?:string):Promise<{ok:true;email?:string}|{ok:false;message:string}>{
 if(error)return{ok:false,message:error};
 const pending=(await chrome.storage.local.get(PENDING))[PENDING] as {verifier:string;at:number}|undefined;
 if(!code||!pending){
  // An old emailed link opened while already signed in changes nothing.
  const now=await session();if(now)return{ok:true,email:now.user.email};
  return{ok:false,message:'This sign-in was not started from Gumbo for Chrome. Sign in again from the Gumbo button.'};
 }
 const {supabase,anon}=await endpoints();
 const response=await fetch(`${supabase}/auth/v1/token?grant_type=pkce`,{method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},body:JSON.stringify({auth_code:code,code_verifier:pending.verifier})});
 const body=await response.json().catch(()=>({})) as any;
 if(!response.ok)return{ok:false,message:body.error_description??body.msg??'Sign-in failed. Try again.'};
 await save(body);await chrome.storage.local.remove(PENDING);
 return{ok:true,email:body.user?.email};
}
/** A current access token, refreshed first when it is about to expire; null when signed out. */
export async function token():Promise<string|null>{
 const now=await session();if(!now)return null;
 if(now.expires_at*1000-Date.now()>60_000)return now.access_token;
 return(await refresh(now))?.access_token??null;
}
export function refresh(old?:Session|null):Promise<Session|null>{
 return refreshing??=(async()=>{
  try{
   const current=old??await session();if(!current)return null;
   const {supabase,anon}=await endpoints();
   const response=await fetch(`${supabase}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:current.refresh_token})});
   if(response.ok)return await save(await response.json());
   const reason=await response.json().catch(()=>({})) as any;
   // Only a refresh token the server no longer knows signs out; anything else (offline, a 5xx) keeps the session.
   const invalid=['refresh_token_not_found','refresh_token_already_used','session_not_found','session_expired','user_not_found'].includes(reason.error_code)||reason.error==='invalid_grant';
   if(invalid){await signOut(false);return null;}
   return current;
  }catch{return old??await session();}
  finally{refreshing=undefined;}
 })();
}
export async function signOut(tellServer=true){
 const now=await session();await chrome.storage.local.remove(SESSION);
 if(tellServer&&now){const {supabase,anon}=await endpoints();await fetch(`${supabase}/auth/v1/logout`,{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${now.access_token}`}}).catch(()=>{});}
}
async function save(body:any):Promise<Session>{
 const value:Session={access_token:body.access_token,refresh_token:body.refresh_token,expires_at:body.expires_at??Math.floor(Date.now()/1000)+Number(body.expires_in??3600),user:{id:body.user?.id,email:body.user?.email}};
 await chrome.storage.local.set({[SESSION]:value});
 // Refreshed ahead of time so the first keystroke after a long pause never waits for it.
 await chrome.alarms.create('refresh-session',{when:Math.max(Date.now()+5_000,value.expires_at*1000-90_000)});
 return value;
}
