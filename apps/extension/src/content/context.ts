import type {Field,Editor} from './fields/field';
import {sensitive} from './fields/field';
import {nameOf,squash,cut,roleOf,visible} from './dom';
/** What a field is for and what surrounds it, read the same way on every site:
 * - intent, from the field's label, the form around it and the words on the button that sends it;
 * - the conversation above it: the nearest list of repeated blocks of the same shape (a message, a comment, a tweet);
 * - the document it is in: headings, for a long editor;
 * - the page: its title and main text, for a reply to an article or a post. */
export type Intent='email'|'chat'|'prompt'|'search'|'comment'|'post'|'document'|'form'|'code'|'other';
export type Message={author?:string;text:string};
export type FieldContext={
 site:string;url:string;title:string;language:string;
 editor:Editor;singleLine:boolean;intent:Intent;
 /** The field's label or placeholder, and the button that sends it. */
 label:string;action?:string;
 /** Other fields of the same form (never sensitive ones) with what is in them. */
 form?:{label:string;value:string}[];
 thread?:Message[];headings?:string[];page?:string;
};

const aiHosts=/(^|\.)(claude\.ai|chatgpt\.com|chat\.openai\.com|gemini\.google\.com|perplexity\.ai|copilot\.microsoft\.com|poe\.com|chat\.deepseek\.com|grok\.com|meta\.ai|chat\.mistral\.ai)$/;
const cache=new WeakMap<HTMLElement,{at:number;value:Omit<FieldContext,'url'|'title'>}>();

export function readContext(field:Field):FieldContext{
 const now=Date.now(),hit=cache.get(field.el),doc=field.el.ownerDocument;
 const base={url:location.href,title:doc.title};
 // The surroundings change slowly; reading them is the expensive part, so they are kept for a few seconds.
 if(hit&&now-hit.at<4000)return{...hit.value,...base};
 const label=labelOf(field),action=actionOf(field.el),form=formOf(field.el),site=location.hostname.replace(/^www\./,'');
 const intent=intentOf(field,label,action,form,site);
 const thread=['email','chat','comment','post','other','prompt'].includes(intent)?threadAbove(field.el):undefined;
 const headings=intent==='document'?headingsOf(field.el):undefined;
 const page=['comment','post','other','document','email'].includes(intent)&&!thread?.length?mainText(doc):undefined;
 const value={site,language:(field.el.closest('[lang]')?.getAttribute('lang')||doc.documentElement.lang||'').slice(0,12),editor:field.editor,singleLine:field.singleLine,intent,label,action,form,thread,headings,page};
 cache.set(field.el,{at:now,value});
 return{...value,...base};
}

export function labelOf(field:Field):string{
 const el=field.el,name=nameOf(el,100);
 const placeholder=el.getAttribute('placeholder')??el.getAttribute('aria-placeholder')??el.getAttribute('data-placeholder')??el.querySelector('[data-placeholder]')?.getAttribute('data-placeholder')??'';
 const legend=el.closest('fieldset')?.querySelector('legend')?.textContent??'';
 return cut([name,placeholder!==name?placeholder:'',legend].map(s=>squash(s)).filter(Boolean).join(' · '),160);
}
/** The words on the button that sends what is typed here: in the form, or near the field in the same container. */
export function actionOf(el:HTMLElement):string|undefined{
 const words=/^(send|reply|reply all|post|comment|tweet|publish|share|submit|save|search|ask|update|add comment|respond)\b/i;
 const scope=el.closest('form')??nearestContainer(el,4);
 if(!scope)return;
 const buttons=[...scope.querySelectorAll<HTMLElement>('button,[role=button],input[type=submit]')].filter(b=>!b.contains(el)).slice(0,60);
 const named=buttons.map(b=>({b,name:nameOf(b,40)})).filter(x=>words.test(x.name));
 return named.length?named[0].name:undefined;
}
function nearestContainer(el:HTMLElement,levels:number):Element|null{let node:Element|null=el;for(let i=0;i<levels&&node;i++)node=node.parentElement;return node;}
function formOf(el:HTMLElement):FieldContext['form']{
 const form=el.closest('form,[role=dialog],[role=form]');if(!form)return;
 const fields=[...form.querySelectorAll<HTMLElement>('input,textarea,select,[contenteditable=true],[role=textbox]')].filter(f=>f!==el&&!el.contains(f)&&!f.contains(el)&&!(f instanceof HTMLInputElement&&['hidden','submit','button','checkbox','radio','file','image','reset'].includes(f.type))&&!sensitive(f)).slice(0,10);
 const out=fields.map(f=>({label:nameOf(f,50)||f.getAttribute('name')||'',value:cut(squash(f instanceof HTMLInputElement||f instanceof HTMLTextAreaElement?f.value:f instanceof HTMLSelectElement?f.selectedOptions[0]?.text??'':f.innerText??''),120)})).filter(f=>f.label||f.value);
 return out.length?out:undefined;
}
export function intentOf(field:Field,label:string,action:string|undefined,form:FieldContext['form'],site:string):Intent{
 const el=field.el,text=`${label} ${el.getAttribute('name')??''} ${el.id}`.toLowerCase(),act=(action??'').toLowerCase();
 if(field.editor==='codemirror'||field.editor==='monaco'||/monospace|consolas|courier|menlo|mono\b/i.test(getComputedStyle(el).fontFamily)&&field.kind==='text'&&!field.singleLine)return 'code';
 if((el instanceof HTMLInputElement&&el.type==='search')||roleOf(el)==='searchbox'||el.closest('[role=search]')||/\bsearch\b|^\s*(q|query|keywords?)\b/.test(text)||act==='search')return 'search';
 const formLabels=(form??[]).map(f=>f.label.toLowerCase()).join(' ');
 if(/message body|^body\b/.test(text)||/\bsubject\b/.test(formLabels)&&/\b(to|recipients?|cc)\b/.test(formLabels))return 'email';
 if(aiHosts.test(site)||/\b(ask|message (claude|chatgpt|gemini|copilot)|ask anything|how can i help|send a message to)\b/.test(text))return 'prompt';
 if(/\b(comment|reply|respond)\b/.test(act)||/\b(add a comment|write a comment|reply|leave a comment|your answer)\b/.test(text))return 'comment';
 if(/\b(post|tweet|publish|share)\b/.test(act)||/what's happening|what is happening|start a post|what's on your mind|write a post/.test(text))return 'post';
 if(/\bsend\b/.test(act)||/\b(message|write a message|type a message|send a message|chat)\b/.test(text))return 'chat';
 if(field.kind==='editable'&&(el.getBoundingClientRect().height>220||el.querySelectorAll('p,h1,h2,h3,li').length>4))return 'document';
 if(el.closest('form')&&field.singleLine)return 'form';
 if(!field.singleLine&&el.getBoundingClientRect().height>160)return 'document';
 return 'other';
}

