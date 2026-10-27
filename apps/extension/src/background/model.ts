import {endpoints} from '../shared/config';
import {callGateway,GatewayError,type GatewayCall,type CallOptions} from '../shared/gateway';
import {token,refresh} from './auth';
import {addTiming} from './db';
import {usageCost} from '../../../../packages/config/src/pricing';
const quick=new Set(['tab','inline','action']);
/** A model call as the signed-in user: the gateway with a current token, asked once more with a fresh one if the
 * gateway says the session expired. */
export async function model(call:GatewayCall,options:CallOptions={}){
 // Quick calls on models other than Claude: DeepSeek thinks at length unless told not to, so a Tab, Ctrl+K or next-move
 // call says not to; and a cache warm-up is Claude's alone (DeepSeek caches a prompt's start by itself, and a call that
 // writes nothing is refused).
 if(!call.model.startsWith('claude-')){
  if(call.purpose==='prewarm')return{message:{role:'assistant',content:[]},timing:{}};
  if(quick.has(call.purpose))call={...call,dream_thinking:'off'};
 }
 const bearer=await token();if(!bearer)throw new GatewayError('Sign in to Gumbo to use this.',401,'signed_out');
 const {gateway}=await endpoints(),started=Date.now();
 let result:Awaited<ReturnType<typeof callGateway>>;
 try{result=await callGateway(gateway,bearer,call,options);}
 catch(error){
  if(!(error instanceof GatewayError&&error.status===401&&!options.signal?.aborted))throw error;
  const fresh=await refresh();if(!fresh)throw error;
  result=await callGateway(gateway,fresh.access_token,call,options);
 }
 // What each call cost, by what it was for (the debug page sums them per day): every surface, the background too.
 const usage=(result as any)?.message?.usage;if(usage)void addTiming({surface:`cost-${call.purpose}`,ms:Date.now()-started,at:Date.now(),usd:usageCost(call.model,usage)});
 return result;
}
