/** Gumbo AI needs a signed-in account. The desktop app's Account (main/account.ts) in the browser: the session lives in
 * localStorage instead of an encrypted file, and signing in returns to this page (/app) instead of a loopback callback,
 * with the same PKCE exchange. Several tabs share one session: a refresh token works once, so a tab that finds a newer
 * session in storage uses it rather than spending its own. */
type Session={access_token:string;refresh_token:string;expires_at:number;user:{id?:string;email?:string;is_anonymous?:boolean}};
export class SignInRequired extends Error{constructor(){super('SIGN_IN_REQUIRED: Sign in to use Gumbo AI.');this.name='SignInRequired';}}
const sessionKey='gumbo-session',verifierKey='gumbo-sign-in-verifier';
const base64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const gzipped=async(text:string)=>new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());

export class Account {
 private session:Session|null=null;private refreshing:Promise<void>|null=null;private generation=0;
 url=import.meta.env.DREAM_SUPABASE_URL??'https://qewguvfkkwvdoqptiljd.supabase.co';anonKey=import.meta.env.DREAM_SUPABASE_ANON_KEY??'';
 constructor(){this.session=this.saved();}
 get accountId(){return this.session?.user.id;}
 private saved():Session|null{try{return JSON.parse(localStorage.getItem(sessionKey)??'null');}catch{return null;}}
 private save(session:Session){this.session=session;localStorage.setItem(sessionKey,JSON.stringify(session));}
 private clear(){this.session=null;localStorage.removeItem(sessionKey);}
 signedIn(){if(this.session?.user.is_anonymous)this.clear();return this.session;}

 /** The sign-in page (usegumbo.app/signin) with this page as where to come back, and a PKCE challenge whose verifier
  * stays in this tab's session storage. Google or the emailed link signs in there and returns here with a code. */
 async beginSignIn(){
  const verifier=base64url(crypto.getRandomValues(new Uint8Array(32))),challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  sessionStorage.setItem(verifierKey,verifier);
  const back=new URL(location.href);back.search='';back.hash='';
  const page=new URL('https://usegumbo.app/signin/');page.searchParams.set('web',back.toString());page.searchParams.set('challenge',challenge);
  return page.toString();
 }
 /** Finishes a sign-in this page came back from (?code=…): exchanges the code with the saved verifier, then drops the
  * code from the address. False when there was nothing to finish. */
 async finishSignIn(){
  const here=new URL(location.href),code=here.searchParams.get('code'),denied=here.searchParams.get('error_description')??here.searchParams.get('error');
  if(!code&&!denied)return false;
  for(const name of ['code','error','error_description','error_code','state'])here.searchParams.delete(name);history.replaceState(null,'',here.toString());
  if(denied)throw new Error(denied);
  const verifier=sessionStorage.getItem(verifierKey);sessionStorage.removeItem(verifierKey);
  if(!verifier)throw new Error('This sign-in was started in another tab. Sign in again here.');
  await this.exchange(code!,verifier);return true;
 }
 async exchange(code:string,verifier:string){const response=await fetch(`${this.url}/auth/v1/token?grant_type=pkce`,{method:'POST',headers:{apikey:this.anonKey,'Content-Type':'application/json'},body:JSON.stringify({auth_code:code,code_verifier:verifier})});const body=await response.json() as any;if(!response.ok)throw new Error(body.error_description??body.msg??'Sign-in failed.');this.save({...body,expires_at:Math.floor(Date.now()/1000)+body.expires_in});}

