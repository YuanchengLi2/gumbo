/** The facts on a page, read from its words at no model cost: what it labels ("Total due: $482.00", a cell under its
 * column, a term and its definition) and the values that have a shape of their own (money, dates and times, order,
 * tracking and booking numbers, flight numbers, emails, phones, street addresses, links). Each is a key (the page's own
 * label when it has one, else what kind of value it is), the value as written, and the words near it (its line, row or
 * section), so memory can hand Tab "Total due: $482.00" itself rather than the top of the page it was on. Nothing that
 * reads as a secret is kept: passwords, codes, card and account numbers (by their label or their shape). */
export type Fact={key:string;value:string;near?:string};
/** A line of a page's text: a heading names the section below it; a structured line (a data table's, a definition
 * list's) was read for its facts by its structure already. */
export type Line={text:string;heading?:boolean;structured?:boolean};

const MAX_KEY=60,MAX_VALUE=200,MAX_NEAR=200;
const cut=(s:string,n:number)=>s.length>n?s.slice(0,n-1).trimEnd()+'…':s;
const squash=(s:string)=>s.replace(/\s+/g,' ').trim();
const bare=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
/** A fact as one line of text, for search and for prompts (its near words only when they add something). */
export const factText=(f:Fact)=>`${f.key}: ${f.value}${f.near&&bare(f.near)!==bare(f.key+f.value)&&bare(f.near)!==bare(f.value)?` (${f.near})`:''}`;

