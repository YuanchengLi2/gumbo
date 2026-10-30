import {pageModel,deepQuery,idOf,describe,type Item} from './perceive';
import {nameOf,squash,cut,visible,roleOf} from './dom';
import {sensitive} from './fields/field';
/** The whole page, for Tab, beside the region where the user is working: Tab must never be trapped in one part of the
 * page (the Continue button in a sticky footer, the banner that just appeared at the top, the link in the sidebar that
 * the task needs). In a few milliseconds and a few kilobytes:
 * - outline: the page's landmarks and headings, in order;
 * - forms: each form with its fields and what is in them (never sensitive fields);
 * - said: what the page is telling them now (alerts, status and live regions, banners, toasts, open dialogs, and text
 *   that just appeared where they are working), its own feedback;
 * - rest: everything else one can act on, compactly, each marked when it is a main action (submit, next, continue,
 *   save, send, a button styled as primary) or in view. The engine picks from these what bears on the moment.
 * Each element keeps its id (perceive.ts), so a move may go to anything on the page. */
export type Digest={outline:string[];forms:string[];said:string[];rest:(Pick<Item,'id'|'role'|'name'|'value'|'state'|'inView'|'nearby'>&{main?:boolean})[]};
const primaryWords=/^(submit|next|continue|save|send|done|finish|check( answer)?|confirm|apply|search|post|reply|publish|create|add|update|start|go|ok|proceed|place order|pay|checkout|sign up|log ?in|sign in)\b/i;
const feedbackSelector='[role=alert],[role=status],[aria-live]:not([aria-live=off]),[role=alertdialog],dialog[open],[role=dialog],[class*=toast i],[class*=snackbar i],[class*=banner i],[class*=alert i],[class*=error i],[class*=success i],[class*=feedback i],[class*=notice i]';
/** Text that appeared lately where the user is working (set by the moments: predict.ts), newest last. */
export const appeared:{at:number;text:string}[]=[];
export function noteAppeared(text:string){const t=cut(squash(text),240);if(t.length<2||appeared.some(a=>a.text===t))return;appeared.push({at:Date.now(),text:t});if(appeared.length>6)appeared.shift();}
const main=(el:Element)=>{
 const name=nameOf(el,60);
 return el instanceof HTMLButtonElement&&el.type==='submit'&&!!el.form||el instanceof HTMLInputElement&&el.type==='submit'||primaryWords.test(name)||/\b(primary|cta)\b/i.test(String((el as HTMLElement).className??''));
};
export function digestOf(region?:Element|null,exclude=new Set<string>()):Digest{
 const outline:string[]=[];
 for(const el of deepQuery('header,nav,main,aside,footer,[role=banner],[role=navigation],[role=main],[role=complementary],[role=contentinfo],[role=search],h1,h2,h3,dialog[open],[role=dialog]',document,6000)){
  if(outline.length>=30)break;if(!visible(el))continue;
  const tag=el.tagName.toLowerCase(),heading=/^h[1-3]$/.test(tag);
  const text=heading?squash(el.textContent??''):nameOf(el,40);
  outline.push(heading?`${'  '.repeat(Number(tag[1])-1)}${tag}: ${cut(text,90)}`:`[${roleOf(el)}${text?` “${cut(text,40)}”`:''}]${region&&el.contains(region)?' ← they are here':''}`);
 }
 const forms:string[]=[];
 for(const f of deepQuery('form,[role=form]',document,3000).filter(visible).slice(0,6)){
  const fields=[...f.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),textarea,select,[contenteditable=true],[role=textbox]')].filter(el=>visible(el)&&!sensitive(el as HTMLElement)).slice(0,12);
  if(!fields.length)continue;
  const values=fields.map(el=>{const v=el instanceof HTMLInputElement&&/checkbox|radio/.test(el.type)?(el.checked?'checked':'not checked'):el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement?el.value:el instanceof HTMLSelectElement?el.selectedOptions[0]?.text??'':(el as HTMLElement).innerText??'';return `${nameOf(el,40)||el.getAttribute('name')||'field'} [${idOf(el)}] = ${v?`“${cut(squash(v),60)}”`:'(empty)'}`;});
  forms.push(`${nameOf(f,40)||'form'}${region&&(f.contains(region)||region.contains(f))?' (where they are)':''}: ${values.join('; ')}`);
 }
 const said=saidNow();
 // Everything one can act on, and the page's main actions wherever they are (a long page's footer button included).
 const mains=deepQuery('button,input[type=submit],[role=button],a[href]',document,6000).filter(el=>visible(el)&&main(el)).slice(0,30);
 const mainIds=new Set(mains.map(el=>idOf(el)));
 const all=[...pageModel(220).items,...mains.map(el=>describe(el))];
 const rest:Digest['rest']=[],kept=new Set<string>();
 for(const {id,role,name,value,state,inView,nearby} of all){if(exclude.has(id)||kept.has(id))continue;kept.add(id);rest.push({id,role,name,value,state,inView,nearby,...(mainIds.has(id)?{main:true}:{})});}
 return{outline,forms,said,rest};
}
/** What the page is telling them now: alerts, status and live regions, banners, toasts, open dialogs, and text that just
 * appeared where they are working; at most eight. */
export function saidNow():string[]{
 const said:string[]=[];
 for(const el of deepQuery(feedbackSelector,document,6000)){
  if(said.length>=6)break;if(!visible(el))continue;
  const text=cut(squash((el as HTMLElement).innerText??''),240);if(text.length<2||said.some(s=>s.includes(text)||text.includes(s)))continue;
  said.push(text);
 }
 for(const a of appeared)if(Date.now()-a.at<30_000&&!said.some(s=>s.includes(a.text)))said.push(`(just appeared) ${a.text}`);
 return said.slice(0,8);
}
