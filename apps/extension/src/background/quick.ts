import {on} from './surfaces';
import {recent,type Writing} from './db';
import {profile} from './memory/profile';
import {loadSettings,activeOn,siteOf} from '../shared/settings';
/** Tab's instant answer, before any model: in a few milliseconds, from what the user wrote before on this computer.
 * - the word being typed, finished: the word of theirs that starts this way and that they use most here (by site and
 *   kind of field, then anywhere);
 * - their own phrases: after two words they often follow with the same words, those words (a sign-off, "let me know if",
 *   their usual "Thanks so much,"), while it stays that sure;
 * - the facts a field asks for, in an empty field: their email, phone, address or booking link.
 * It shows at once; the model's suggestion replaces it when it comes. */
type Stats={at:number;words:Map<string,Map<string,number>>;next:Map<string,Map<string,Map<string,number>>>};
let stats:Stats|undefined;
const scopeKeys=(w:{site:string;intent:string})=>[`${w.intent}|${w.site}`,w.intent,'*'];
async function load():Promise<Stats>{
 if(stats&&Date.now()-stats.at<60_000)return stats;
 const words=new Map<string,Map<string,number>>(),next=new Map<string,Map<string,Map<string,number>>>();
 const bump=<K>(m:Map<string,K>,k:string,make:()=>K)=>{let v=m.get(k);if(!v){v=make();m.set(k,v);}return v;};
 for(const w of await recent('writing',1500).catch(()=>[] as Writing[])){
  const tokens=w.text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*|[.,!?;:]|\n/gu)??[];
  for(const scope of scopeKeys(w)){
   const counts=bump(words,scope,()=>new Map<string,number>());
   for(const t of tokens)if(t.length>3&&/\p{L}/u.test(t))counts.set(t,(counts.get(t)??0)+1);
   const pairs=bump(next,scope,()=>new Map<string,Map<string,number>>());
   for(let i=0;i+2<tokens.length;i++){const key=`${tokens[i].toLowerCase()} ${tokens[i+1].toLowerCase()}`,after=bump(pairs,key,()=>new Map<string,number>());after.set(tokens[i+2],(after.get(tokens[i+2])??0)+1);}
  }
 }
 return stats={at:Date.now(),words,next};
}
export function forgetQuick(){stats=undefined;}
const glue=(prev:string,t:string)=>/^[.,!?;:]$/.test(t)||t==='\n'||prev.endsWith('\n')?t:' '+t;
export async function quickFor(input:{before:string;after:string;site:string;intent:string;label:string;singleLine:boolean}):Promise<string>{
 const s=await load(),scopes=scopeKeys(input),before=input.before;
 if(/^[\p{L}\p{N}]/u.test(input.after))return '';
 // An empty field that asks for one of their facts.
 if(!before.trim()){
  const [p,settings]=await Promise.all([profile(),loadSettings()]),label=input.label.toLowerCase();
  if(/e-?mail/.test(label)&&settings.facts.email)return settings.facts.email;
  const kind=/address|street/.test(label)?'address':/phone|mobile/.test(label)?'phone':/link|url|website|calendar/.test(label)?'link':/e-?mail/.test(label)?'email':'';
  return kind?p.facts.find(f=>f.kind===kind)?.text??'':'';
 }
 // The word being typed.
 const partial=/([\p{L}][\p{L}\p{N}'’-]{1,})$/u.exec(before)?.[1];
 if(partial){
  for(const scope of scopes){
   const counts=s.words.get(scope);if(!counts)continue;
   let best='',n=0;for(const [w,c] of counts)if(c>=2&&w.length>=partial.length+2&&w.toLowerCase().startsWith(partial.toLowerCase())&&c>n){best=w;n=c;}
   if(best)return best.slice(partial.length);
  }
  return '';
 }
 // Their own phrase after the last two words, while it stays sure (at least three times, two in three).
 const tokens=before.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*|[.,!?;:]|\n/gu)??[];if(tokens.length<2||!/\s$/.test(before))return '';
 for(const scope of scopes){
  const pairs=s.next.get(scope);if(!pairs)continue;
  let a=tokens.at(-2)!.toLowerCase(),b=tokens.at(-1)!.toLowerCase(),out='';
  for(let i=0;i<6;i++){
   const after=pairs.get(`${a} ${b}`);if(!after)break;
   const total=[...after.values()].reduce((x,y)=>x+y,0),[t,c]=[...after].sort((x,y)=>y[1]-x[1])[0];
   if(c<3||c/total<0.66||input.singleLine&&t==='\n')break;
   out+=out?glue(out,t):t;a=b;b=t.toLowerCase();
  }
  if(out)return out;
 }
 return '';
}
on('tab.quick',async(m:{id:string;before:string;after:string;site:string;intent:string;label:string;singleLine:boolean},{send,url})=>{
 const settings=await loadSettings();if(!activeOn(settings,siteOf(url)||m.site)){send({type:'tab.quick',id:m.id,text:''});return;}
 send({type:'tab.quick',id:m.id,text:await quickFor(m).catch(()=>'')});
});
