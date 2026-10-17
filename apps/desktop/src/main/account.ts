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
 async token(){
  const current=this.signedIn();if(!current)throw new SignInRequired();
  if(current.expires_at<Date.now()/1000+60){
   if(!this.refreshing){const session=current,generation=this.generation;this.refreshing=(async()=>{const response=await fetch(`${this.url}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:this.anonKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token}),signal:AbortSignal.timeout(15000)});if(!response.ok){if([400,401].includes(response.status)&&generation===this.generation){this.clear();return;}throw new Error('Gumbo AI could not refresh its connection. Retry when online.');}const body=await response.json() as any;if(generation===this.generation&&this.session?.refresh_token===session.refresh_token)this.save({...body,expires_at:Math.floor(Date.now()/1000)+body.expires_in});})().finally(()=>{this.refreshing=null;});}
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
 async payPage(action:'checkout'|'portal',request:{plan?:string;packs?:number}={}){const response=await fetch(`${this.gateway()}/billing-${action}`,{method:'POST',headers:{Authorization:`Bearer ${await this.token()}`,'Content-Type':'application/json'},body:JSON.stringify(request)});const body=await response.json() as any;if(!response.ok)throw new Error(body.error??'Paying is unavailable right now.');return String(body.url);}
 signout(){this.generation++;this.clear();return {signedIn:false};}
 gateway(){return `${this.url}/functions/v1/dream-gateway`;}
}
