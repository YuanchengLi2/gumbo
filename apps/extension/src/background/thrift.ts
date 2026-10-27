import {token} from './auth';
import {endpoints} from '../shared/config';
import {gatewayGet} from '../shared/gateway';
/** Spending Tab's last credits where they count. With less than a sixth of a plan's credits left (Free included: it is
 * for trying Gumbo, and guesses made ahead are what make it feel instant), Tab makes no guess ahead of the user (the page
 * opening, the pointer resting on a field, typing not yet paused, coming back to a tab): it guesses only once they act,
 * which is what they see. Credits are read from the gateway every ten minutes; until they are known, Tab spends as
 * usual. */
let known:{at:number;thrifty:boolean}|undefined,asking:Promise<boolean>|undefined;
export async function thrifty():Promise<boolean>{
 if(known&&Date.now()-known.at<600_000)return known.thrifty;
 return asking??=(async()=>{
  try{
   const bearer=await token();if(!bearer)return false;
   const {gateway}=await endpoints();
   const b=await gatewayGet(gateway,bearer,'billing') as {credits?:{left?:number;planTotal?:number}};
   const left=b.credits?.left??0,total=b.credits?.planTotal??0;
   known={at:Date.now(),thrifty:total>0&&left<total/6};return known.thrifty;
  }catch{return known?.thrifty??false;}
  finally{asking=undefined;}
 })();
}


