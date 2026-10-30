/** Tab's accuracy and speed, measured on writing with known continuations (test/fixtures/writing.ts): each moment goes
 * through the same prompt, recall and checks as the extension, to the real model, and the suggestion is scored against
 * what was actually written next. It runs this repository's gateway code (the fast lane included) on this computer with
 * the Anthropic key from .secrets/anthropic.env, so it measures the model before a deploy. It SPENDS MONEY (a cent or so
 * a run on Haiku); --budget stops it.
 *   npx tsx apps/extension/scripts/tab-meter.ts [--n=60] [--model=claude-haiku-5-5] [--budget=0.25] [--show=wrong|all]
 *   npx tsx apps/extension/scripts/tab-meter.ts --memory   (does Tab use the fact memory holds? 8 moments, under a cent)
 */
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {handleAI} from '../../../supabase/functions/dream-gateway/ai';
import {readMessageStream} from '../../../supabase/functions/_shared/stream';
import {tabRequest,emptyRecall} from '../src/shared/prompts';
import {cleanSuggestion,lastWordOf,agreed,alternativesOf} from '../src/shared/suggestion';
import {memoryMoments} from '../test/fixtures/memory-moments';
import {momentsFrom,score,summarize,type Moment,type Score} from '../src/shared/meter';
import {writing} from '../test/fixtures/writing';

