/** Replays a finished agent run offline to compare what it cost with what it would cost under other context settings,
 * without calling any model: npx tsx scripts/replay-cost.ts <copy of a project folder> <turn id> [phase].
 * Work on a copy (compaction saves its plan in the project database). The run's own messages are taken from its
 * checkpoint; for each model call the prompt it would have sent is rebuilt (with the compaction the setting allows),
 * and priced with the app's billing formula (usageCost): the part identical to the previous prompt is a cache read, the
 * rest is new input, and the output is what the call really wrote. On Anthropic models new input is written to the cache
 * (1.25x) in the share the run's own calls wrote it. Token counts are calibrated against the run's real usage. */
import {ProjectDB} from '@dream/project-db';
import {usageCost} from '../packages/config/src/pricing';
import {estimateTokens} from '../packages/orchestrator/src/context-budget';
import {providerView,conversationBytes} from '../packages/orchestrator/src/conversation';
import {capText} from '../packages/orchestrator/src/code-agent';
import {deepCompaction} from '../packages/orchestrator/src/inference';

type Call={prompt:number;output:number;cost:number};
/** target: compact once a prompt passes it; to: the prompt size compaction aims for (default: half of target, as before
 * October 18); gap: calls that must pass after a compaction before another, unless a prompt passes 1.5 x target;
 * cap/keep: tool results capped at cap characters except the tools in keep; warm: the system prompt and tools are
 * already cached when the run starts (a cache key shared across requests). */
export type Setting={name:string;target?:number;to?:number;gap?:number;cap?:number;keep?:string[];warm?:boolean};

const [folder,turn,phase='main']=process.argv.slice(2);
const db=new ProjectDB(folder);
const checkpoint=db.loadState<any>(`code-agent:${turn}:${phase}`);if(!checkpoint)throw new Error('No checkpoint for that turn.');
const model=String(checkpoint.model??'');
const rows=db.db.prepare("SELECT input_tokens,cache_read,cache_write,output_tokens,cost_usd FROM ai_usage WHERE turn_id=? AND purpose='execution' AND phase=? ORDER BY created_at").all(turn,phase) as any[];
const calls=rows.map(r=>({prompt:r.input_tokens+r.cache_read+r.cache_write,output:r.output_tokens,cost:r.cost_usd} as Call));
const written=rows.reduce((n,r)=>n+r.cache_write,0),writeShare=written/Math.max(1,written+rows.reduce((n,r)=>n+r.input_tokens,0));
const price=(fresh:number,cached:number,output:number)=>usageCost(model,{input_tokens:fresh*(1-writeShare),cache_creation_input_tokens:fresh*writeShare,cache_read_input_tokens:cached,output_tokens:output});
const messages:any[]=checkpoint.messages,assistantAt=messages.flatMap((m,i)=>m.role==='assistant'?[i]:[]);
if(assistantAt.length!==calls.length)console.warn(`The checkpoint has ${assistantAt.length} assistant messages and the run made ${calls.length} calls; the first ${Math.min(assistantAt.length,calls.length)} are compared.`);
const steps=Math.min(assistantAt.length,calls.length);

// Calibrate: the real prompt of each call against the estimate of the history it carried (system and tools are a
// constant), over the calls before the run first compacted (where a real prompt shrinks), which carried their whole history.
const estimates=assistantAt.slice(0,steps).map(at=>estimateTokens(messages.slice(0,at)));
let n=steps;for(let k=1;k<steps;k++)if(calls[k].prompt<calls[k-1].prompt*.9){n=k;break;}
const mx=estimates.slice(0,n).reduce((a,b)=>a+b,0)/n,my=calls.slice(0,n).reduce((a,c)=>a+c.prompt,0)/n;
const slope=estimates.slice(0,n).reduce((s,x,i)=>s+(x-mx)*(calls[i].prompt-my),0)/estimates.slice(0,n).reduce((s,x)=>s+(x-mx)**2,0),base=my-slope*mx;
const tokens=(list:any[])=>slope*estimateTokens(list);

function replay(setting:Setting){
 const scratch=`replay:${setting.name}:${Date.now()}`;let previous:any[]=[],total=0,peak=0,compactions=0,last=-1e9;const perCall:number[]=[];
 // Results capped at setting.cap characters, except the tools named in keep (their results are read in pages anyway).
 const names=new Map<string,string>();for(const m of messages)if(Array.isArray(m.content))for(const b of m.content)if(b.type==='tool_use')names.set(b.id,b.name);
 const capped=setting.cap?messages.map(m=>Array.isArray(m.content)?{...m,content:m.content.map((b:any)=>b.type==='tool_result'&&!setting.keep?.includes(names.get(b.tool_use_id)??'')?{...b,content:capText(b.content,'replay',setting.cap)}:b)}:m):messages;
 for(let k=0;k<steps;k++){
  const history=capped.slice(0,assistantAt[k]);
  let view=providerView(db,turn,scratch,history);
  // As inference does: past the target, compact (to half of it unless setting.to says otherwise), at most once every
  // setting.gap calls unless the prompt passes 1.5 x target, so later calls append to a stable, cached prefix.
  const size=base+tokens(view);
  if(setting.target&&size>setting.target&&(k-last>=(setting.gap??0)||size>setting.target*1.5)){
   const ratio=setting.to?deepCompaction(view,(setting.to-base)/Math.max(1,size-base)):Math.max(.2,setting.target/size*.5);
   view=providerView(db,turn,scratch,history,Math.floor(conversationBytes(view)*ratio));compactions++;last=k;}
  let same=0;while(same<view.length&&same<previous.length&&JSON.stringify(view[same])===JSON.stringify(previous[same]))same++;
  const prompt=base+tokens(view),cached=k?base+tokens(view.slice(0,same)):setting.warm?base:0,fresh=prompt-cached;
  const cost=price(fresh,cached,calls[k].output);
  total+=cost;peak=Math.max(peak,prompt);perCall.push(cost);previous=view;
 }
 return{name:setting.name,total,peak:Math.round(peak),compactions,last10:perCall.slice(-10).reduce((a,b)=>a+b,0)/Math.min(10,perCall.length)};
}

const real=calls.slice(0,steps).reduce((a,c)=>a+c.cost,0);
console.log(`${model}: ${steps} calls; real cost $${real.toFixed(3)}; calibration over the first ${n} calls: prompt ≈ ${Math.round(base)} + ${slope.toFixed(2)} × estimate`);
const settings:Setting[]=JSON.parse(process.env.SETTINGS??'[{"name":"60k to half (Oct 18 morning)","target":60000,"cap":12000,"keep":["read_file"]}]');
for(const s of settings){const r=replay(s);console.log(`${r.name.padEnd(40)} $${r.total.toFixed(3)}  largest prompt ${r.peak} tokens  compactions ${r.compactions}  last 10 calls $${r.last10.toFixed(4)} each`);}
