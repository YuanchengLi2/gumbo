/** A request typed on usegumbo.app before Gumbo opened (/app/?ask=…). It is kept for this tab through the onboarding
 * and the sign-in page's round trip, then put in the home screen's box (the gumbo:prompt event), ready to send. */
const key='gumbo-first-ask';
/** Moves ?ask= from the address into this tab's storage, so a reload or the sign-in's return does not bring it back. */
export function takeAskFromAddress(){
 try{const here=new URL(location.href),ask=here.searchParams.get('ask')?.trim().slice(0,2000);if(!here.searchParams.has('ask'))return;
  here.searchParams.delete('ask');history.replaceState(history.state,'',here.toString());if(ask)sessionStorage.setItem(key,ask);}catch{}
}
export function firstAsk(){try{return sessionStorage.getItem(key)??'';}catch{return '';}}
export function forgetFirstAsk(){try{sessionStorage.removeItem(key);}catch{}}
/** Puts the waiting request in the home screen's box; false when there was none. */
export function deliverFirstAsk(){const ask=firstAsk();if(!ask)return false;forgetFirstAsk();window.dispatchEvent(new CustomEvent('gumbo:prompt',{detail:ask}));return true;}
// Read once, as the editor loads, before the onboarding decides what to say.
takeAskFromAddress();
