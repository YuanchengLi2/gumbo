/** Every separate thing a request asks for, so none is skipped: Haiku splits the message once when the request starts, the
 * agent is given the list, and finishing is refused until it reports on each part (done, or not possible and why). */
export type RequestPart={id:string;text:string};
export type PartReport={id:string;status:'done'|'not_possible';note?:string};

export const requestPartsPrompt=`Split the user's message to a video editor into the separate things they asked for. Each part is one short instruction in the user's own words (fix spelling only). Include every distinct ask, including small ones mentioned in passing; do not add anything they did not ask for and do not merge separate asks. A message with one ask has one part. Questions they want answered count as parts. Reply with JSON only: {"parts": ["...", "..."]}.`;

export function parseParts(text:string,fallback:string):RequestPart[]{
 let parts:string[]=[];
 try{const json=JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g,''));if(Array.isArray(json.parts))parts=json.parts.map((p:unknown)=>String(p).trim()).filter(Boolean);}catch{}
 if(!parts.length)parts=[fallback.trim().slice(0,600)];
 return parts.slice(0,20).map((text,n)=>({id:`p${n+1}`,text:text.slice(0,300)}));
}
/** How the parts are shown to the agent in its first message. */
export const partsBriefing=(parts:RequestPart[])=>`\nThis request has ${parts.length} part${parts.length===1?'':'s'}; do all of them. Finishing as complete needs a parts entry for each id: done, or not_possible with the reason.\n${parts.map(p=>`${p.id}: ${p.text}`).join('\n')}`;
/** Why finishing is refused, or undefined when every part is reported on. */
export function partsBlocker(parts:RequestPart[],reports:PartReport[]|undefined):string|undefined{
 // A single-part request is done when it finishes complete; the report matters when there is more than one ask.
 if(parts.length<2&&!reports?.length)return;
 const reported=new Map((reports??[]).map(r=>[r.id,r]));
 const missing=parts.filter(p=>!reported.has(p.id));
 if(missing.length)return`You have not done or reported on every part of the request: ${missing.map(p=>`${p.id} "${p.text}"`).join('; ')}. Do these now, then finish with a parts entry for each (done, or not_possible with the reason).`;
 const unexplained=(reports??[]).filter(r=>r.status==='not_possible'&&!r.note?.trim());
 if(unexplained.length)return`Say why each not_possible part could not be done: ${unexplained.map(r=>r.id).join(', ')}.`;
}
/** The user-facing line about parts that could not be done, added to the recap so it is never left out. */
export function notPossibleNote(parts:RequestPart[],reports:PartReport[]|undefined){
 const lines=(reports??[]).filter(r=>r.status==='not_possible').map(r=>`• ${parts.find(p=>p.id===r.id)?.text??r.id}: ${r.note}`);
 return lines.length?`\n\nNot done:\n${lines.join('\n')}`:'';
}
/** Whether a message may hold several asks (a list, "and then", "also", several sentences or lines); one plain ask is not
 * split, which saves the call. */
export const mightHaveSeveralAsks=(text:string)=>{const t=text.trim();return t.length>40&&(/\n\s*\S/.test(t)||/\b(?:and then|then also|also|as well|plus|after that|next|another thing|and can you|and make|and add)\b/i.test(t)||(t.match(/[,;]/g)??[]).length>=2||(t.match(/[.?!]\s+\S/g)??[]).length>=2);};
