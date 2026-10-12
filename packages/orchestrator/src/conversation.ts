import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {ProjectDB} from '@dream/project-db';
import {workingContext} from './working-context';

type Message={role:string;content:any;dreamSource?:string};
type Entry={id:string;toolCallId:string;name:string;input:unknown;result:any};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const textOf=(content:any)=>typeof content==='string'?content:Array.isArray(content)?content.filter(b=>b.type==='text').map(b=>b.text).join('\n'):JSON.stringify(content);
const clean=(message:Message)=>({role:message.role,content:message.content});
/** Image token cost depends on pixels, not the length of its base64 transport.
 * Keep the original pixels intact; only the compaction measurement is weighted.
 */
export const conversationBytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value,(_key,item)=>item?.type==='image'&&item.source?.type==='base64'?{type:'image',source:{type:'base64',media_type:item.source.media_type,data:'0'.repeat(4800)}}:item));
const bytes=conversationBytes;
const prefix=(turn:string)=>`context:${turn}:`;
const isSnapshot=(m:Message)=>{if(m.dreamSource==='snapshot'||m.dreamSource==='working')return true;if(typeof m.content!=='string')return false;try{const value=JSON.parse(m.content);return !!value.dreamWorkingReads||value.notice?.startsWith('Older tool exchanges were compacted.');}catch{return false;}};

function archive(db:ProjectDB,turn:string,messages:Message[]){
 const calls=new Map<string,any>(),entries:Entry[]=[];
 for(const message of messages){
  if(!Array.isArray(message.content))continue;
  for(const block of message.content){
   if(message.role==='assistant'&&block.type==='tool_use')calls.set(block.id,block);
   if(message.role==='user'&&block.type==='tool_result'&&calls.has(block.tool_use_id)){
    const call=calls.get(block.tool_use_id),value={toolCallId:call.id,name:call.name,input:call.input,result:block},id=hash(value);
    const entry={id,...value};if(!db.getMeta(prefix(turn)+id))db.saveState(prefix(turn)+id,entry);entries.push(entry);
   }
  }
 }
 return entries;
}
const describe=(entry:Entry,turn:string)=>({id:entry.id,receipt:prefix(turn)+entry.id,toolCallId:entry.toolCallId,name:entry.name,status:entry.result.is_error?'failed':'succeeded',excerpt:textOf(entry.result.content).slice(0,1000),truncated:textOf(entry.result.content).length>1000});

/** Older user messages that stay authoritative after compaction: real instructions and feedback, the two latest
 * pieces of advice from a stronger model, and only the newest project-state snapshot. Engine nudges are dropped, and media images
 * shown at the start become a short note, so the prefix shrinks instead of growing with every compaction. */
function keptDirections(db:ProjectDB,older:Message[],tail:Message[],budget:number,cleanMessage:(m:Message)=>Message){
 // Status messages after the first report only changes, so the newest dropped one is kept as the full state it stands for,
 // unless the remaining messages begin with a full state of their own.
 const firstInTail=tail.find(m=>m.dreamSource==='media-status'),tailStatus=!!firstInTail&&!(firstInTail as any).dreamStateKey;
 const kept:Message[]=[];let status=false,advice=0,media=false,used=0;
 for(let m of [...older].reverse()){
  if(m.role!=='user'||isSnapshot(m)||Array.isArray(m.content)&&m.content.some((b:any)=>b.type==='tool_result')||m.dreamSource==='nudge')continue;
  if(m.dreamSource==='media-status'){if(tailStatus||status)continue;status=true;const key=(m as any).dreamStateKey,full=key?db.getMeta(key):undefined;if(full)m={role:'user',dreamSource:'media-status',content:full};}
  else if(m.dreamSource==='media'||m.dreamSource==='media-note'){
   if(media)continue;media=true;
   const images=Array.isArray(m.content)?m.content.filter((b:any)=>b.type==='image').length:0;
   m={role:'user',dreamSource:'media-note',content:m.dreamSource==='media-note'?m.content:'Earlier in this request '+images+' frames of the project media were shown. They are not repeated here; use view_media to look again.'};
  }
  else if(m.dreamSource==='advice'){if(advice>=2)continue;advice++;}
  const size=bytes(cleanMessage(m));if(kept.length&&used+size>budget)continue;used+=size;kept.push(cleanMessage(m));
 }
 return kept.reverse();
}
const previousDigest=(older:Message[])=>{for(const m of [...older].reverse()){if(typeof m.content!=='string')continue;try{const value=JSON.parse(m.content);if(value?.notice?.startsWith('Older tool exchanges were compacted.'))return value;}catch{}}};

