/// <reference types="chrome" />
import {surface,layer} from './ui/root';
import {drawnSurface} from './predict';
import {loadSettings,activeOn} from '../shared/settings';
/** A quiet word on a page Gumbo can only see as pixels (a design tool, a sheet, a whiteboard): its words are drawn, not
 * in the page, so Gumbo reads it from pictures and Tab is slower and less exact there. Said once per site (a month), in
 * a small line at the corner that never takes the page's clicks except its own close button, and only after the page
 * has been in front for a few seconds and is mostly drawn with few words of its own. How the page is built decides it,
 * never a list of sites. */
const SHOWN='drawn-notice',QUIET_MS=30*86_400_000,AFTER_MS=5000;
export function startNotice(){
 if(window!==window.top)return;
 const check=async()=>{
  if(document.visibilityState!=='visible'||!drawnSurface()||(document.body?.innerText??'').length>3000)return;
  const settings=await loadSettings();if(!activeOn(settings,location.hostname)||settings.realInput)return;
  const site=location.hostname.replace(/^www\./,''),stored=(await chrome.storage.local.get(SHOWN))[SHOWN] as Record<string,number>|undefined??{};
  if(Date.now()-(stored[site]??0)<QUIET_MS)return;
  await chrome.storage.local.set({[SHOWN]:{...stored,[site]:Date.now()}});
  show();
 };
 const soon=()=>setTimeout(()=>void check().catch(()=>{}),AFTER_MS);
 soon();document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')soon();});
}
function show(){
 layer();
 const box=document.createElement('div');box.className='chip';box.setAttribute('role','status');
 box.style.cssText='right:16px;bottom:16px;display:flex;gap:8px;align-items:flex-start;animation:in .2s ease-out';
 const text=document.createElement('span');text.className='text';
 text.textContent='This page is drawn as pictures, so Gumbo reads it from images here: Tab is slower and less exact. In Gumbo’s menu, “Use real clicks in drawing apps” helps it type and click here.';
 const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Close');
 close.style.cssText='all:unset;cursor:pointer;font-size:15px;line-height:1;color:#888;padding:0 2px';
 close.onclick=()=>box.remove();
 box.append(text,close);surface().appendChild(box);
 setTimeout(()=>box.remove(),20_000);
}
