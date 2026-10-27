import {token} from './auth';
import {endpoints} from '../shared/config';
import {gatewayGet} from '../shared/gateway';
/** Spending Tab's guesses where they count. On the Free plan, or on any plan with less than a sixth of its credits left,
 * Tab makes no guess ahead of the user (the page opening, the pointer resting on a field, typing not yet paused, coming
 * back to a tab): it guesses only once they act, which is what they see. Credits are read from the gateway every ten
 * minutes; until they are known, Tab spends as usual. */
let known:{at:number;thrifty:boolean}|undefined,asking:Promise<boolean>|undefined;
export async function thrifty():Promise<boolean>{
 if(known&&Date.now()-known.at<600_000)return known.thrifty;
 return asking??=(async()=>{
  try{
   const bearer=await token();if(!bearer)return false;
   const {gateway}=await endpoints();
   const b=await gatewayGet(gateway,bearer,'billing') as {plan?:string;credits?:{left?:number;planTotal?:number}};
   const left=b.credits?.left??0,total=b.credits?.planTotal??0;
   known={at:Date.now(),thrifty:b.plan==='free'||(total>0&&left<total/6)};return known.thrifty;
  }catch{return known?.thrifty??false;}
  finally{asking=undefined;}
 })();
}


