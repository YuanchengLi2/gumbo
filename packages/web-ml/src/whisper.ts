import {AutoProcessor,LogitsProcessor,ModelRegistry,StoppingCriteria,WhisperForConditionalGeneration,env,type Tensor} from '@huggingface/transformers';
import {languageName} from './languages';
import {SAMPLE_RATE,type DecodeWindow,type ModelChoice,type Progress,type Task,type WindowResult} from './types';

/** The text a 30-second window may decode to (Whisper's own sample length is 224 tokens); a window that reaches it was
 * looping, not talking. */
const MAX_TEXT_TOKENS=220;
const PUNCTUATION=/^[\p{P}\p{S}\s]+$/u;
const logSumExp=(scores:Float32Array)=>{let max=-Infinity;for(const s of scores)if(s>max)max=s;let sum=0;for(const s of scores)sum+=Math.exp(s-max);return max+Math.log(sum);};

type Ids={sot:number;eot:number;noSpeech:number;noTimestamps:number;tasks:Record<Task,number>;languages:Map<number,string>;languageIds:Map<string,number>;suppress:number[];beginSuppress:number[]};

/** Whisper's prompt is <|startoftranscript|> <|lang|> <|task|> <|notimestamps|>. Decoding starts after the first token so
 * the model itself names the language (transformers.js has no language detection and would assume English), from the
 * same encoder pass as the words. Also takes the no-speech probability where Whisper's own decoder does, applies its
 * token suppression, and keeps each text token's probability. Greedy decoding picks the top token, so its probability
 * here is the chosen token's. */
class Prefix extends LogitsProcessor{
 language='';languageProbability=0;noSpeechProb=0;probabilities:number[]=[];
 constructor(private ids:Ids,private task:Task,private forced?:number,private minTokens=0){super();}
 _call(inputIds:bigint[][],logits:Tensor){
  const scores=(logits as any)[0].data as Float32Array,step=inputIds[0].length-1,only=(id:number)=>{const keep=scores[id];scores.fill(-Infinity);scores[id]=Number.isFinite(keep)?keep:0;};
  if(step===0){
   const all=logSumExp(scores);this.noSpeechProb=Math.exp(scores[this.ids.noSpeech]-all);
   let best=-1,bestScore=-Infinity,sum=0;for(const id of this.ids.languages.keys()){sum+=Math.exp(scores[id]-all);if(scores[id]>bestScore){bestScore=scores[id];best=id;}}
   const chosen=this.forced??best;this.language=this.ids.languages.get(chosen)!;this.languageProbability=Math.exp(scores[chosen]-all)/sum;only(chosen);
  }
  else if(step===1)only(this.ids.tasks[this.task]);
  else if(step===2)only(this.ids.noTimestamps);
  else{
   // Text only: no special or timestamp tokens, none of Whisper's suppressed symbols, and no empty start.
   scores.fill(-Infinity,this.ids.eot+1);for(const id of this.ids.suppress)scores[id]=-Infinity;
   if(step===3)for(const id of this.ids.beginSuppress)scores[id]=-Infinity;
   if(step-3<this.minTokens)scores[this.ids.eot]=-Infinity;
   let max=-Infinity;for(const s of scores)if(s>max)max=s;this.probabilities[step+1]=Math.exp(max-logSumExp(scores));
  }
  return logits;
 }
}
class Abort extends StoppingCriteria{constructor(private signal:AbortSignal){super();}_call(inputIds:number[][]){return inputIds.map(()=>this.signal.aborted);}}

export type LoadedWhisper={choice:ModelChoice;decode:DecodeWindow;benchmark():Promise<{encoderMs:number;tokenMs:number}>;dispose():Promise<void>};