/** Labels and values that are secrets, or that let someone into an account. */
const SECRET=/pass(word|code|phrase)|\bpin\b|\bcvv|\bcvc|security code|card (number|no)|credit card|debit card|\bssn\b|social security|routing|account (number|no)|\biban\b|\bswift\b|secret|token|api key|one[- ]time|\botp\b|verification code|2fa|recovery code|login code/i;
function luhn(digits:string){let sum=0;for(let i=0;i<digits.length;i++){let d=+digits[digits.length-1-i];if(i%2){d*=2;if(d>9)d-=9;}sum+=d;}return sum%10===0;}
/** A value that looks like a card number (13 to 19 digits that pass the card checksum) or a US social security number. */
function secretShape(value:string){
 if(/\b\d{3}-\d{2}-\d{4}\b/.test(value))return true;
 for(const m of value.matchAll(/(?:\d[ -]?){13,19}/g)){const d=m[0].replace(/\D/g,'');if(d.length>=13&&d.length<=19&&luhn(d))return true;}
 return false;
}
export const secret=(key:string,value:string,near='')=>SECRET.test(key)||SECRET.test(value)||secretShape(value)||SECRET.test(near.slice(0,80))&&!/[$€£¥]/.test(value);
/** A fact, cleaned and cut to size; none when it is empty or reads as a secret. */
export function fact(key:string,value:string,near?:string):Fact|undefined{
 key=cut(squash(key).replace(/[\s:#\-–—·|]+$/,''),MAX_KEY);value=cut(squash(value),MAX_VALUE);near=near?cut(squash(near),MAX_NEAR):undefined;
 if(!key||!value||bare(key)===bare(value)||secret(key,value,near))return;
 return near&&near!==value?{key,value,near}:{key,value};
}

const MONTH='(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAY='(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|rsday|urday|sday)?\\.?,?\\s+)?';
const TIME='\\d{1,2}:\\d{2}(?:\\s?[ap]\\.?m\\.?)?|\\d{1,2}\\s?[ap]\\.?m\\.?';
const DATE=`${WEEKDAY}(?:${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?(?:,?\\s+\\d{4})?|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{2,4})`;
// Written either way ("Street", "street"), while the rest of an address keeps its capitals.
const STREET=`(?:${'street st avenue ave road rd boulevard blvd lane ln drive dr way court ct place pl terrace ter parkway pkwy highway hwy square sq circle cir close crescent row walk'.split(' ').map(w=>`[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`).join('|')})`;
const ID_WORD='order|tracking|confirmation|booking|reservation|reference|ref|invoice|receipt|ticket|case|customer|member|policy|claim|shipment|transaction|pnr|record locator|bill|statement|quote|po';
type Typed={type:string;re:RegExp;ok?:(m:RegExpExecArray,line:string)=>boolean;key?:(m:RegExpExecArray)=>string;value?:(m:RegExpExecArray)=>string};
/** The kinds of value with a shape of their own, in the order they are looked for (an email before the words in it, an
 * order number before the digits in it). */
const TYPES:Typed[]=[
 {type:'Email',re:/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g},
 {type:'Link',re:/\bhttps?:\/\/[^\s<>"')\]]+/g,ok:m=>!/[?&](token|auth|code|key|sig|signature|session|otp|reset)=/i.test(m[0])},
 {type:'Amount',re:/(?:[$€£¥₹]\s?-?\d[\d,]*(?:\.\d{1,2})?|\b(?:usd|eur|gbp|cad|aud|jpy|inr|chf)\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:usd|eur|gbp|cad|aud|jpy|inr|chf|dollars|euros|pounds)\b)/gi},
 // An order, tracking or booking number: the word that names it, then the number (with a digit, or a code in capitals).
 {type:'Number',re:new RegExp(`\\b(${ID_WORD})\\b(?:\\s+(number|no\\.?|num|id|code|#))?\\s*(?::|#|is)?\\s*#?\\s*([A-Z0-9][A-Z0-9-]{3,34})\\b`,'gi'),
  ok:m=>/\d/.test(m[3])||/^[A-Z0-9-]{5,}$/.test(m[3]),
  key:m=>`${m[1]===m[1].toUpperCase()?m[1]:m[1][0].toUpperCase()+m[1].slice(1).toLowerCase()} ${/code|id/i.test(m[2]??'')?m[2].toLowerCase():'number'}`,value:m=>m[3]},
 // Carriers' own shapes: UPS's 1Z…, and long runs of digits where the line speaks of shipping.
 {type:'Tracking number',re:/\b1Z[0-9A-Z]{16}\b|\b\d{12,22}\b/g,ok:(m,line)=>m[0].startsWith('1Z')||/track|ship|deliver|carrier|usps|fedex|ups|dhl/i.test(line)},
 // A flight: an airline's two-character code and one to four digits, only where the line speaks of flying.
 {type:'Flight',re:/\b(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\s?\d{1,4}\b/g,ok:(m,line)=>/flight|airline|airways|air lines|depart|arriv|boarding|gate|terminal|seat|layover|nonstop|\b[A-Z]{3}\s?(→|->|–|-|to)\s?[A-Z]{3}\b/i.test(line)&&!/^\d/.test(m[0])},
 {type:'Date',re:new RegExp(`\\b(?:${DATE})(?:,?\\s+(?:at\\s+)?(?:${TIME}))?(?:\\s?[-–]\\s?(?:${TIME}))?|\\b(?:${TIME})(?![\\w:])`,'gi')},
 {type:'Phone',re:/(?:\+\d{1,3}[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\+\d{1,3}(?:[\s.-]?\d{2,4}){2,4}\b/g},
 {type:'Address',re:new RegExp(`\\b\\d{1,6}\\s+(?:[A-Z][\\w.'-]*\\s+){1,4}${STREET}\\b\\.?(?:,?\\s+(?:apt|suite|unit|#)\\.?\\s*\\w+)?(?:,\\s*[A-Z][\\w .'-]{1,30}?(?:,\\s*[A-Z]{2})?(?:\\s+\\d{5}(?:-\\d{4})?)?(?=$|[,.;\\s]))?`,'g')},
];
/** A short run of words that names what follows: "Total due", "Departs", "Order #". */
const LABEL=/^[\p{L}][\p{L}\p{N} '&/()#.-]{0,40}$/u;
export function labelOf(s:string){const t=s.trim().replace(/[\s:#\-–—·|]+$/,'');return t.length>=2&&LABEL.test(t)&&t.split(/\s+/).length<=5&&!/[.!?]$/.test(t)&&!/^\d/.test(t)?t:undefined;}
/** "Label: value", where the label is a few words. */
const LABELLED=/^([\p{L}][^:]{0,40}?)\s*:\s+(.{1,300})$/u;

/** The facts in lines of text, in reading order: labelled lines, a label on one line with its value on the next, and
 * typed values with the words just before them (or their kind) as the key. */
export function factsOfLines(lines:Line[]):Fact[]{
 const out:Fact[]=[];let section='',pending:string|undefined;
 const push=(key:string,value:string,near?:string)=>{const f=fact(key,value,near);if(f)out.push(f);};
 for(const {text,heading,structured} of lines){
  const line=text.replace(/\t+/g,' · ').trim();if(!line)continue;
  // A heading names the section below it, and may hold a value of its own ("Invoice INV-4471").
  if(heading){section=cut(line,100);pending=undefined;typed(line,line);continue;}
  if(structured){pending=undefined;continue;}
  const labelled=LABELLED.exec(line);
  if(labelled&&labelOf(labelled[1])&&!/^https?$/i.test(labelled[1])){
   push(labelled[1],labelled[2],section||undefined);
   if(labelled[2].length>60)typed(labelled[2],line);
   pending=undefined;continue;
  }
  // A label alone on its line, its value on the next ("Total due", then "$482.00").
  if(pending&&line.length<=60&&/\d/.test(line)&&!labelOf(line)){push(pending,line,section||undefined);pending=undefined;continue;}
  pending=labelOf(line);
  if(!pending)typed(line,line);
 }
 function typed(text:string,line:string){
  const taken:[number,number][]=[];
  for(const t of TYPES){
   t.re.lastIndex=0;
   for(let m=t.re.exec(text);m;m=t.re.exec(text)){
    const start=m.index,end=start+m[0].length;
    if(taken.some(([a,b])=>start<b&&end>a)||t.ok&&!t.ok(m,line)){t.re.lastIndex=start+1;continue;}
    taken.push([start,end]);
    // The words just before the value name it ("Departs Nov 3", "Total due $482.00"), else the kind of value it is.
    const before=labelOf(text.slice(0,start).split(/[·|,;()]|\s[-–—]\s/).filter(s=>s.trim()).at(-1)??'');
    push(t.key?.(m)??before??t.type,t.value?.(m)??m[0],squash(line)===squash(m[0])?section||undefined:line);
   }
  }
 }
 return out;
}
/** Facts without repeats (the same key and value), the first kept, at most `max`. */
export function uniqueFacts(facts:Fact[],max=120):Fact[]{
 const seen=new Set<string>(),out:Fact[]=[];
 for(const f of facts){const k=`${f.key.toLowerCase()}\u0000${f.value.toLowerCase()}`;if(seen.has(k))continue;seen.add(k);out.push(f);if(out.length>=max)break;}
 return out;
}
/** Facts as a message carries them, checked again (what a page sends is not trusted to be well formed). */
export const cleanFacts=(facts:unknown,max=120):Fact[]=>Array.isArray(facts)?uniqueFacts(facts.filter(f=>f&&typeof f.key==='string'&&typeof f.value==='string').map(f=>fact(f.key,f.value,typeof f.near==='string'?f.near:undefined)).filter((f):f is Fact=>!!f),max):[];