const arg=(name:string,fallback:string)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.split('=')[1]??fallback;
const n=Number(arg('n','60')),model=arg('model','claude-haiku-5-5'),budget=Number(arg('budget','0.25')),show=arg('show','wrong'),samples=Number(arg('samples','1')),judging=process.argv.includes('--judge');
const root=resolve(import.meta.dirname,'../../..');
const env=(file:string)=>existsSync(file)?Object.fromEntries(readFileSync(file,'utf8').split(/\r?\n/).map(l=>/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)).filter(Boolean).map(m=>[m![1],m![2].replace(/^["']|["']$/g,'')])):{} as Record<string,string>;
const key=process.env.ANTHROPIC_API_KEY??env(resolve(root,'.secrets/anthropic.env')).ANTHROPIC_API_KEY??env(resolve(root,'.env.local')).ANTHROPIC_API_KEY;
if(!key)throw new Error('No ANTHROPIC_API_KEY in the environment, .secrets/anthropic.env or .env.local.');
const prices:Record<string,[number,number]>={'claude-haiku-5-5':[.1,.5],'claude-sonnet-5-5':[2,10],'claude-opus-5-5':[4,20]};
const db={rpc:async()=>({data:randomUUID()}),from:()=>({update:()=>({eq:async()=>({})})})};
let spent=0;

/** One prediction, or with --samples=2 two in parallel and the words they agree on. */
async function suggest(moment:Moment){
 if(samples<2)return predict(moment);
 const [a,b]=await Promise.all([predict(moment),predict(moment)]);
 return{suggestion:agreed(a.suggestion,b.suggestion),raw:`${a.raw} | ${b.raw}`,firstMs:Math.max(a.firstMs??Infinity,b.firstMs??Infinity)};
}
async function predict(moment:Moment){
 const {sample}=moment,context:any={site:sample.site,url:`https://${sample.site}/`,title:sample.title??'',language:'en',editor:'contenteditable',singleLine:!!sample.singleLine,intent:sample.intent,label:sample.label,thread:sample.thread,around:sample.page?[`Just above: ${sample.page}`]:undefined};
 // The writer's other writing in the same kind of field stands in for their memory.
 const recall={...emptyRecall(),style:writing.filter(w=>w!==sample&&w.intent===sample.intent).slice(0,3).map(w=>({site:w.site,intent:w.intent,text:w.text}))};
 const {system,messages,known}=tabRequest(context,moment.before,moment.after,recall);
 return complete(messages,system,known,moment.before,moment.after,!!sample.singleLine);
}
/** One run, as the extension asks it (memory/config.ts text: 30 tokens in a one-line field, 120 and room for the
 * alternatives elsewhere), and the best continuation through the same checks. */
async function complete(messages:any,system:string,known:string,before:string,after:string,singleLine:boolean){
 const started=performance.now();let firstMs:number|undefined,raw='';
 const result=await handleAI({model,system,messages,max_tokens:singleLine?30:160,purpose:'tab',stream:true,requestId:randomUUID()},'meter',{db,key,timeoutMs:30_000});
 if(!result.stream)throw new Error(JSON.stringify(result.body).slice(0,300));
 const message=await readMessageStream(new Response(result.stream),event=>{if(event.data?.delta?.type==='text_delta'){raw+=event.data.delta.text;if(firstMs===undefined&&/\S/.test(raw))firstMs=performance.now()-started;}}).catch(()=>null);
 const usage=message?.usage??{},price=prices[model]??[1,5];
 spent+=((usage.input_tokens??0)*price[0]+(usage.cache_read_input_tokens??0)*price[0]*.1+(usage.cache_creation_input_tokens??0)*price[0]*1.25+(usage.output_tokens??0)*price[1])/1e6;
 const suggestion=cleanSuggestion(alternativesOf(raw)[0]??'',{before,after,singleLine,known,final:true,lastWord:lastWordOf(before)});
 return{suggestion,raw,firstMs,cached:usage.cache_read_input_tokens??0};
}
/** --memory: moments whose right words need a fact only memory holds (test/fixtures/memory-moments.ts), given as
 * getContext gives it (their memory in the fresh part, who they are in the stable part): is the fact used? The facts
 * guard keeps anything not given out, so a fact can only be one of these. */
if(process.argv.includes('--memory')){
 let used=0,shown=0,firstMs:number[]=[];
 for(const m of memoryMoments){
  const context:any={site:m.site,url:`https://${m.site}/`,title:m.title??'',language:'en',editor:'contenteditable',singleLine:!!m.singleLine,intent:m.intent,label:m.label,thread:m.thread};
  const fresh=`<their_memory>\n${m.memory.map((x,i)=>`[${i+1}] ${x.title} (${x.when})\n${x.text}`).join('\n\n')}\n</their_memory>`;
  const stable=m.about?`<about_them>\n${m.about}\n</about_them>`:'';
  const {system,messages,known}=tabRequest(context,m.before,'',emptyRecall(),{stable,fresh,known:m.memory.map(x=>`${x.title} ${x.text}`).join('\n')});
  const r=await complete(messages,system,known,m.before,'',!!m.singleLine).catch(error=>({suggestion:'',raw:String(error),firstMs:undefined}));
  const hit=m.expect.some(e=>r.suggestion.toLowerCase().includes(e.toLowerCase()));
  if(r.suggestion)shown++;if(hit)used++;if(r.firstMs)firstMs.push(r.firstMs);
  console.log(`${hit?'used ':r.suggestion?'miss ':'none '} …${JSON.stringify(m.before.slice(-40))} → ${JSON.stringify(r.suggestion)}`);
 }
 firstMs.sort((a,b)=>a-b);
 console.log(`\n${model} with memory: the fact used in ${used}/${memoryMoments.length} · something shown in ${shown}/${memoryMoments.length} · first word median ${firstMs[Math.floor(firstMs.length/2)]?.toFixed(0)} ms · spent $${spent.toFixed(4)}`);
 process.exit(0);
}

/** With --judge: a suggestion worded differently from what was written is asked about: would the writer have gladly
 * taken it (same meaning, nothing false)? Then it counts as close. */
async function judge(moment:Moment,suggestion:string){
 const s=moment.sample,prompt=`A person was writing in a ${s.intent} field ("${s.label}") on ${s.site}.
What they had typed so far: «${moment.before.slice(-400)}»
What they actually typed next: «${moment.truth}»
The autocomplete suggested: «${suggestion}»
Would this person have been glad to accept that suggestion as what they were about to write? Other wording is fine; anything false, unwanted or off-topic is not. Answer yes or no.`;
 const result=await handleAI({model:'claude-haiku-5-5',system:'You judge autocomplete suggestions. Answer only yes or no.',messages:[{role:'user',content:prompt}],max_tokens:16,purpose:'tab',stream:false,requestId:randomUUID()},'meter',{db,key,timeoutMs:30_000});
 const usage=result.body?.usage??{};spent+=((usage.input_tokens??0)*.1+(usage.output_tokens??0)*.5)/1e6;
 return /^\s*yes/i.test((result.body?.content??[]).map((b:any)=>b.text??'').join(''));
}
const moments=momentsFrom(writing,n),results:{moment:Moment;suggestion:string;raw:string;truth:string;score:Score;firstMs?:number}[]=[];
for(let i=0;i<moments.length;i+=4){
 if(spent>=budget){console.log(`Stopped at the $${budget} budget.`);break;}
 await Promise.all(moments.slice(i,i+4).map(async moment=>{
  try{const {suggestion,raw,firstMs}=await suggest(moment);let scored=score(suggestion,moment.truth);if(judging&&scored==='wrong'&&await judge(moment,suggestion))scored='close';results.push({moment,suggestion,raw,firstMs,truth:moment.truth,score:scored});}
  catch(error){console.log('failed:',(error as Error).message);}
 }));
}
const tail=(text:string)=>JSON.stringify(text.slice(-50));
for(const r of results)if(show==='all'||r.score==='wrong')console.log(`${r.score.padEnd(5)} ${r.moment.sample.intent.padEnd(8)} …${tail(r.moment.before)}  →  ${JSON.stringify(r.suggestion)}   (wrote ${JSON.stringify(r.moment.truth.slice(0,60))})${r.raw.trim()!==r.suggestion.trim()?`  [model: ${JSON.stringify(r.raw.slice(0,70))}]`:''}`);
const s=summarize(results);
console.log(`\n${model}: ${s.n} moments · shown ${(s.showRate*100).toFixed(0)}% · when shown, right ${(s.precision*100).toFixed(0)}% (exact ${s.exact}, close ${s.close}, wrong ${s.wrong}), first word right ${(s.firstWordRight*100).toFixed(0)}% · first word median ${s.medianFirstMs?.toFixed(0)} ms, 90% under ${s.p90FirstMs?.toFixed(0)} ms (model and network, from this computer) · spent $${spent.toFixed(4)}`);
