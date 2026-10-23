import {AutoProcessor,LogitsProcessor,ModelRegistry,StoppingCriteria,WhisperForConditionalGeneration,env,type Tensor} from '@huggingface/transformers';
import {languageName} from './languages';
import {SAMPLE_RATE,type DecodeWindow,type ModelChoice,type Progress,type Task} from './types';

/** Tokens a 30-second window may decode to (Whisper's own sample length is 224); a window that reaches it was looping. */
const MAX_TOKENS=222;
/** The first segment starts within the window's first second (Whisper's max_initial_timestamp). */
const MAX_INITIAL=50;
const PUNCTUATION=/^[\p{P}\p{S}\s]+$/u;
const logSumExp=(scores:Float32Array,from=0,to=scores.length)=>{let max=-Infinity;for(let i=from;i<to;i++)if(scores[i]>max)max=scores[i];if(max===-Infinity)return max;let sum=0;for(let i=from;i<to;i++)sum+=Math.exp(scores[i]-max);return max+Math.log(sum);};

type Ids={sot:number;eot:number;noSpeech:number;timestampBegin:number;tasks:Record<Task,number>;languages:Map<number,string>;languageIds:Map<string,number>;suppress:number[]};

/** Whisper's decoding rules, as its own `transcribe` applies them. The prompt is <|startoftranscript|> <|lang|> <|task|>
 * and decoding starts after its first token, so the model itself names the language (transformers.js has no language
 * detection and would assume English) from the same encoder pass as the words; that step also gives the no-speech
 * probability. Then timestamped segments, <|0.00|> text <|2.40|><|2.40|> text …: without timestamps Whisper often stops
 * after the first sentence of a window that starts mid-speech. Each token's probability is kept (greedy decoding takes
 * the top token, so it is the chosen token's). */
class Rules extends LogitsProcessor{
 language='';languageProbability=0;noSpeechProb=0;probabilities:number[]=[];
 constructor(private ids:Ids,private task:Task,private forced?:number,private minText=0){super();}
 _call(inputIds:bigint[][],logits:Tensor){
  const scores=(logits as any)[0].data as Float32Array,step=inputIds[0].length-1,{eot,timestampBegin:tb}=this.ids;
  const only=(id:number)=>{const keep=scores[id];scores.fill(-Infinity);scores[id]=Number.isFinite(keep)?keep:0;};
  if(step===0){
   const all=logSumExp(scores);this.noSpeechProb=Math.exp(scores[this.ids.noSpeech]-all);
   let best=-1,sum=0;for(const id of this.ids.languages.keys()){sum+=Math.exp(scores[id]-all);if(best<0||scores[id]>scores[best])best=id;}
   const chosen=this.forced??best;this.language=this.ids.languages.get(chosen)!;this.languageProbability=Math.exp(scores[chosen]-all)/sum;only(chosen);
   return logits;
  }
  if(step===1){only(this.ids.tasks[this.task]);return logits;}
  // Text, timestamps and the end only; none of Whisper's suppressed symbols.
  scores.fill(-Infinity,eot+1,tb);for(const id of this.ids.suppress)scores[id]=-Infinity;
  const seq=inputIds[0].slice(3).map(Number);
  if(!seq.length){scores.fill(-Infinity,0,tb);scores.fill(-Infinity,tb+MAX_INITIAL+1);}
  else{
   // Timestamps come in pairs around text; after a segment closes, the next opens or decoding ends.
   const last=seq.at(-1)!>=tb,penultimate=seq.length<2||seq.at(-2)!>=tb;
   if(last){if(penultimate)scores.fill(-Infinity,tb);else scores.fill(-Infinity,0,eot);}
   // Time never runs backwards, and a segment lasts more than nothing.
   let stamp=-1;for(const t of seq)if(t>=tb)stamp=t;
   if(stamp>=0)scores.fill(-Infinity,tb,last&&!penultimate?stamp:stamp+1);
   // When timestamps together are likelier than any one text token, it is a timestamp.
   const all=logSumExp(scores),stamps=logSumExp(scores,tb);let text=-Infinity;for(let id=0;id<tb;id++)if(scores[id]>text)text=scores[id];
   if(stamps>text)scores.fill(-Infinity,0,tb);
  }
  // For the benchmark: a fixed amount of text.
  if(seq.filter(t=>t<eot).length<this.minText)scores[eot]=-Infinity;
  let max=-Infinity;for(const s of scores)if(s>max)max=s;this.probabilities[step+1]=Math.exp(max-logSumExp(scores));
  return logits;
 }
}
class Abort extends StoppingCriteria{constructor(private signal:AbortSignal){super();}_call(inputIds:number[][]){return inputIds.map(()=>this.signal.aborted);}}

