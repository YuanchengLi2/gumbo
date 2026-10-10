import type {ZodError} from 'zod';
import type {TimelineDocument} from '@dream/timeline';

type Issue=ZodError['issues'][number];
const where=(path:PropertyKey[])=>path.map((part,n)=>typeof part==='number'?`[${part}]`:(n?'.':'')+String(part)).join('')||'project.json';
/** One readable line per problem in project.json: the field, what is wrong, and the accepted values when there is a
 * choice. Union errors (such as an anchor's "at") list the alternatives instead of nesting raw validator output. */
export function documentErrors(error:ZodError,limit=10){
 const lines:string[]=[];
 const visit=(issue:Issue,prefix:PropertyKey[]=[])=>{
  const path=[...prefix,...issue.path];
  if(issue.code==='invalid_union'){
   const options=(issue as any).errors as Issue[][];const values=options.flat().flatMap(i=>i.code==='invalid_value'?(i as any).values:i.code==='invalid_type'?[`a ${(i as any).expected}`]:[]);
   if(values.length&&options.every(o=>o.length===1&&o[0].path.length===0))lines.push(`${where(path)}: must be one of ${[...new Set(values.map(v=>typeof v==='string'&&!v.startsWith('a ')?JSON.stringify(v):String(v)))].join(', ')}.`);
   else{const best=options.reduce((a,b)=>b.length<a.length?b:a,options[0]??[]);for(const inner of best)visit(inner,path);}
   return;
  }
  if(issue.code==='invalid_value')lines.push(`${where(path)}: must be one of ${(issue as any).values.map((v:unknown)=>JSON.stringify(v)).join(', ')}.`);
  else if(issue.code==='invalid_type'&&String(issue.message).includes('received undefined'))lines.push(`${where(path)}: required (${(issue as any).expected}).`);
  else lines.push(`${where(path)}: ${issue.message}`);
 };
 for(const issue of error.issues)visit(issue);
 const unique=[...new Set(lines)];
 return'project.json is not a valid project document:\n'+unique.slice(0,limit).join('\n')+(unique.length>limit?`\n…and ${unique.length-limit} more.`:'')+'\nThe engine reference shows a complete example of each timeline item.';
}

/** Why an item fell off the timeline: its start points at something that is not there, or it has no length. */
export function anchorProblem(timeline:TimelineDocument,itemId:string){
 const item=timeline.attached.find(i=>i.id===itemId),music=timeline.music.find(m=>m.id===itemId),start=(item??music)?.start;
 const clips=new Set(timeline.spine.map(c=>c.id));
 if(start?.kind==='clip'&&!clips.has(start.clipId))return`${itemId}: start refers to clip ${start.clipId}, which is not on the spine.`;
 if(start?.kind==='word'&&!clips.has(start.clipId))return`${itemId}: start refers to a word in clip ${start.clipId}, which is not on the spine.`;
 if(start?.kind==='word')return`${itemId}: start refers to word ${start.wordId}, which is not in that clip's transcript.`;
 if(item&&!item.end&&!(item.durationSec&&item.durationSec>0))return`${itemId}: has no length; give it durationSec (seconds) or an end anchor.`;
 if(item?.end)return`${itemId}: its end anchor is not after its start.`;
 return`${itemId}: its start anchor could not be placed.`;
}
