/** What Ctrl+K offers before anything is typed: the few things the user most likely wants. These are the instant ones,
 * read from the selection itself (a date, an address, a draft, a long passage, another language); the model adds ideas
 * from the page, the conversation and memory a moment later. kind: edit (change or write text), answer (a question),
 * act (outside the page: calendar, mail, maps, web, notes), page (done in this page: click, fill in, choose). */
export type Idea={text:string;kind:'edit'|'answer'|'act'|'page'};
const date=/\b(mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?|sun)(day)?\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?\b|\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b|\b(tomorrow|tonight|next week)\b|\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i;
const email=/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/;
const street=/\b\d+\s+[\w .'-]{2,30}\s(st|street|ave|avenue|rd|road|blvd|boulevard|lane|ln|dr|drive|way|ct|court|pl|place)\b/i;
/** Mostly letters outside the Latin alphabet: likely another language the user may want in theirs. */
const foreign=(s:string)=>{const letters=s.match(/\p{L}/gu)??[];return letters.length>8&&letters.filter(c=>!/[a-zA-ZÀ-ɏ]/.test(c)).length>letters.length/2;};
export function quickIdeas(i:{selection:string;inField:boolean;intent?:string;before:string;thread?:string}):Idea[]{
 const s=i.selection.trim(),out:Idea[]=[];
 if(s&&date.test(s))out.push({text:'Add this to my calendar',kind:'act'});
 if(s&&street.test(s))out.push({text:'Show this on a map',kind:'act'});
 if(s&&email.test(s))out.push({text:'Find my emails with them',kind:'act'});
 if(s&&foreign(s))out.push({text:'Translate this into English',kind:i.inField?'edit':'answer'});
 if(i.inField){
  if(s)out.push({text:'Fix the spelling and grammar',kind:'edit'},{text:'Make it clearer and shorter',kind:'edit'});
  else if(i.thread)out.push({text:'Draft a reply',kind:'edit'});
  else if(i.before.trim().length>40)out.push({text:'Finish this for me',kind:'edit'});
 }else if(s){
  out.push(s.length>280?{text:'Summarize this',kind:'answer'}:{text:'Explain this',kind:'answer'});
 }
 return out.slice(0,3);
}
/** The model's ideas, then the instant ones it did not already give; at most four. */
export function mergeIdeas(model:Idea[],quick:Idea[]):Idea[]{
 const seen=new Set<string>(),out:Idea[]=[];
 for(const idea of [...model,...quick]){const key=idea.text.toLowerCase().replace(/[^a-z0-9 ]/g,'').trim();if(!key||seen.has(key))continue;seen.add(key);out.push(idea);}
 return out.slice(0,4);
}
/** The model's reply (a JSON array, perhaps with words around it) as ideas; anything malformed is left out. */
export function ideasOf(text:string):Idea[]{
 const json=/\[[\s\S]*\]/.exec(text)?.[0];if(!json)return[];
 try{return(JSON.parse(json) as any[]).filter(x=>x&&typeof x.text==='string'&&x.text.trim()&&['edit','answer','act','page'].includes(x.kind)).map(x=>({text:String(x.text).trim().slice(0,80),kind:x.kind}));}catch{return[];}
}
