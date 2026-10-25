import {endpoints} from '../shared/config';
import {callGateway,GatewayError,type GatewayCall,type CallOptions} from '../shared/gateway';
import {token,refresh} from './auth';
/** A model call as the signed-in user: the gateway with a current token, asked once more with a fresh one if the
 * gateway says the session expired. */
export async function model(call:GatewayCall,options:CallOptions={}){
 const bearer=await token();if(!bearer)throw new GatewayError('Sign in to Gumbo to use this.',401,'signed_out');
 const {gateway}=await endpoints();
 try{return await callGateway(gateway,bearer,call,options);}
 catch(error){
  if(error instanceof GatewayError&&error.status===401&&!options.signal?.aborted){const fresh=await refresh();if(fresh)return callGateway(gateway,fresh.access_token,call,options);}
  throw error;
 }
}
