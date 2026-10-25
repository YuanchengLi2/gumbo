/** Keeping a long conversation small. When it outgrows its budget, the older part is summarized by a model into a note
 * (what was asked, decided, edited and learned about the footage, and what is still open) and replaced by it. The first
 * message (the cached session start) stays exactly as it was, and the recent exchanges stay verbatim, so the model keeps
 * working where it was and the cache keeps its prefix. A compaction happens rarely: only when the conversation is well
 * past its budget, and it goes deep enough that the next one is far away. */

export type Message={role:'user'|'assistant';content:any};
const IMAGE_TOKENS=1500;
/** A conservative token estimate: text at about 3.2 characters a token, a picture at a fixed price, sound by its length
 * (as the gateway counts it). */
export function estimateTokens(value:unknown){
 let fixed=0;const text=JSON.stringify(value,(_key,item)=>{
  if(item&&typeof item==='object'&&item.type==='image'){fixed+=IMAGE_TOKENS;return '[image]';}
  if(item&&typeof item==='object'&&item.type==='audio'){fixed+=Math.ceil((Number(item.durationSec)||90)*32)+50;return '';}
  return item;});
 return Math.ceil((text===undefined||text==='""'?0:text.length)/3.2)+fixed;
}
/** Where to cut: the earliest assistant message such that everything from it on is within the share of the budget kept
 * verbatim. The tail always starts with an assistant message (so the conversation still alternates after the summary,
 * and no tool result is left without its call), and never later than the last assistant message. */
export function cutPoint(messages:Message[],keepTokens:number){
 const assistants=messages.map((m,i)=>m.role==='assistant'&&i>=2?i:-1).filter(i=>i>0);if(!assistants.length)return -1;
 for(const i of assistants)if(estimateTokens(messages.slice(i))<=keepTokens)return i;
 return assistants.at(-1)!;
}
/** The older part of a conversation as plain text for the summarizer: what was said, each tool call in brief and what it
 * returned (shortened), pictures as a mark. */
export function transcriptOf(messages:Message[]){
 const lines:string[]=[];
 const short=(text:string,max:number)=>text.length>max?text.slice(0,max)+` … (${text.length-max} more characters)`:text;
 for(const m of messages){
  const blocks=typeof m.content==='string'?[{type:'text',text:m.content}]:m.content as any[];
  for(const b of blocks){
   if(b.type==='text'&&b.text?.trim())lines.push(`${m.role==='user'?'USER':'EDITOR'}: ${short(b.text.trim(),m.role==='user'?6000:2500)}`);
   else if(b.type==='tool_use')lines.push(`EDITOR used ${b.name}: ${short(JSON.stringify(b.input),600)}`);
   else if(b.type==='tool_result'){const content=typeof b.content==='string'?b.content:(b.content??[]).map((c:any)=>c.type==='text'?c.text:c.type==='image'?'[picture]':'').join(' ');lines.push(`RESULT${b.is_error?' (error)':''}: ${short(content,1500)}`);}
  }
 }
 return lines.join('\n');
}
export const summarySystem=`You condense the earlier part of a working session between a video editor (an AI) and a user, so the editor can carry on without it. Write a structured note in plain text with these sections:
- Requests: what the user asked for, in their own words where it matters, and any answers they gave to questions.
- Decisions and preferences: choices made and lasting wishes stated.
- The edit so far: what was changed in the video, with the important source ranges and times.
- Footage learned: what the sources contain that matters (moments, times, people, problems), with times.
- Open: what is still to do or was promised, and anything that failed and why.
Be specific and concise (at most about 900 words: it is written while the user waits). Keep exact times, ids, names and numbers. Do not invent anything.`;
/** The conversation after compaction: the first message as it was plus the summary, then the kept tail. */
export function compacted(messages:Message[],cut:number,summary:string):Message[]{
 const first=messages[0],content=typeof first.content==='string'?[{type:'text',text:first.content}]:[...first.content];
 // Summaries of earlier compactions are replaced, not stacked.
 const kept=content.filter((b:any)=>!(b.type==='text'&&typeof b.text==='string'&&b.text.startsWith(SUMMARY_MARK)));
 return[{role:'user',content:[...kept,{type:'text',text:`${SUMMARY_MARK}\n${summary.trim()}`}]},...messages.slice(cut)];
}
export const SUMMARY_MARK='Summary of the session so far (older messages were condensed into this):';
