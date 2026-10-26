/// <reference types="chrome" />
import {roleOf,nameOf,deepActive,visible} from './dom';
import {describe} from './perceive';
import {fieldOf,inPaymentFrame} from './fields/field';
import {findTarget,perform,irreversible} from './act';
import {surface,layer} from './ui/root';
import {ghostShown} from './ui/ghost';
import {post,ask} from './port';
import {loadSettings,onSettings,activeOn,type Settings} from '../shared/settings';
import type {Step} from '../shared/learn';
/** Tab for actions in a page. Each click on something actionable is reported (by its role, name and the words around
 * it, never what was typed). When the page has settled, and a moment after each click, the engine is asked for the
 * user's usual next step here; if it has one, a chip shows it near what was just clicked (or in the corner). Tab runs it
 * (a click, checked; or the page it opens); a final step (send, delete…) asks for Enter first; Esc dismisses. A chip
 * never shows while a field has the focus, where Tab moves between fields, or while a text suggestion shows. */
let settings:Settings|undefined,chip:HTMLDivElement|null=null,offer:{step:Step;label:string;confirm?:boolean}|null=null,timer:number|undefined,seq=0,lastTyped=0,anchor:Element|null=null;
const active=()=>!!settings&&activeOn(settings,location.hostname)&&!inPaymentFrame();
const actionable='a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],summary,input[type=submit],input[type=button],input[type=checkbox],input[type=radio],label';

export function startChips(){
 void loadSettings().then(s=>{settings=s;});onSettings(s=>{settings=s;if(!active())hide();});
 document.addEventListener('click',onClick,true);
 document.addEventListener('input',()=>{lastTyped=Date.now();hide();},true);
 window.addEventListener('keydown',onKey,true);
 if(window===window.top)soon(2500);
}
function onClick(event:MouseEvent){
 if(!active()||!event.isTrusted)return;
 const target=(event.composedPath()[0] as Element|undefined)?.closest?.(actionable);
 if(target&&target!==chip&&!fieldOf(target)){
  const item=describe(target);
  if(item.name)post({type:'capture.event',role:roleOf(target),name:item.name,path:item.path,nearby:item.nearby});
  anchor=target;
 }
 hide();if(window===window.top)soon(900);
}
function soon(ms:number){clearTimeout(timer);timer=window.setTimeout(()=>void suggest(),ms);}
const busy=()=>{const a=deepActive();return !!a&&(!!fieldOf(a)||a instanceof HTMLInputElement||a instanceof HTMLSelectElement||a instanceof HTMLTextAreaElement||(a as HTMLElement).isContentEditable)||Date.now()-lastTyped<4000||ghostShown()||document.visibilityState!=='visible';};

async function suggest(){
 if(!active()||busy())return;
 const id=`a${++seq}`,headings=[...document.querySelectorAll('h1,h2')].map(h=>(h.textContent??'').trim()).filter(Boolean).slice(0,8);
 const answer=await ask<{step?:Step;label?:string}>({type:'actions.next',id,title:document.title,headings},'actions.next',6000);
 if(busy()||seq!==Number(id.slice(1)))return;
 if(!answer?.step){const found=onPage();if(found){offer=found;show();}return;}
 // A click that can no longer be found on this page is not offered.
 if(answer.step.kind==='click'&&!findTarget(answer.step.target??{name:answer.step.label}))return;
 offer={step:answer.step,label:answer.label??answer.step.label};show();
}
/** Something on the page that is plainly a next step on its own: a package tracking number (only formats that cannot be
 * anything else) becomes "Track package". One per page, and never on a page where the user has a habit to offer. */
function onPage():{step:Step;label:string}|null{
 const text=(document.querySelector('main,article,[role=main]') as HTMLElement|null)?.innerText??document.body.innerText??'';
 const ups=/\b1Z[0-9A-Z]{16}\b/.exec(text)?.[0],usps=/\b9[2-5]\d{20}\b/.exec(text)?.[0],fedex=/fedex/i.test(text)?/\b\d{12}\b/.exec(text)?.[0]:undefined;
 const [number,url]=ups?[ups,`https://www.ups.com/track?tracknum=${ups}`]:usps?[usps,`https://tools.usps.com/go/TrackConfirmAction?tLabels=${usps}`]:fedex?[fedex,`https://www.fedex.com/fedextrack/?trknbr=${fedex}`]:[];
 if(!number||!url)return null;
 return{step:{kind:'navigate',pageKind:'',key:'track:'+number,label:`Track package ${number}`,url,at:Date.now()},label:`Track package ${number.slice(0,6)}…`};
}
function show(){
 hide(false);if(!offer)return;
 layer();const box=document.createElement('div');box.className='chip';box.setAttribute('role','status');
 const key=document.createElement('kbd');key.textContent=offer.confirm?'Enter':'Tab';
 const text=document.createElement('span');text.className='text';text.textContent=offer.confirm?`to confirm: ${offer.label}`:offer.label;
 box.append(key,text);surface().appendChild(box);chip=box;
 const rect=box.getBoundingClientRect(),near=anchor&&anchor.isConnected&&visible(anchor)?anchor.getBoundingClientRect():null;
 const left=near?Math.min(Math.max(8,near.left),innerWidth-rect.width-12):innerWidth-rect.width-20,top=near?Math.min(near.bottom+8,innerHeight-rect.height-12):innerHeight-rect.height-20;
 box.style.left=`${left}px`;box.style.top=`${top}px`;
}
function hide(clearOffer=true){chip?.remove();chip=null;if(clearOffer)offer=null;}

function onKey(event:KeyboardEvent){
 if(!chip||!offer||event.isComposing)return;
 if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();post({type:'actions.outcome',label:offer.label,outcome:'dismissed'});hide();return;}
 const go=offer.confirm?event.key==='Enter':event.key==='Tab'&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey;
 if(!go){if(!['Shift','Control','Alt','Meta'].includes(event.key)){post({type:'actions.outcome',label:offer.label,outcome:'ignored'});hide();}return;}
 if(busy()&&!offer.confirm)return;
 event.preventDefault();event.stopImmediatePropagation();void run(offer);
}
async function run(current:NonNullable<typeof offer>){
 const {step}=current;
 if(step.kind==='navigate'&&step.url){post({type:'actions.outcome',label:current.label,outcome:'accepted'});hide();post({type:'actions.open',url:step.url});return;}
 const target=step.target??{name:step.label},el=findTarget(target);
 if(!el){hide();post({type:'failure',site:location.hostname,editor:'page',what:'action',detail:`not found: ${step.label}`});return;}
 // A final step (send, delete, pay…) waits for Enter.
 if(!current.confirm&&irreversible({do:'click',target},el)){offer={...current,confirm:true};show();return;}
 hide();
 const done=await perform({do:'click',target});
 post({type:'actions.outcome',label:current.label,outcome:done.ok?'accepted':'ignored'});
 if(!done.ok)post({type:'failure',site:location.hostname,editor:'page',what:'action',detail:done.detail});
 else soon(900);
}
export const chipState=()=>({showing:!!chip,label:offer?.label,confirm:!!offer?.confirm});
export {nameOf};
