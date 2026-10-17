import {shell} from 'electron';import {createServer,type Server} from 'node:http';import {randomBytes,createHash} from 'node:crypto';import {Account} from './account';import {signedInPage} from './protocol';

/** Signing in happens in the browser: Sign in opens the sign-in page (usegumbo.app/signin) with the address of a
 * one-time callback on this computer (127.0.0.1) and a PKCE challenge. Google or the emailed link signs in there and
 * returns to the callback with a code only this app can exchange; the app is then signed in and comes to the front.
 * The callback closes once used, or after ten minutes. */
type Publish=(type:string,payload:unknown)=>void;
let pending:Server|undefined;

/** A callback for this sign-in, and the PKCE pair that goes with it. */
async function callback(account:Account,publish:Publish,focus:()=>void){
 pending?.close();
 const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url'),state=randomBytes(24).toString('hex');
 const server=createServer(async(req,res)=>{const url=new URL(req.url??'','http://127.0.0.1');
  if(url.pathname!=='/callback'||url.searchParams.get('state')!==state){res.writeHead(400).end('Invalid Gumbo sign-in callback.');return;}
  const denied=url.searchParams.get('error_description')??url.searchParams.get('error');if(denied){res.writeHead(400,{'Content-Type':'text/plain'}).end(denied);publish('account.error',{message:denied});server.close();return;}
  const code=url.searchParams.get('code');if(!code){res.writeHead(400).end('Missing authorization code.');return;}
  try{await account.exchange(code,verifier);const info=await account.info();res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(signedInPage);publish('account.signed_in',info);focus();}
  catch(e){res.writeHead(400).end((e as Error).message);publish('account.error',{message:(e as Error).message});}
  finally{server.close();}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));pending=server;
 const timer=setTimeout(()=>server.close(),10*60*1000);timer.unref();server.on('close',()=>{clearTimeout(timer);if(pending===server)pending=undefined;});
 return{url:`http://127.0.0.1:${(server.address() as {port:number}).port}/callback?state=${state}`,challenge};
}

/** Where the sign-in page is; DREAM_SIGN_IN_URL points a development build elsewhere. */
export const signInPage=()=>process.env.DREAM_SIGN_IN_URL??'https://usegumbo.app/signin/';
/** Opens the sign-in page in the browser for this sign-in, and returns its address (to open again or copy). Tests run
 * headless and answer the callback themselves, so no browser opens for them. */
export async function beginBrowserSignIn(account:Account,publish:Publish,focus:()=>void){
 const back=await callback(account,publish,focus),url=new URL(signInPage());url.searchParams.set('desktop',back.url);url.searchParams.set('challenge',back.challenge);
 if(!process.env.DREAM_HEADLESS)await shell.openExternal(url.toString());return{started:true,url:url.toString()};
}
