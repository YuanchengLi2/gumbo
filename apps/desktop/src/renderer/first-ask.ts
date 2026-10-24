/** A request typed on usegumbo.app before Gumbo opened (/app/?ask=…). It is kept for this tab through the onboarding
 * and the sign-in page's round trip, then put in the home screen's box (the gumbo:prompt event), ready to send. */
const key='gumbo-first-ask',filesKey='gumbo-home-paths';
/** Files the site copied into this browser's storage for the request (&files=[…], assets/ask-files.js): only paths in
 * the imports folder the app's own picker uses are taken. */
const imported=(path:unknown):path is string=>typeof path==='string'&&/^\/imports\/[\w-]+\/[^/\\]+$/.test(path)&&!path.includes('..');
/** Moves ?ask= and &files= from the address into this tab's storage, so a reload or the sign-in's return does not bring
 * them back. */
export function takeAskFromAddress(){
 try{const here=new URL(location.href),ask=here.searchParams.get('ask')?.trim().slice(0,2000),files=here.searchParams.get('files');
  if(!here.searchParams.has('ask')&&!files)return;
  here.searchParams.delete('ask');here.searchParams.delete('files');history.replaceState(history.state,'',here.toString());if(ask)sessionStorage.setItem(key,ask);
  if(files){const paths=(JSON.parse(files) as unknown[]).filter(imported).slice(0,50);if(paths.length)keepHomePaths([...new Set([...homePaths(),...paths])]);}}catch{}
}
export function firstAsk(){try{return sessionStorage.getItem(key)??'';}catch{return '';}}
export function forgetFirstAsk(){try{sessionStorage.removeItem(key);}catch{}}
/** Puts the waiting request in the home screen's box; false when there was none. */
export function deliverFirstAsk(){const ask=firstAsk();if(!ask)return false;forgetFirstAsk();window.dispatchEvent(new CustomEvent('gumbo:prompt',{detail:ask}));return true;}
/** The files waiting in the home screen's box, kept for this tab: signing in leaves the page and comes back. */
export function homePaths():string[]{try{const paths=JSON.parse(sessionStorage.getItem(filesKey)??'[]');return Array.isArray(paths)?paths.filter(path=>typeof path==='string'):[];}catch{return [];}}
export function keepHomePaths(paths:string[]){try{if(paths.length)sessionStorage.setItem(filesKey,JSON.stringify(paths));else sessionStorage.removeItem(filesKey);}catch{}}
// Read once, as the editor loads, before the onboarding decides what to say.
takeAskFromAddress();
