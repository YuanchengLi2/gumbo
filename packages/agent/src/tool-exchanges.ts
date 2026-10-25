type Message={role:string;content:any;[key:string]:any};
const calls=(message:Message)=>message.role==='assistant'&&Array.isArray(message.content)?message.content.filter(b=>b.type==='tool_use'):[];
export function assertToolExchanges(messages:Message[]){
 for(let n=0;n<messages.length;n++){
  const expected=calls(messages[n]);
  if(expected.length){const next=messages[n+1],results=next?.role==='user'&&Array.isArray(next.content)?next.content.filter(b=>b.type==='tool_result'):[];const missing=expected.filter(c=>results.filter(r=>r.tool_use_id===c.id).length!==1);if(missing.length)throw new Error('Incomplete local tool exchange: '+missing.map(c=>c.id).join(', '));}
  if(messages[n].role==='user'&&Array.isArray(messages[n].content)){const preceding=new Set(n?calls(messages[n-1]).map(c=>c.id):[]);for(const result of messages[n].content.filter((b:any)=>b.type==='tool_result'))if(!preceding.has(result.tool_use_id))throw new Error('Orphan local tool result: '+result.tool_use_id);}
 }
}
/** A server tool call the provider left without its result cannot be sent back (the API rejects the conversation), and
 * nothing ran for it; it is dropped. A paused turn keeps its calls: sending it back as it is lets the server finish them. */
export function withoutUnansweredServerCalls(content:any[]){const answered=new Set(content.filter(b=>typeof b?.tool_use_id==='string').map(b=>b.tool_use_id));return content.filter(b=>b?.type!=='server_tool_use'||answered.has(b.id));}
/** One-time migration of saved pre-v2 exchanges. Reorder known results; never replay effects. */
export function repairSavedExchanges(messages:Message[],receipt:(id:string)=>any,allowPendingTail=false):Message[]{
 const repaired:Message[]=[];
 for(let n=0;n<messages.length;n++){
  const saved=messages[n],message=saved.role==='assistant'&&Array.isArray(saved.content)&&n<messages.length-1?{...saved,content:withoutUnansweredServerCalls(saved.content)}:saved,expected=calls(message);repaired.push(message);if(!expected.length)continue;
  if(n===messages.length-1&&allowPendingTail)continue;
  const following:Message[]=[];while(n+1<messages.length&&messages[n+1].role==='user')following.push(messages[++n]);
  const results=following.flatMap(m=>Array.isArray(m.content)?m.content.filter(b=>b.type==='tool_result'):[]);
  repaired.push({role:'user',content:expected.map(call=>{const found=results.find(r=>r.tool_use_id===call.id);if(found)return found;const saved=receipt(call.id);return{type:'tool_result',tool_use_id:call.id,is_error:saved?!!saved.error:true,content:saved?.content??JSON.stringify(saved??{error:'No terminal receipt was recorded for this old call. Its outcome is unconfirmed; inspect saved project state before proceeding.'})};})});
  for(const m of following){const content=Array.isArray(m.content)?m.content.filter(b=>b.type!=='tool_result'):m.content;if(content?.length)repaired.push({...m,content});}
 }
 return repaired;
}