type Plan={cut:number;prefix:Message[]};
/** Choose a compaction boundary at complete exchange boundaries. The prefix replaces messages before cut. */
function planCompaction(db:ProjectDB,turn:string,messages:Message[],targetBytes:number,keepMetadata:boolean,planNotes?:string):Plan|undefined{
 const cleanMessage=keepMetadata?(m:Message)=>({...m}):clean;const before=bytes(messages.map(cleanMessage));if(before<=targetBytes)return;
 const assistantIndices=messages.flatMap((m,i)=>m.role==='assistant'?[i]:[]);const last=assistantIndices.at(-1),calls=last===undefined?[]:Array.isArray(messages[last].content)?messages[last].content.filter((b:any)=>b.type==='tool_use'):[];const results=last===undefined?undefined:messages[last+1]?.content;const freshImages=Array.isArray(results)&&results.some((r:any)=>r.type==='tool_result'&&Array.isArray(r.content)&&r.content.some((b:any)=>b.type==='image'));const complete=!freshImages&&!!calls.length&&Array.isArray(results)&&calls.every((call:any)=>results.some((r:any)=>r.type==='tool_result'&&r.tool_use_id===call.id));if(assistantIndices.length<2&&!complete)return;
 let plan:Plan|undefined;
 const minimum=complete&&bytes(messages.slice(last!))>targetBytes/2?0:1;
 for(let keep=Math.max(minimum,Math.min(3,assistantIndices.length-1));keep>=minimum;keep--){
  const cut=keep?assistantIndices[assistantIndices.length-keep]:last!+2,older=messages.slice(1,cut);
  // Only complete results enter the archive. The entire latest assistant message stays verbatim.
  const entries=archive(db,turn,older),tail=messages.slice(cut),earlier=previousDigest(older);
  const directions=keptDirections(db,older,tail,targetBytes*.15,cleanMessage);
  const decisions=[...earlier?.recentAssistantNotes??[],...older.filter(m=>m.role==='assistant').flatMap(m=>Array.isArray(m.content)?m.content.filter(b=>b.type==='text').map(b=>String(b.text)):typeof m.content==='string'?[m.content]:[])].slice(-8).map((t:string)=>t.slice(0,1500));
  // A later compaction carries the earlier summary forward instead of losing it.
  const receipts=[...earlier?.recentReceipts??[],...entries.map(entry=>describe(entry,turn))],archived=(earlier?.archivedCalls??0)+entries.length;
  const digest={notice:'Older tool exchanges were compacted. Exact reads are retained separately below as of this compaction; later writes in the conversation supersede them. Other full results remain local: use read_file with scope receipt and the provided receipt path. Excerpts here are incomplete and historical. Do not claim old images were inspected in this request. Earlier user direction below remains authoritative.',archivedCalls:archived,earlierCallsOmitted:Math.max(0,archived-20),recentReceipts:receipts.slice(-20),recentAssistantNotes:decisions,...(planNotes?{planNotes}:{})};
  const working=workingContext(messages,tail,targetBytes*.3);
  plan={cut,prefix:[cleanMessage(messages[0]),{role:'user',...(keepMetadata?{dreamSource:'snapshot' as const}:{}),content:JSON.stringify(digest)},...directions,...(working?[cleanMessage(working)]:[])]};
  if(bytes([...plan.prefix,...tail])<=targetBytes)break;
 }
 return plan&&bytes([...plan.prefix,...messages.slice(plan.cut)])<before?plan:undefined;
}
/** Preserve full local history; only compact the provider view at complete exchange boundaries. */
export function compactConversation(db:ProjectDB,turn:string,messages:Message[],targetBytes=384_000,keepMetadata=false){
 const cleanMessage=keepMetadata?(m:Message)=>({...m}):clean,original=messages.map(cleanMessage),plan=planCompaction(db,turn,messages,targetBytes,keepMetadata);
 if(!plan)return original;
 const compacted=[...plan.prefix,...messages.slice(plan.cut).map(cleanMessage)],before=bytes(original);
 const key='compaction:'+turn+':'+hash(original);if(!db.getMeta(key))db.db.transaction(()=>{db.setMeta(key,JSON.stringify({beforeBytes:before,afterBytes:bytes(compacted),messagesBefore:messages.length,messagesAfter:compacted.length}));db.event('ai.context_compacted',{turnId:turn,beforeBytes:before,afterBytes:bytes(compacted)});})();
 return compacted;
}
/** Sticky provider view: once compacted, the summarized prefix stays byte-identical and later exchanges only append.
 * This keeps prompt-cache reads and thinking-block bindings valid between compactions. A new boundary is chosen
 * only when the view exceeds compactToBytes or the history before the saved boundary changed.
 */