export async function isCached(choice:ModelChoice){
 try{return await ModelRegistry.is_cached(choice.repo,{device:choice.device,dtype:{encoder_model:choice.encoder,decoder_model_merged:choice.decoder}} as any);}catch{return false;}
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
 const model:any=await WhisperForConditionalGeneration.from_pretrained(choice.repo,{device:choice.device,dtype:{encoder_model:choice.encoder,decoder_model_merged:choice.decoder},progress_callback} as any);
 const tokenizer=processor.tokenizer,config=model.generation_config;
 const token=(text:string)=>tokenizer._tokenizer.token_to_id(text) as number|undefined;
 const languageIds=new Map<string,number>(Object.entries(config.lang_to_id as Record<string,number>).map(([t,id])=>[t.slice(2,-2),id]));
 const ids:Ids={sot:config.decoder_start_token_id,eot:Array.isArray(config.eos_token_id)?config.eos_token_id[0]:config.eos_token_id,noTimestamps:config.no_timestamps_token_id,
  noSpeech:token('<|nospeech|>')??token('<|nocaptions|>')??config.no_timestamps_token_id-1,tasks:{transcribe:config.task_to_id.transcribe,translate:config.task_to_id.translate},
  languages:new Map([...languageIds].map(([code,id])=>[id,code])),languageIds,suppress:config.suppress_tokens??[],beginSuppress:config.begin_suppress_tokens??[]};
 const textOf=new Map<number,string>(),text=(id:number):string=>{let t=textOf.get(id);if(t===undefined){t=tokenizer.decode([id]) as string;textOf.set(id,t);}return t;};

 async function run(samples:Float32Array,{language,task='transcribe',signal,minTokens=0,maxTokens=MAX_TEXT_TOKENS}:{language?:string;task?:Task;signal?:AbortSignal;minTokens?:number;maxTokens?:number}){
  const forced=language?ids.languageIds.get(language):undefined;if(language&&forced===undefined)throw new Error(`This model does not know the language "${language}".`);
  const {input_features}=await processor(samples),prefix=new Prefix(ids,task,forced,minTokens);
  const out=await model.generate({inputs:input_features,decoder_input_ids:[ids.sot],generation_config:{suppress_tokens:null,begin_suppress_tokens:null},max_new_tokens:3+maxTokens,output_attentions:true,return_dict_in_generate:true,logits_processor:[prefix],stopping_criteria:signal?[new Abort(signal)]:[]});
  try{
   signal?.throwIfAborted();
   const sequence=(out.sequences.tolist()[0] as bigint[]).map(Number),end=sequence.indexOf(ids.eot,4),tokens=sequence.slice(4,end<0?undefined:end);
   if(!tokens.length)return{prefix,tokens,words:[],truncated:false};
   // Cross-attention + DTW (OpenAI's alignment): row k is the decoder step whose input is token k, the step that
   // predicted token k+1, so token k is heard from times[k-1] to times[k]. The prompt's first three rows are skipped.
   const frames=Math.min(1500,Math.ceil(samples.length/(SAMPLE_RATE*.02)));
   const times=(model._extract_token_timestamps(out,config.alignment_heads,frames,.02,3).tolist()[0] as number[]);
   const [,,groups]=tokenizer.combineTokensIntoWords(tokens,languageName(prefix.language)) as [string[],number[][],number[][]];
   const words=groups.flatMap(group=>{
    // Punctuation is shown with its word but takes no time (a full stop would otherwise run on over the pause after it).
    const spoken=group.filter(i=>!PUNCTUATION.test(text(tokens[i]))),first=spoken[0]??group[0],last=spoken.at(-1)??group.at(-1)!;
    const word=tokenizer.decode(group.map(i=>tokens[i])).trim(),start=times[3+first],finish=Math.max(times[4+last],start+.02);
    const probability=Math.exp(group.reduce((sum,i)=>sum+Math.log(Math.max(1e-9,prefix.probabilities[4+i]??1)),0)/group.length);
    return word?[{word,start:Math.round(start*1000)/1000,end:Math.round(finish*1000)/1000,probability:Math.round(probability*1000)/1000}]:[];
   });
   return{prefix,tokens,words,truncated:end<0};
  }finally{await out.past_key_values?.dispose?.();}
 }

 const decode:DecodeWindow=async(samples,{language,task,signal})=>{
  const {prefix,tokens,words,truncated}=await run(samples,{language,task,signal});
  const logprobs=tokens.map((_,i)=>Math.log(Math.max(1e-9,prefix.probabilities[4+i]??1)));
  return{words,language:prefix.language,languageProbability:prefix.languageProbability,noSpeechProb:prefix.noSpeechProb,avgLogprob:logprobs.length?logprobs.reduce((a,b)=>a+b,0)/logprobs.length:0,tokens:tokens.length,truncated};
 };
 // The first run compiles the GPU kernels; do it now so the first window (and the probe) runs at real speed.
 await run(new Float32Array(SAMPLE_RATE),{language:'en',maxTokens:2});
 return{
  choice,decode,
  /** Encoder time for a window and decoder time per token, from 30 s of quiet noise decoded with a fixed token count. */
  async benchmark(){
   const noise=new Float32Array(30*SAMPLE_RATE);for(let i=0;i<noise.length;i++)noise[i]=(Math.random()-.5)*.02;
   const time=async(n:number)=>{const at=performance.now();await run(noise,{language:'en',minTokens:n,maxTokens:n});return performance.now()-at;};
   await time(1);const one=await time(1),many=await time(33),tokenMs=Math.max(0,(many-one)/32);
   return{encoderMs:Math.max(0,one-4*tokenMs),tokenMs};
  },
  async dispose(){await model.dispose();},
 };
}