 async token(){
  let current=this.signedIn();if(!current)throw new SignInRequired();
  // Another tab refreshed first: its newer session is used rather than spending this tab's old refresh token.
  const stored=this.saved();if(stored&&stored.refresh_token!==current.refresh_token&&stored.expires_at>current.expires_at){this.session=stored;current=stored;}
  if(current.expires_at<Date.now()/1000+60){
   if(!this.refreshing){const session=current,generation=this.generation;this.refreshing=(async()=>{const response=await fetch(`${this.url}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:this.anonKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token}),signal:AbortSignal.timeout(15000)});if(!response.ok){
    const latest=this.saved();if(latest&&latest.refresh_token!==session.refresh_token){this.session=latest;return;}
    // Only Supabase saying the refresh token is no good signs out; anything else (offline, a proxy) is retried later.
    const reason=await response.json().catch(()=>({})) as {error_code?:string;error?:string;msg?:string;error_description?:string};
    const invalid=['refresh_token_not_found','refresh_token_already_used','session_not_found','session_expired','user_not_found'].includes(reason.error_code??'')||reason.error==='invalid_grant'||/refresh token/i.test(reason.msg??reason.error_description??'');
    if(invalid&&generation===this.generation){this.clear();return;}throw new Error('Gumbo AI could not refresh its connection. Retry when online.');}const body=await response.json() as any;if(generation===this.generation&&this.session?.refresh_token===session.refresh_token)this.save({...body,expires_at:Math.floor(Date.now()/1000)+body.expires_in});})().finally(()=>{this.refreshing=null;});}
   await this.refreshing;if(!this.session)throw new SignInRequired();
  }
  return this.session?.access_token??'';
 }
 gateway(){return `${this.url}/functions/v1/dream-gateway`;}
 private async get(route:string,missing:string){if(!this.signedIn())return null;const response=await fetch(`${this.gateway()}/${route}`,{headers:{Authorization:`Bearer ${await this.token()}`}});if(response.status===404)return{unavailable:true};const body=await response.json() as any;if(!response.ok)throw new Error(body.error??missing);return body;}
 async info(){if(!this.signedIn())return {signedIn:false,email:'',configured:!!this.anonKey};const response=await fetch(`${this.gateway()}/account`,{headers:{Authorization:`Bearer ${await this.token()}`}});const body=await response.json() as any;if(!response.ok)throw new Error(body.error??'Gumbo AI is currently unavailable.');return {signedIn:true,email:this.session?.user.email??'',...body};}
 usage(){return this.get('usage','Usage is unavailable.');}
 billing(){return this.get('billing','Billing is unavailable.');}
 activity(){return this.get('activity','Activity is unavailable.');}
 async profile(answers?:unknown){if(!this.signedIn())return null;const auth={Authorization:`Bearer ${await this.token()}`};const response=await fetch(`${this.gateway()}/profile`,answers?{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify(answers)}:{headers:auth});if(response.status===404||response.status===405)return{unavailable:true};const body=await response.json().catch(()=>({})) as any;if(!response.ok)throw new Error(body.error??'Your answers could not be saved.');return body;}
 async payPage(action:'checkout'|'portal',request:{plan?:string;packs?:number;flow?:string}={}){const response=await fetch(`${this.gateway()}/billing-${action}`,{method:'POST',headers:{Authorization:`Bearer ${await this.token()}`,'Content-Type':'application/json'},body:JSON.stringify(request)});const body=await response.json() as any;if(!response.ok)throw new Error(body.error??'Paying is unavailable right now.');return String(body.url);}
 async report(report:{turnId:string;note:string;kind?:'report'|'feedback'|'training';rating?:'up'|'down';appVersion:string;platform:string;log:unknown}){
  if(!this.signedIn())throw new Error('Sign in to send a log.');
  const response=await fetch(`${this.gateway()}/report`,{method:'POST',headers:{Authorization:`Bearer ${await this.token()}`,'Content-Type':'application/json'},body:JSON.stringify(report)});
  const body=await response.json().catch(()=>({})) as {reference?:string;error?:string};if(!response.ok)throw new Error(body.error??'The log could not be sent.');return{reference:String(body.reference)};
 }
 /** An edit's log, sent on its own: gzipped like the agent's requests, since code in a log can look like an attack to
  * the firewall in front of the gateway. 0 when the gateway could not be reached. */
 async editLog(entry:unknown){
  if(!this.signedIn())return 401;
  try{const response=await fetch(`${this.gateway()}/edit-log`,{method:'POST',headers:{Authorization:`Bearer ${await this.token()}`,'Content-Type':'application/x-dream-json-gzip'},body:await gzipped(JSON.stringify(entry)),signal:AbortSignal.timeout(60_000)});await response.arrayBuffer().catch(()=>{});return response.status;}
  catch(error){return error instanceof SignInRequired?401:0;}
 }
 signout(){this.generation++;this.clear();return {signedIn:false};}
 async creators(query:string){if(!this.signedIn()||!query.trim())return{creators:[]};const response=await fetch(`${this.gateway()}/creators`,{method:'POST',headers:{Authorization:`Bearer ${await this.token()}`,'Content-Type':'application/json'},body:JSON.stringify({query})});const body=await response.json().catch(()=>({})) as any;return response.ok?body:{creators:[],error:body.error};}
 async providers():Promise<Record<string,boolean>>{if(!this.signedIn())return{};try{const response=await fetch(`${this.gateway()}/providers`,{headers:{Authorization:`Bearer ${await this.token()}`},signal:AbortSignal.timeout(5000)});return response.ok?await response.json() as Record<string,boolean>:{};}catch{return{};}}
}