/** The conversation above a field: the nearest container (above it on screen) whose children repeat one shape and hold
 * text, read newest last, each with its author when one stands out. */
export function threadAbove(el:HTMLElement,limit=10):Message[]|undefined{
 const top=el.getBoundingClientRect().top+4;let best:{list:Element;items:Element[];score:number}|undefined;
 let node:Element|null=el;
 for(let depth=0;node&&depth<12&&!best;depth++,node=node.parentElement){
  const parent:Element|null=node.parentElement;if(!parent)break;
  for(const sibling of [...parent.children].reverse()){
   if(sibling===node||sibling.contains(el))continue;
   if(sibling.getBoundingClientRect().top>top)continue;
   const found=repeated(sibling,top);if(found&&(!best||found.score>best.score))best=found;
  }
 }
 if(!best)return;
 return best.items.slice(-limit).map(item=>{const text=cut(squash((item as HTMLElement).innerText??''),700);return{author:authorOf(item),text};}).filter(m=>m.text.length>1);
}
/** The best list of repeated blocks within an element (searched a few levels deep). */
function repeated(root:Element,top:number):{list:Element;items:Element[];score:number}|undefined{
 const queue:[Element,number][]=[[root,0]];let best:{list:Element;items:Element[];score:number}|undefined,seen=0;
 while(queue.length&&seen<400){
  const [el,depth]=queue.shift()!;seen++;
  const children=[...el.children].filter(c=>c.getBoundingClientRect().top<top&&visible(c));
  if(children.length>=2){
   const groups=new Map<string,Element[]>();for(const c of children){const key=shape(c);groups.set(key,[...(groups.get(key)??[]),c]);}
   for(const items of groups.values()){
    if(items.length<2)continue;
    const texts=items.slice(-8).map(i=>squash((i as HTMLElement).innerText??'').length);
    if(texts.filter(n=>n>=12).length<Math.min(2,items.length))continue;
    const role=el.getAttribute('role')??'',bonus=/log|feed|list|grid|main/.test(role)?2:0,scroll=el.scrollHeight>el.clientHeight+20?1:0;
    const score=Math.min(items.length,12)+bonus+scroll-depth*0.3;
    if(!best||score>best.score)best={list:el,items,score};
   }
  }
  if(depth<5)for(const c of children)queue.push([c,depth+1]);
 }
 return best;
}
/** What makes list items the same kind: tag, role and the classes that are not states. */
function shape(el:Element){return el.tagName+'|'+(el.getAttribute('role')??'')+'|'+[...el.classList].filter(c=>!/active|selected|hover|focus|unread|\d{3,}/.test(c)).sort().slice(0,4).join('.');}
function authorOf(item:Element):string|undefined{
 const named=item.querySelector('[data-testid*=author i],[data-testid*=name i],[class*=author i],[class*=sender i],[class*=username i],[class*=user-name i],strong,b,h3,h4');
 const text=squash((named as HTMLElement|null)?.innerText??'');if(text&&text.length<=40)return text;
 const first=squash(((item as HTMLElement).innerText??'').split('\n')[0]??'');return first.length>=2&&first.length<=32&&!/[.!?]$/.test(first)?first:undefined;
}
function headingsOf(el:HTMLElement){
 const scope=el.querySelectorAll('h1,h2,h3').length?el:el.ownerDocument.querySelector('main,article,[role=main]')??el.ownerDocument.body;
 const out=[...scope.querySelectorAll('h1,h2,h3')].map(h=>squash(h.textContent??'')).filter(Boolean).slice(0,10);
 return out.length?out:undefined;
}
/** The page's main text: its main, article or the block with the most paragraph text. */
export function mainText(doc:Document,max=1500):string|undefined{
 let root:Element|null=doc.querySelector('article,main,[role=main]');
 if(!root){let bestLength=0;for(const block of doc.querySelectorAll('div,section')){const length=[...block.querySelectorAll(':scope > p')].reduce((n,p)=>n+(p.textContent?.length??0),0);if(length>bestLength){bestLength=length;root=block;}}}
 const text=squash((root as HTMLElement|null)?.innerText??'');return text?cut(text,max):undefined;
}