export function providerView(db:ProjectDB,turn:string,scope:string,messages:Message[],compactToBytes?:number){
 const key=`compaction-plan:${turn}:${scope}:${hash(clean(messages[0]??{role:'user',content:''}))}`,saved=db.loadState<{cut:number;prefixHash:string;prefix:Message[]}>(key);
 const valid=saved&&saved.cut<=messages.length&&hash(messages.slice(0,saved.cut).map(clean))===saved.prefixHash;
 const view=valid?[...saved!.prefix,...messages.slice(saved!.cut).map(m=>({...m}))]:messages.map(m=>({...m}));
 if(compactToBytes===undefined||bytes(view)<=compactToBytes)return view;
 // Plan on the current view: the existing summary is carried forward and only newer exchanges are archived.
 // A view index past the saved prefix is a history index shifted by the prefix, so the new boundary maps back exactly.
 // The lead's latest plan notes always survive compaction, so a long run keeps its plan.
 const plan=planCompaction(db,turn,view,compactToBytes,true,db.getMeta(`task-notes:${turn}:${scope.split(':').slice(2).join(':')}`)||undefined);if(!plan)return view;
 const cut=valid?plan.cut+saved!.cut-saved!.prefix.length:plan.cut;
 db.db.transaction(()=>{db.saveState(key,{cut,prefixHash:hash(messages.slice(0,cut).map(clean)),prefix:plan.prefix});db.event('ai.context_compacted',{turnId:turn,scope,beforeBytes:bytes(view),afterBytes:bytes([...plan.prefix,...messages.slice(cut)]),cut});})();
 return [...plan.prefix,...messages.slice(cut).map(m=>({...m}))];
}

const schemas={
 list_execution_history:z.object({turnId:z.string().optional(),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(20).default(10)}),
 read_execution:z.object({turnId:z.string().optional(),id:z.string().regex(/^[a-f0-9]{64}$/),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(16000).default(8000)})
};
export const historyTools=Object.entries(schemas).map(([name,schema])=>({name,description:name==='list_execution_history'?'List archived execution receipts from this project; optionally specify an earlier turnId. Use after conversation compaction to find older decisions or results.':'Read a page of an archived tool input/result from this project; optionally specify an earlier turnId. Images stay local; inspect fresh composited frames for visual evidence.',input_schema:z.toJSONSchema(schema,{target:'draft-7'})}));
export const isHistoryTool=(name:string)=>Object.hasOwn(schemas,name);
export function executeHistoryTool(db:ProjectDB,turn:string,name:string,input:unknown){
 if(name==='list_execution_history'){
  const {offset,limit,turnId}=schemas.list_execution_history.parse(input),p=prefix(turnId??turn);
  const rows=db.db.prepare('SELECT key FROM meta WHERE key>=? AND key<? ORDER BY rowid LIMIT ? OFFSET ?').all(p,p+'~',limit+1,offset) as {key:string}[];
  return{entries:rows.slice(0,limit).map(row=>describe(db.loadState<Entry>(row.key)!,turnId??turn)),nextOffset:rows.length>limit?offset+limit:null};
 }
 if(name==='read_execution'){
  const {id,offset,limit,turnId}=schemas.read_execution.parse(input),saved=db.getMeta(prefix(turnId??turn)+id);if(!saved)throw new Error('This execution receipt does not belong to the current turn.');
  const entry=db.loadState<Entry>(prefix(turnId??turn)+id)!,text=JSON.stringify({name:entry.name,toolCallId:entry.toolCallId,input:entry.input,status:entry.result.is_error?'failed':'succeeded',result:textOf(entry.result.content)});
  return{id,text:text.slice(offset,offset+limit),totalCharacters:text.length,nextOffset:offset+limit<text.length?offset+limit:null};
 }
 throw new Error('Unknown execution-history tool.');
}

/** Preserve exact large results locally; models page them instead of receiving an unbounded dump. */
export function boundedToolResult(db:ProjectDB,turn:string,call:{id?:string;name?:string;input?:unknown},result:any){
 if(typeof result.content!=='string'||result.content.length<=16000)return result;
 const [entry]=archive(db,turn,[{role:'assistant',content:[{type:'tool_use',id:call.id,name:call.name,input:call.input}]},{role:'user',content:[result]}]);
 return{...result,content:JSON.stringify({partial:true,executionId:entry.id,toolCallId:call.id,totalCharacters:result.content.length,excerpt:result.content.slice(0,4000),read:'Use read_execution with this executionId as id to page the exact result. Do not infer omitted content.'})};
}
