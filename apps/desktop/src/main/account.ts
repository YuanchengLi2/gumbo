import {app,safeStorage} from 'electron';import {readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';import {join} from 'node:path';
type Session={access_token:string;refresh_token:string;expires_at:number;user:{id?:string;email?:string;is_anonymous?:boolean}};
/** Gumbo AI needs a signed-in account; the app shows its sign-in screen when it meets this. */
export class SignInRequired extends Error{constructor(){super('SIGN_IN_REQUIRED: Sign in to use Gumbo AI.');this.name='SignInRequired';}}
export class Account {
 private session:Session|null=null;private refreshing:Promise<void>|null=null;private generation=0;private connecting:Promise<void>|null=null;readonly file=join(app.getPath('userData'),'session.enc');readonly configFile=join(app.getPath('userData'),'cloud.json');url=process.env.DREAM_SUPABASE_URL??'https://qewguvfkkwvdoqptiljd.supabase.co';anonKey=process.env.DREAM_SUPABASE_ANON_KEY??'';
 constructor(){const packaged=join(process.resourcesPath??app.getAppPath(),'staged/cloud.json');for(const file of [packaged,this.configFile])if(existsSync(file)){const c=JSON.parse(readFileSync(file,'utf8'));this.url=c.url;this.anonKey=c.anonKey;}if(existsSync(this.file)&&safeStorage.isEncryptionAvailable()){try{this.session=JSON.parse(safeStorage.decryptString(readFileSync(this.file)));}catch{}}}
 get accountId(){return this.session?.user.id;}
 configure(url:string,anonKey:string){if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url))throw new Error('Use a valid Supabase project URL.');this.url=url;this.anonKey=anonKey;writeFileSync(this.configFile,JSON.stringify({url,anonKey}));}
 async signin(email:string,password:string){const generation=++this.generation;const response=await fetch(`${this.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:this.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email,password})});const body=await response.json() as any;if(!response.ok)throw new Error(body.msg??body.error_description??'Sign-in failed.');if(generation!==this.generation)throw new Error('Sign-in was canceled.');this.save({...body,expires_at:Math.floor(Date.now()/1000)+body.expires_in});return this.info();}
 private save(session:Session){if(!safeStorage.isEncryptionAvailable())throw new Error('OS credential encryption is unavailable.');this.session=session;writeFileSync(this.file,safeStorage.encryptString(JSON.stringify(session)));}
 async exchange(code:string,verifier:string){const response=await fetch(`${this.url}/auth/v1/token?grant_type=pkce`,{method:'POST',headers:{apikey:this.anonKey,'Content-Type':'application/json'},body:JSON.stringify({auth_code:code,code_verifier:verifier})});const body=await response.json() as any;if(!response.ok)throw new Error(body.error_description??body.msg??'Sign-in failed.');this.save({...body,expires_at:Math.floor(Date.now()/1000)+body.expires_in});}
 /** Guests are gone: an account is needed for Gumbo AI. A guest session saved by an older version is dropped. */
 private signedIn(){if(this.session?.user.is_anonymous)this.clear();return this.session;}
 private clear(){this.session=null;if(existsSync(this.file))unlinkSync(this.file);}
 /** The session saved on disk, which another copy of the app (the installed one, a development build) may have refreshed
  * since this one read it. A refresh token works once, so this copy's would then be spent. */
 private saved():Session|null{try{return existsSync(this.file)&&safeStorage.isEncryptionAvailable()?JSON.parse(safeStorage.decryptString(readFileSync(this.file))):null;}catch{return null;}}
 async token(){
  let current=this.signedIn();if(!current)throw new SignInRequired();
  // Another copy refreshed first: its newer session is used rather than spending this copy's old refresh token.
  const disk=this.saved();if(disk&&disk.refresh_token!==current.refresh_token&&disk.expires_at>current.expires_at){this.session=disk;current=disk;}
  if(current.expires_at<Date.now()/1000+60){
   if(!this.refreshing){const session=current,generation=this.generation;this.refreshing=(async()=>{const response=await fetch(`${this.url}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:this.anonKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token}),signal:AbortSignal.timeout(15000)});if(!response.ok){
    // Refused: if another copy refreshed meanwhile, its session is used; only a refusal nobody got past signs out.
    const latest=this.saved();if(latest&&latest.refresh_token!==session.refresh_token){this.session=latest;return;}
    // Only Supabase saying the refresh token is no good signs out. A refusal for anything else (a build started without
    // the app's key, a proxy) used to sign out too, and deleted the saved sign-in.
    const reason=await response.json().catch(()=>({})) as {error_code?:string;error?:string;msg?:string;error_description?:string};
    const invalid=['refresh_token_not_found','refresh_token_already_used','session_not_found','session_expired','user_not_found'].includes(reason.error_code??'')||reason.error==='invalid_grant'||/refresh token/i.test(reason.msg??reason.error_description??'');
    if(invalid&&generation===this.generation){this.clear();return;}throw new Error('Gumbo AI could not refresh its connection. Retry when online.');}const body=await response.json() as any;if(generation===this.generation&&this.session?.refresh_token===session.refresh_token)this.save({...body,expires_at:Math.floor(Date.now()/1000)+body.expires_in});})().finally(()=>{this.refreshing=null;});}
   await this.refreshing;if(!this.session)throw new SignInRequired();
  }
  return this.session?.access_token??'';
 }

 async info(){if(!this.signedIn())return {signedIn:false,email:'',configured:!!this.anonKey};const response=await fetch(`${this.url}/functions/v1/dream-gateway/account`,{headers:{Authorization:`Bearer ${await this.token()}`}});const body=await response.json() as any;if(!response.ok)throw new Error(body.error??'Gumbo AI is currently unavailable.');return {signedIn:true,email:this.session?.user.email??'',...body};}
 /** Spend from the gateway's usage records (Settings > Usage): today, the last 30 days and by model. */
 async usage(){if(!this.signedIn())return null;const response=await fetch(`${this.url}/functions/v1/dream-gateway/usage`,{headers:{Authorization:`Bearer ${await this.token()}`}});if(response.status===404)return{unavailable:true};const body=await response.json() as any;if(!response.ok)throw new Error(body.error??'Usage is unavailable.');return body;}
 /** The plan and credits (Settings > Usage and billing, the profile menu). */
 async billing(){if(!this.signedIn())return null;const response=await fetch(`${this.gateway()}/billing`,{headers:{Authorization:`Bearer ${await this.token()}`}});if(response.status===404)return{unavailable:true};const body=await response.json() as any;if(!response.ok)throw new Error(body.error??'Billing is unavailable.');return body;}
 /** A Stripe page to pay on (Checkout for a plan or credits, or the portal to manage the plan): its address. */
 /** Tokens over the last year (Settings > Profile). */
 async activity(){if(!this.signedIn())return null;const response=await fetch(`${this.gateway()}/activity`,{headers:{Authorization:`Bearer ${await this.token()}`}});if(response.status===404)return{unavailable:true};const body=await response.json() as any;if(!response.ok)throw new Error(body.error??'Activity is unavailable.');return body;}
 /** The onboarding's answers, kept with the account (the gateway's profiles.ts): read back on another computer so they
  * are not asked again, and saved when someone finishes them. unavailable when the gateway is older than profiles. */
 async profile(answers?:unknown){if(!this.signedIn())return null;const auth={Authorization:`Bearer ${await this.token()}`};const response=await fetch(`${this.gateway()}/profile`,answers?{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify(answers)}:{headers:auth});if(response.status===404||response.status===405)return{unavailable:true};const body=await response.json().catch(()=>({})) as any;if(!response.ok)throw new Error(body.error??'Your answers could not be saved.');return body;}
 async payPage(action:'checkout'|'portal',request:{plan?:string;packs?:number;flow?:string}={}){const response=await fetch(`${this.gateway()}/billing-${action}`,{method:'POST',headers:{Authorization:`Bearer ${await this.token()}`,'Content-Type':'application/json'},body:JSON.stringify(request)});const body=await response.json() as any;if(!response.ok)throw new Error(body.error??'Paying is unavailable right now.');return String(body.url);}
 /** Send log: one edit's log (turn-log.ts), what the user wrote about it, and the app's version, to the gateway; its
  * reference comes back for the user to quote. */
 async report(report:{turnId:string;note:string;kind?:'report'|'feedback'|'training';rating?:'up'|'down';appVersion:string;platform:string;log:unknown}){
  if(!this.signedIn())throw new Error('Sign in to send a log.');
  const response=await fetch(`${this.gateway()}/report`,{method:'POST',headers:{Authorization:`Bearer ${await this.token()}`,'Content-Type':'application/json'},body:JSON.stringify(report)});
  const body=await response.json().catch(()=>({})) as {reference?:string;error?:string};if(!response.ok)throw new Error(body.error??'The log could not be sent.');return{reference:String(body.reference)};
 }
 signout(){this.generation++;this.clear();return {signedIn:false};}
 gateway(){return `${this.url}/functions/v1/dream-gateway`;}
}
