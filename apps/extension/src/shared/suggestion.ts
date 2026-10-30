/** The checks every Tab suggestion passes before it shows, in code rather than in the prompt, so they hold whatever the
 * model writes:
 * - no preamble, quotes or fences, and no echo of the text before the cursor;
 * - a clean join: the right space (or none) where it meets the user's text, a half-typed word finished, not restarted;
 * - nothing that overlaps the text after the cursor, or repeats text already there;
 * - at most three sentences (a short paragraph) in a message, email or document, one in a one-line field, and no
 *   newline in a single-line field;
 * - the field's own script (no English answer in a Japanese message);
 * - the facts guard: a number, email, link, date or name that appears nowhere the user can see or has written ends the
 *   suggestion just before it, since a wrong fact is the worst suggestion there is.
 * While a suggestion streams, only whole words are shown, so the ghost never flickers through half a word. */
export type SuggestionInput={before:string;after:string;singleLine:boolean;
 /** What they wrote above this field (their earlier messages in the conversation), which a suggestion never repeats. */own?:string;
 /** Everything the suggestion may take facts from: the page, the conversation, the user's writing, memory, facts. */
 known:string;final:boolean;
 /** What is theirs: their own writing, profile and notes, the only source of facts about the writer (selfClaimGuard). */
 mine?:string;
 /** The word the caret is in (or just after), which the model was asked to repeat before continuing: repeating it lets
  * the model finish a half-typed word, and its own spacing after a whole word says exactly where the next one starts. */
 lastWord?:string};