export type LoadedWhisper={choice:ModelChoice;decode:DecodeWindow;benchmark():Promise<{encoderMs:number;tokenMs:number}>;dispose():Promise<void>};

// Keyed by file (loading) and by session (the cache check calls the encoder "model").
const sessions=(choice:ModelChoice)=>({device:{model:choice.device,encoder_model:choice.device,decoder_model_merged:choice.decoderDevice},dtype:{model:choice.encoder,encoder_model:choice.encoder,decoder_model_merged:choice.decoder}});
export async function isCached(choice:ModelChoice){
 try{return await ModelRegistry.is_cached(choice.repo,sessions(choice) as any);}catch{return false;}
}

/** Loads (downloading once into the Cache API, which transformers.js uses in browsers) and warms a Whisper model. */
export async function loadWhisper(choice:ModelChoice,onProgress?:(progress:Progress)=>void,options:{wasmPaths?:string}={}):Promise<LoadedWhisper>{
 env.allowLocalModels=false;env.useBrowserCache=true;
 if(options.wasmPaths)(env.backends.onnx as any).wasm.wasmPaths=options.wasmPaths;
 const files=new Map<string,{file:string;loaded:number;total:number;progress:number}>();
 const progress_callback=(info:any)=>{
  if(info.status!=='progress'||!info.total)return;
  files.set(info.file,{file:info.file,loaded:info.loaded,total:info.total,progress:info.progress});
  let loaded=0,total=0;for(const f of files.values()){loaded+=f.loaded;total+=f.total;}
  onProgress?.({stage:'download',files:[...files.values()],loaded,total});
 };
 const processor:any=await AutoProcessor.from_pretrained(choice.repo,{progress_callback});
 const model:any=await WhisperForConditionalGeneration.from_pretrained(choice.repo,{...sessions(choice),progress_callback} as any);
 const tokenizer=processor.tokenizer,config=model.generation_config;
 const token=(text:string)=>tokenizer._tokenizer.token_to_id(text) as number|undefined;
 const languageIds=new Map<string,number>(Object.entries(config.lang_to_id as Record<string,number>).map(([t,id])=>[t.slice(2,-2),id]));
 const ids:Ids={sot:config.decoder_start_token_id,eot:Array.isArray(config.eos_token_id)?config.eos_token_id[0]:config.eos_token_id,timestampBegin:config.no_timestamps_token_id+1,
  noSpeech:token('<|nospeech|>')??token('<|nocaptions|>')??config.no_timestamps_token_id-1,tasks:{transcribe:config.task_to_id.transcribe,translate:config.task_to_id.translate},
  languages:new Map([...languageIds].map(([code,id])=>[id,code])),languageIds,suppress:config.suppress_tokens??[]};
 const textOf=new Map<number,string>(),text=(id:number):string=>{let t=textOf.get(id);if(t===undefined){t=tokenizer.decode([id]) as string;textOf.set(id,t);}return t;};

 async function run(samples:Float32Array,{language,task='transcribe',signal,minText=0,maxTokens=MAX_TOKENS}:{language?:string;task?:Task;signal?:AbortSignal;minText?:number;maxTokens?:number}){
  const forced=language?ids.languageIds.get(language):undefined;if(language&&forced===undefined)throw new Error(`This model does not know the language "${language}".`);
  const length=samples.length/SAMPLE_RATE,{input_features}=await processor(samples),rules=new Rules(ids,task,forced,minText);
  // transformers.js's own Whisper processors are off (suppress_tokens: null etc.): Rules applies them, in order.
  const out=await model.generate({inputs:input_features,decoder_input_ids:[ids.sot],generation_config:{suppress_tokens:null,begin_suppress_tokens:null},max_new_tokens:2+maxTokens,output_attentions:true,return_dict_in_generate:true,logits_processor:[rules],stopping_criteria:signal?[new Abort(signal)]:[]});
  try{
   signal?.throwIfAborted();
   const sequence=(out.sequences.tolist()[0] as bigint[]).map(Number),end=sequence.indexOf(ids.eot,3),stop=end<0?sequence.length:end;
   // Segments from the timestamp pairs; text after the last timestamp (cut off by the window's end) runs to the end.
   const segments:{start:number;end:number;at:number[]}[]=[];let open:{start:number;at:number[]}|undefined;
   for(let p=3;p<stop;p++){const t=sequence[p];
    if(t>=ids.timestampBegin){const time=(t-ids.timestampBegin)*.02;if(open?.at.length){segments.push({...open,end:time});open=undefined;}else open={start:time,at:[]};}
    else if(t<ids.eot)(open??={start:segments.at(-1)?.end??0,at:[]}).at.push(p);
   }
   if(open?.at.length)segments.push({...open,end:length});
   const textAt=segments.flatMap(s=>s.at);
   if(!textAt.length)return{rules,textAt,words:[],truncated:false};
   // Cross-attention + DTW (OpenAI's alignment): row k is the decoder step whose input is token k, the step that
   // predicted token k+1, so token k is heard from times[k-1] to times[k]. The prompt's three rows are skipped.
   const frames=Math.min(1500,Math.ceil(length/.02)),times=model._extract_token_timestamps(out,config.alignment_heads,frames,.02,3).tolist()[0] as number[];
   const words=segments.flatMap(segment=>{
    const [,,groups]=tokenizer.combineTokensIntoWords(segment.at.map(p=>sequence[p]),languageName(rules.language)) as [string[],number[][],number[][]];
    return groups.flatMap(group=>{
     const at=group.map(i=>segment.at[i]);
     // Punctuation is shown with its word but takes no time (a full stop would otherwise run on over the pause after it).
     const spoken=at.filter(p=>!PUNCTUATION.test(text(sequence[p]))),first=spoken[0]??at[0],last=spoken.at(-1)??at.at(-1)!;
     // Kept inside its segment, whose timestamps the model chose with the words.
     const start=Math.min(Math.max(times[first-1],segment.start),segment.end),finish=Math.min(Math.max(times[last],start+.02),Math.max(segment.end,start+.02));
     const word=(tokenizer.decode(at.map(p=>sequence[p])) as string).trim(),probability=Math.exp(at.reduce((sum,p)=>sum+Math.log(Math.max(1e-9,rules.probabilities[p]??1)),0)/at.length);
     return word?[{word,start:Math.round(start*1000)/1000,end:Math.round(finish*1000)/1000,probability:Math.round(probability*1000)/1000}]:[];
    });
   });
   return{rules,textAt,words,truncated:end<0};
  }finally{await out.past_key_values?.dispose?.();}
 }

 const decode:DecodeWindow=async(samples,{language,task,signal})=>{
  const {rules,textAt,words,truncated}=await run(samples,{language,task,signal});
  const logprobs=textAt.map(p=>Math.log(Math.max(1e-9,rules.probabilities[p]??1)));
  return{words,language:rules.language,languageProbability:rules.languageProbability,noSpeechProb:rules.noSpeechProb,avgLogprob:logprobs.length?logprobs.reduce((a,b)=>a+b,0)/logprobs.length:0,tokens:textAt.length,truncated};
 };
 // The first run compiles the GPU kernels; do it now so the first window (and the probe) runs at real speed.
 await run(new Float32Array(SAMPLE_RATE),{language:'en',maxTokens:2});
 return{
  choice,decode,
  /** Encoder time for a window and decoder time per token: 30 s of quiet noise decoded to a fixed number of tokens. */
  async benchmark(){
   const noise=new Float32Array(30*SAMPLE_RATE);for(let i=0;i<noise.length;i++)noise[i]=(Math.random()-.5)*.02;
   const time=async(n:number)=>{const at=performance.now();await run(noise,{language:'en',minText:n,maxTokens:n});return performance.now()-at;};
   await time(2);const few=await time(2),many=await time(34),tokenMs=Math.max(0,(many-few)/32);
   return{encoderMs:Math.max(0,few-4*tokenMs),tokenMs};
  },
  async dispose(){await model.dispose();},
 };
}
