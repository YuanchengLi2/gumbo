import {app,safeStorage} from 'electron';import {readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';import {join} from 'node:path';
type Session={access_token:string;refresh_token:string;expires_at:number;user:{id?:string;email?:string;is_anonymous?:boolean}};
export class Account {
 private session:Session|null=null;private refreshing:Promise<void>|null=null;private generation=0;private connecting:Promise<void>|null=null;readonly file=join(app.getPath('userData'),'session.enc');readonly configFile=join(app.getPath('userData'),'cloud.json');url=process.env.DREAM_SUPABASE_URL??'https://qewguvfkkwvdoqptiljd.supabase.co';anonKey=process.env.DREAM_SUPABASE_ANON_KEY??'';
 constructor(){const packaged=join(process.resourcesPath??app.getAppPath(),'staged/cloud.json');for(const file of [packaged,this.configFile])if(existsSync(file)){const c=JSON.parse(readFileSync(file,'utf8'));this.url=c.url;this.anonKey=c.anonKey;}if(existsSync(this.file)&&safeStorage.isEncryptionAvailable()){try{this.session=JSON.parse(safeStorage.decryptString(readFileSync(this.file)));}catch{}}}
 get accountId(){return this.session?.user.id;}
 configure(url:string,anonKey:string){if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url))throw new Error('Use a valid Supabase project URL.');this.url=url;this.anonKey=anonKey;writeFileSync(this.configFile,JSON.stringify({url,anonKey}));}
 async signin(email:string,password:string){const generation=++this.generation;const response=await fetch(`${this.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:this.anonKey,'Content-Type':'application/json'},body:JSON.stringify({email,password})});const body=await response.json() as any;if(!response.ok)throw new Error(body.msg??body.error_description??'Sign-in failed.');if(generation!==this.generation)throw new Error('Sign-in was canceled.');this.save({...body,expires_at:Math.floor(Date.now()/1000)+body.expires_in});return this.info();}
 private save(session:Session){if(!safeStorage.isEncryptionAvailable())throw new Error('OS credential encryption is unavailable.');this.session=session;writeFileSync(this.file,safeStorage.encryptString(JSON.stringify(session)));}
 async exchange(code:string,verifier:string){const response=await fetch(`${this.url}/auth/v1/token?grant_type=pkce`,{method:'POST',headers:{apikey:this.anonKey,'Content-Type':'application/json'},body:JSON.stringify({auth_code:code,code_verifier:verifier})});const body=await response.json() as any;if(!response.ok)throw new Error(body.error_description??body.msg??'Sign-in failed.');this.save({...body,expires_at:Math.floor(Date.now()/1000)+body.expires_in});}
 async ensureGuest(){
  if(this.session)return;
  if(!this.connecting){const generation=this.generation;this.connecting=(async()=>{
   if(!this.anonKey)throw new Error('Dream AI is not configured. Your local projects remain available.');
   const response=await fetch(`${this.url}/auth/v1/signup`,{method:'POST',headers:{apikey:this.anonKey,'Content-Type':'application/json'},body:JSON.stringify({data:{client:'dream-desktop'}}),signal:AbortSignal.timeout(20000)});
   const body=await response.json() as any;if(!response.ok||!body.access_token)throw new Error(body.msg??body.error_description??'Could not connect to Dream AI. Retry when online.');
   if(generation!==this.generation)throw new Error('Connection was canceled.');
   this.save({...body,expires_at:Math.floor(Date.now()/1000)+body.expires_in});
  })().finally(()=>{this.connecting=null;});}await this.connecting;
 }
 async token(){
  await this.ensureGuest();if(!this.session)throw new Error('Could not connect to Dream AI.');
  if(this.session.expires_at<Date.now()/1000+60){
   if(!this.refreshing){const session=this.session,generation=this.generation;this.refreshing=(async()=>{const response=await fetch(`${this.url}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:this.anonKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token}),signal:AbortSignal.timeout(15000)});if(!response.ok){if([400,401].includes(response.status)&&generation===this.generation){this.session=null;if(existsSync(this.file))unlinkSync(this.file);return;}throw new Error('Dream AI could not refresh its connection. Retry when online.');}const body=await response.json() as any;if(generation===this.generation&&this.session?.refresh_token===session.refresh_token)this.save({...body,expires_at:Math.floor(Date.now()/1000)+body.expires_in});})().finally(()=>{this.refreshing=null;});}
   await this.refreshing;if(!this.session)await this.ensureGuest();
  }
  return this.session?.access_token??'';
 }

 async info(){if(!this.session)return {signedIn:false,email:'',configured:!!this.anonKey};const response=await fetch(`${this.url}/functions/v1/dream-gateway/account`,{headers:{Authorization:`Bearer ${await this.token()}`}});const body=await response.json() as any;if(!response.ok)throw new Error(body.error??'Dream AI is currently unavailable.');return {signedIn:true,email:this.session.user.email??'',guest:!!this.session.user.is_anonymous,...body};}
 signout(){this.generation++;this.session=null;if(existsSync(this.file))unlinkSync(this.file);return {signedIn:false};}
 gateway(){return `${this.url}/functions/v1/dream-gateway`;}
}