/** The word the caret is in or right after: what the model restates so the join is exact. */
export const lastWordOf=(before:string)=>{const m=/([\p{L}\p{N}'’-]{1,30})$/u.exec(before);return m?m[1]:'';};
/** Answers that say there is no answer, or talk about the task instead of doing it. */
const nonAnswer=/^\s*[(\[]?\s*(nothing|empty|no (completion|suggestion|continuation)|none|n\/a)\s*[)\].]?\s*$|\b(can't tell|cannot tell|can not tell|not sure what|unclear what|i'?ll leave it|leave (it|this) blank|the user (is|wants|was|typed)|the cursor|⟨cursor⟩|autocomplete|continuation:|as an ai|(the|this|their|your) (message|text|reply|email|field|sentence) (is|was) already|already (complete|finished|a complete)|already typed|finish (that|the|this) word|continue it\b|so finish|(not able|unable|can'?t|cannot) to? ?(predict|guess|tell what)|i have no (text|memory|information|context)|any guess would|would (have to|need to) (guess|invent)|no (name|memory|information) (is )?(given|known|available))\b/i;

const preamble=/^\s*(?:(?:sure|okay|ok|here(?:'s| is)(?: the)?(?: completion| continuation| text)?|completion|continuation|answer|output)\s*[:,-]\s*)+/i;
export function cleanSuggestion(raw:string,input:SuggestionInput):string{
 // An escaped line break written out ("\n" as two characters) is a line break.
 let text=raw.replace(/\r\n/g,'\n').replace(/\\n/g,'\n').replace(/⟨cursor⟩|<cursor>|\[cursor\]/gi,'');
 const unwrapped=text.replace(/^```[a-z]*\n?|```\s*$/g,''),stripped=unwrapped.replace(preamble,'');
 // A preamble means the answer starts afresh: after a whole word it needs its space.
 text=stripped!==unwrapped&&/[\p{L}\p{N}]$/u.test(input.before)&&/^[\p{L}\p{N}]/u.test(stripped)?' '+stripped:stripped;
 // Quotes around the whole answer are the model quoting itself, not text to type.
 const quoted=/^\s*["“'](.*)["”']\s*$/s.exec(text);if(quoted&&!/["“”]/.test(quoted[1]))text=(raw.match(/^\s/)?' ':'')+quoted[1];
 if(nonAnswer.test(text))return '';
 if(input.lastWord){
  // The model restated the word at the caret (as asked): what follows it, with its own spacing, is the suggestion.
  const lead=text.replace(/^\s+/,''),word=input.lastWord;
  if(lead.toLowerCase().startsWith(word.toLowerCase()))text=lead.slice(word.length);
  // Still streaming the restated word.
  else if(!input.final&&word.toLowerCase().startsWith(lead.toLowerCase()))return '';
  // The cursor is inside a word the model did not finish as typed (it wrote another word, or the same one misspelled):
  // nothing, rather than a second word glued after theirs.
  else if(/[\p{L}\p{N}]$/u.test(input.before)&&input.final&&/^[\p{L}\p{N}]/u.test(lead)&&lead.slice(0,2).toLowerCase()===word.slice(0,2).toLowerCase())return '';
  // Otherwise it went straight on from the cursor, and its own spacing says how: "ary" finishes "summ", " you" starts a
  // new word. A space is never added for it (that typed "summ ary").
 }
 text=dropEcho(input.before,text);
 text=input.lastWord?text:join(input.before,text);
 text=firstSentence(text,input);
 text=trimOverlap(text,input.after);
 if(!sameScript(input.before+input.after,text))return '';
 text=factsGuard(text,input.known+'\n'+input.before+'\n'+input.after,input.before);
 if(input.mine!==undefined)text=selfClaimGuard(text,input.before,`${input.mine}\n${input.before}\n${input.after}`);
 if(repeats(input.before,text,input.own))return '';
 if(!input.final)text=wholeWords(text);
 text=text.replace(/[ \t]+$/,'');
 return /[\p{L}\p{N}]/u.test(text)?text:'';
}
/** The model sometimes starts by repeating the end of what the user typed. */
export function dropEcho(before:string,text:string){
 const tail=before.slice(-200);
 for(let k=Math.min(tail.length,text.length);k>=4;k--){
  const piece=text.slice(0,k);
  if(tail.endsWith(piece)&&(k===text.length||/\s/.test(piece.at(-1)!)||/\s/.test(text[k]??' ')))return text.slice(k);
 }
 // The whole last word repeated after the user typed it ("I" → "I will").
 const lastWord=/(\S+)$/.exec(before)?.[1];
 if(lastWord&&lastWord.length>=3&&text.startsWith(lastWord)&&/^\s/.test(text.slice(lastWord.length)))return text.slice(lastWord.length);
 return text;
}
/** Where the suggestion meets the text before the cursor. */
export function join(before:string,text:string){
 const last=before.slice(-1);
 if(!before)return text.replace(/^\s+/,'');
 if(/\s/.test(last))return text.replace(/^[ \t]+/,'');
 // After punctuation that ends a clause, words need a space; closing punctuation needs none.
 if(/[.,;:!?)\]”’]/.test(last)&&/^[\p{L}\p{N}(“"]/u.test(text)&&!/^[.,;:!?]/.test(text))return ' '+text;
 return text;
}
/** Where a suggestion ends: in a one-line field, its first sentence on its line; elsewhere up to three sentences, within
 * the paragraph it is in (a blank line ends it), or two lines when it is a list or a sign-off. */
export function firstSentence(text:string,{singleLine,before,sentences=singleLine?1:2}:{singleLine:boolean;before:string;sentences?:number}){
 const lead=/^\n+/.exec(text)?.[0].length??0;
 if(singleLine){const nl=text.indexOf('\n');if(nl>=0)text=text.slice(0,nl);}
 else{
  // A newline right at the start begins a new line or paragraph the user would type; a blank line after words ends it.
  const blank=text.indexOf('\n\n',lead);if(blank>lead)text=text.slice(0,blank);
  const lines=text.slice(lead).split('\n');if(lines.length>2&&lead===0&&!before.endsWith('\n'))text=text.slice(0,lead)+lines.slice(0,2).join('\n');
 }
 const body=text.slice(lead),ends=[...body.matchAll(/[.!?…。！？](?=["”’)\]]?(\s|$))["”’)\]]?/gu)];
 // At most so many sentences; and after whole sentences, a sentence left unfinished (the model ran out) is left out.
 const end=ends.length>=sentences?ends[sentences-1]:ends.at(-1);
 if(end&&(ends.length>=sentences||/[\p{L}\p{N}]/u.test(body.slice(end.index!+end[0].length))))text=text.slice(0,lead+end.index!+end[0].length);
 return text;
}
/** A reply holds the best continuation and, each after a line of ⟂, shorter alternatives that go another way. */
export const ALTERNATIVE='⟂';
export function alternativesOf(raw:string):string[]{
 // A model that copies an escaped line break ("\n" as two characters) around the separator, or writes one, means none.
 return raw.split(/(?:\\n|\n)?[ \t]*⟂[ \t]*(?:\\n|\n)?/).map(a=>a.replace(/\\n$/,''));
}
/** Drops the end of the suggestion that the text after the cursor already says. */
export function trimOverlap(text:string,after:string){
 const next=after.replace(/^[ \t]+/,'').split('\n')[0];if(!next.trim())return text;
 const words=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,'').split(/\s+/).filter(Boolean);
 const nextWords=words(next).slice(0,8);
 const textWords=text.split(/(\s+)/);
 for(let n=Math.min(nextWords.length,words(text).length);n>=1;n--){
  const tail=words(text).slice(-n);
  if(tail.join(' ')===nextWords.slice(0,n).join(' ')){
   // Cut the last n words off the original text, keeping its spacing.
   let kept=textWords.length,count=0;while(kept>0&&count<n){kept--;if(textWords[kept].trim())count++;}
   return textWords.slice(0,kept).join('').replace(/\s+$/,'');
  }
 }
 // The exact text after the cursor starts where the suggestion ends: fine as is.
 return text;
}
const scriptOf=(s:string)=>{const letters=s.match(/\p{L}/gu)??[];if(!letters.length)return '';
 const latin=letters.filter(c=>/\p{Script=Latin}/u.test(c)).length,cjk=letters.filter(c=>/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(c)).length,cyr=letters.filter(c=>/\p{Script=Cyrillic}/u.test(c)).length,heb=letters.filter(c=>/[\p{Script=Hebrew}\p{Script=Arabic}]/u.test(c)).length;
 const best=Math.max(latin,cjk,cyr,heb);return best===latin?'latin':best===cjk?'cjk':best===cyr?'cyrillic':'rtl';};
export function sameScript(field:string,text:string){const a=scriptOf(field.slice(-400)),b=scriptOf(text);return !a||!b||a===b;}

const months='january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
const days='monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|yesterday';
/** Tokens that state a fact: a number, an email, a link, a handle, a date word, or a capitalised word inside a sentence;
 * with counted, a number in words too ("three years", "a dozen"). */
function factTokens(text:string,counted=false):{token:string;index:number}[]{
 const out:{token:string;index:number}[]=[];
 const add=(re:RegExp)=>{for(const m of text.matchAll(re))out.push({token:m[0],index:m.index!});};
 add(/[\w.+-]+@[\w-]+\.[\w.-]+/g);add(/\bhttps?:\/\/\S+|\bwww\.\S+|\b[\w-]+\.(?:com|org|net|io|ai|app|dev|co)\b\S*/gi);add(/@\w{2,}/g);
 add(/[$€£¥]?\d[\d,.:/-]*(?:\s?(?:%|am|pm|k|m|bn|usd|eur)\b)?/gi);
 if(counted)add(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|dozen|several|a few|a couple)\b/gi);
 add(new RegExp(`\\b(?:${months}|${days})\\b`,'gi'));
 // A capitalised word that does not start a sentence (and is not "I"): a name.
 for(const m of text.matchAll(/(?<=[\p{L}\p{N},;:)]\s+)\p{Lu}[\p{L}'-]+/gu))if(!/^I('|$)/.test(m[0]))out.push({token:m[0],index:m.index!});
 return out.sort((a,b)=>a.index-b.index);
}
const leadIn=/\s*\b(no\.?|nos?\.|number|#|at|on|in|the|a|an|to|for|of|by|from|with|and|or|is|are|was|were|be|about|around|until|by|via|named|called)\s*[#:]?$/i;
export function factsGuard(text:string,known:string,before='',counted=false){
 // The end of the text before the cursor is read with the suggestion, so a name right at its start counts as mid-sentence.
 const lead=before.slice(-40),haystack=known.toLowerCase();
 for(const {token,index:at} of factTokens(lead+text,counted)){
  if(at<lead.length)continue;const index=at-lead.length;
  const bare=token.toLowerCase().trim().replace(/[.,;:!?)]+$/,'');
  if(bare.length<2&&!/\d/.test(bare))continue;
  if(haystack.includes(bare))continue;
  // Cut at the start of the word holding the unknown fact, and the words that only lead into it ("on", "at the", "no.",
  // "#"): a suggestion ends where a sentence could pause, never on a word waiting for what was cut.
  let cut=text.slice(0,index).replace(/\S+$/,'').replace(/\s+$/,'');
  for(let i=0;i<4&&leadIn.test(cut);i++)cut=cut.replace(leadIn,'');
  return cut;
 }
 return text;
}
/** Words that state something about the writer themselves: what they use, did, know, are, studied or have, what their
 * job or experience is, for how long. */
const aboutThem=/\b(?:I|we)\s+(?:(?:have|'ve|’ve|had|mostly|mainly|usually|often|also|currently|always|really|just)\s+)*(?:use|used|using|work|worked|working|study|studied|studying|know|knew|speak|spoke|live|lived|graduated|teach|taught|learned|learnt|built|made|led|managed|run|ran|own|owned|been|have|edit|edited|design|designed|code|coded|play|played)\b|\b(?:I'm|I’m|I am|I was|we're|we are)\s+(?:a|an|the|in|at|from|based|studying|working|fluent|certified|experienced)\b|\b(?:my|our)\s+(?:job|role|title|experience|degree|major|school|university|college|company|employer|age|background|skills?|team|grade|gpa)\b|\bfor\s+(?:the\s+(?:last|past)\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a few|several|many)\s+(?:years?|months?|weeks?)\b/i;
/** The claims-about-them check: a suggestion that says something about the writer themselves ("I mostly use DaVinci
 * Resolve, for three years") takes its facts (the names, the numbers, the counts) only from what is theirs, mine: their
 * own writing, their profile, their notes, never the page or the question in front of them (a job post naming the
 * software it wants is not their experience). Anything else is cut before, as an invented fact is. */
export function selfClaimGuard(text:string,before:string,mine:string){
 if(!aboutThem.test(`${before.slice(-80)}${text}`))return text;
 return factsGuard(text,mine,before,true);
}
/** A suggestion that says again what they already wrote: its words, in runs of three, mostly found in their text (or in
 * their messages above), even reordered or lightly changed. A continuation brings new words; an echo brings theirs. */
export function repeats(before:string,text:string,own=''){
 const t=text.trim().toLowerCase();if(!t)return false;
 const theirs=`${before.slice(-2000)}\n${own.slice(-3000)}`.toLowerCase();
 if(t.length>=14&&theirs.includes(t))return true;
 const words=(s:string)=>s.replace(/[^\p{L}\p{N}\s']/gu,' ').split(/\s+/).filter(Boolean);
 const mine=words(t);if(mine.length<4)return false;
 const seen=new Set<string>(),w=words(theirs);for(let i=0;i+2<w.length;i++)seen.add(`${w[i]} ${w[i+1]} ${w[i+2]}`);
 let hit=0,all=0;for(let i=0;i+2<mine.length;i++){all++;if(seen.has(`${mine[i]} ${mine[i+1]} ${mine[i+2]}`))hit++;}
 return all>0&&hit/all>=0.5;
}
/** Two independent predictions agree only as far as the writer's next words are clear: the words both begin with are
 * shown, the rest (where they part) is left out. Words compare without case or punctuation; the text kept is the first
 * prediction's own. */
export function agreed(a:string,b:string):string{
 const tokens=(s:string)=>[...s.matchAll(/\s*\S+/g)].map(m=>m[0]);
 const norm=(t:string)=>t.trim().toLowerCase().replace(/[^\p{L}\p{N}']/gu,'');
 const ta=tokens(a),tb=tokens(b);let k=0;
 while(k<ta.length&&k<tb.length&&norm(ta[k])&&norm(ta[k])===norm(tb[k]))k++;
 // A last word both wrote but with different punctuation keeps only its letters.
 const kept=ta.slice(0,k);
 if(k&&ta[k-1].trim()!==tb[k-1].trim())kept[k-1]=kept[k-1].replace(/[^\p{L}\p{N}'\s]+$/u,'');
 return kept.join('');
}
/** While streaming: only up to the last whole word. */
export function wholeWords(text:string){const at=Math.max(text.lastIndexOf(' '),text.lastIndexOf('\n'));return at<=0?'':text.slice(0,at);}

/** What is left of a suggestion after the user typed (or deleted) since it was made: the user typing the same letters
 * keeps it, Backspace within it brings it back. Null when the field no longer matches. */
export function remainder(base:string,suggestion:string,now:string):string|null{
 const full=base+suggestion;
 if(now.length<base.length||!full.startsWith(now))return null;
 const rest=full.slice(now.length);return rest.length?rest:null;
}
