import {useEffect,useState} from 'react';
import type {BillingSummary} from '@dream/contracts';

/** The plan and credits, for the profile menu and Settings > Usage and billing: asked of the gateway when something shows
 * it, again when the window comes back to the front (paying happens in the browser, so that is when a new plan or credits
 * arrive), and after Gumbo AI finishes a request. undefined while loading; null when signed out; unavailable when the
 * gateway is older than billing. */
export type Billing=BillingSummary|{unavailable:true}|null|undefined;
let current:Billing,loading:Promise<void>|undefined;const listeners=new Set<()=>void>();
const notify=()=>listeners.forEach(l=>l());
export function refreshBilling(){
 loading??=window.dream.command<Billing>({type:'account',action:'billing'}).then(b=>{current=b;},()=>{current=current??{unavailable:true};}).finally(()=>{loading=undefined;notify();});
 return loading;
}
let wired=false;
function wire(){
 if(wired)return;wired=true;
 window.addEventListener('focus',()=>{if(listeners.size)void refreshBilling();});
 window.dream.onEvent(raw=>{const event=raw as {type?:string;payload?:{status?:string}};if(event.type==='account.signed_in'||event.type==='app.link'||event.type==='ai.status'&&event.payload?.status!=='running')void refreshBilling();});
}
export function useBilling(){
 const [value,setValue]=useState(current);
 useEffect(()=>{wire();const update=()=>setValue(current);listeners.add(update);void refreshBilling();return()=>{listeners.delete(update);};},[]);
 return value;
}
export const billingReady=(b:Billing):b is BillingSummary=>!!b&&!('unavailable' in b);
/** Opens Stripe in the browser: Checkout for a plan or packs of credits, or the portal to manage the plan. */
export const choosePlan=(plan:'pro'|'max'|'max20')=>window.dream.command({type:'account',action:'checkout',plan});
export const buyCredits=(packs=1)=>window.dream.command({type:'account',action:'checkout',packs});
export const manageBilling=()=>window.dream.command({type:'account',action:'portal'});
export const credits=(n:number)=>Math.max(0,Math.floor(n)).toLocaleString();
