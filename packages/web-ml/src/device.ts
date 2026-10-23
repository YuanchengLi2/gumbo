import type {Capabilities,Device,DType,ModelChoice,ModelSize} from './types';

/** Whisper exports with cross-attention outputs, which word timings need. Multilingual, so the language is detected. */
export const MODELS:Record<ModelSize,string>={base:'onnx-community/whisper-base_timestamped',small:'onnx-community/whisper-small_timestamped'};
/** Download sizes (MB) of the encoder and the merged decoder per precision, from the Hub listings (October 2026), plus
 * ~3 MB of tokenizer and configs. */
const ENCODER_MB:Record<ModelSize,Partial<Record<DType,number>>>={base:{fp16:41,fp32:83,q8:23},small:{fp16:177,fp32:353,q8:92}};
const DECODER_MB:Record<ModelSize,Partial<Record<DType,number>>>={base:{q4f16:69,q4:124,q8:54},small:{q4f16:146,q4:233,q8:157}};
/** WebGPU runs half precision where the GPU has it (half the download, faster); the CPU runs 8-bit weights. */
const precision=(device:Device,shaderF16:boolean,part:'encoder'|'decoder'):DType=>device==='wasm'?'q8':shaderF16?(part==='encoder'?'fp16':'q4f16'):(part==='encoder'?'fp32':'q4');
export function modelChoice(size:ModelSize,device:Device,decoderDevice:Device,shaderF16:boolean):ModelChoice{
 const encoder=precision(device,shaderF16,'encoder'),decoder=precision(decoderDevice,shaderF16,'decoder');
 return{size,repo:MODELS[size],device,decoderDevice,encoder,decoder,downloadMB:ENCODER_MB[size][encoder]!+DECODER_MB[size][decoder]!+3};
}
/** The encoder goes to the GPU when there is one: one large pass per window, 3–4x faster than the CPU on an Intel Iris
 * Xe. The decoder runs one small step per token, where WebGPU's per-dispatch cost dominates, so it stays on the CPU,
 * which was faster per token on the same machine (small: 106 ms against 116; whole runs 0.52 against 0.66 of real time).
 * small (better words, about twice the time of base) only where a GPU with fp16, memory and cores to spare suggest it can
 * keep up; the speed probe has the last word. */
export function chooseModel(caps:Capabilities,override:{size?:ModelSize;device?:Device;decoderDevice?:Device}={}):ModelChoice{
 const device=override.device??(caps.webgpu&&!caps.adapter?.fallback?'webgpu':'wasm'),decoderDevice=override.decoderDevice??'wasm';
 const roomy=(caps.deviceMemoryGB??8)>=8&&(caps.maxBufferMB??0)>=1024&&caps.cores>=8;
 return modelChoice(override.size??(device==='webgpu'&&caps.shaderF16&&roomy?'small':'base'),device,decoderDevice,caps.shaderF16);
}

export async function capabilities():Promise<Capabilities>{
 const nav=navigator as Navigator&{gpu?:{requestAdapter():Promise<any>};deviceMemory?:number};
 let adapter:any=null;try{adapter=await nav.gpu?.requestAdapter();}catch{}
 return{
  webgpu:!!adapter,shaderF16:!!adapter?.features?.has('shader-f16'),
  ...(adapter?{adapter:{vendor:adapter.info?.vendor??'',architecture:adapter.info?.architecture??'',fallback:!!adapter.info?.isFallbackAdapter},maxBufferMB:Math.round(adapter.limits.maxBufferSize/2**20)}:{}),
  ...(nav.deviceMemory?{deviceMemoryGB:nav.deviceMemory}:{}),cores:nav.hardwareConcurrency??4,crossOriginIsolated:!!globalThis.crossOriginIsolated,
 };
}

/** Speech decodes to about 110 tokens per 30-second window (150 words a minute plus segment timestamps), after the two
 * prompt steps; windows advance 26 s. */
export const TOKENS_PER_WINDOW=110;
export function estimateRtf(encoderMs:number,tokenMs:number,stepSec=26){return(encoderMs+(TOKENS_PER_WINDOW+2)*tokenMs)/(stepSec*1000);}
/** Local unless it would take over half the audio's length: an hour of footage should not take more than 30 minutes. */
export const LOCAL_RTF=.5;
