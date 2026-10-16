import {shell} from 'electron';import {createServer,type Server} from 'node:http';import {randomBytes,createHash} from 'node:crypto';import {Account} from './account';

/** Signing in from the app itself, with no website in between: an 8-digit code by email (typed into Figjam), the link in
 * the same email, or Google. The link and Google come back to a one-time server on this computer (127.0.0.1) with a PKCE
 * code, which only this app can exchange; the server closes once used, or after ten minutes. */
type Publish=(type:string,payload:unknown)=>void;
let pending:Server|undefined;
const welcome='<!doctype html><title>Figjam</title><body style="font:16px Arial;padding:80px;background:#f5f5f5;color:#111"><h1>You\'re signed in to Figjam.</h1><p>You can close this tab and return to the app.</p></body>';

/** A callback for this sign-in, and the PKCE pair that goes with it. */
async function callback(account:Account,publish:Publish){
 pending?.close();
 const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url'),state=randomBytes(24).toString('hex');
 const server=createServer(async(req,res)=>{const url=new URL(req.url??'','http://127.0.0.1');
  if(url.pathname!=='/callback'||url.searchParams.get('state')!==state){res.writeHead(400).end('Invalid Figjam sign-in callback.');return;}
  const denied=url.searchParams.get('error_description')??url.searchParams.get('error');if(denied){res.writeHead(400,{'Content-Type':'text/plain'}).end(denied);publish('account.error',{message:denied});server.close();return;}
  const code=url.searchParams.get('code');if(!code){res.writeHead(400).end('Missing authorization code.');return;}
  try{await account.exchange(code,verifier);const info=await account.info();res.writeHead(200,{'Content-Type':'text/html'}).end(welcome);publish('account.signed_in',info);}
  catch(e){res.writeHead(400).end((e as Error).message);publish('account.error',{message:(e as Error).message});}
  finally{server.close();}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));pending=server;
 const timer=setTimeout(()=>server.close(),10*60*1000);timer.unref();server.on('close',()=>{clearTimeout(timer);if(pending===server)pending=undefined;});
 return{url:`http://127.0.0.1:${(server.address() as {port:number}).port}/callback?state=${state}`,challenge};
}

/** Emails an 8-digit code and a sign-in link to the address; a new address gets a new account. */
export async function sendSignInEmail(account:Account,publish:Publish,email:string){
 const address=email.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))throw new Error('Enter a valid email address.');
 const back=await callback(account,publish);await account.sendEmail(address,back.url,back.challenge);return{sent:true,email:address};
}
/** Google: the browser signs in with Google and comes back to this app. */
export async function signInWithGoogle(account:Account,publish:Publish){
 const back=await callback(account,publish);await shell.openExternal(account.authorizeUrl('google',back.url,back.challenge));return{started:true};
}
