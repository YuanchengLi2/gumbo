import type {Capabilities,Device,DType,ModelChoice,ModelSize} from './types';

/** Whisper exports with cross-attention outputs, which word timings need. Multilingual, so the language is detected. */
export const MODELS:Record<ModelSize,string>={base:'onnx-community/whisper-base_timestamped',small:'onnx-community/whisper-small_timestamped'};
/** Download sizes (MB) of encoder + merged decoder per precision, from the Hub listings (October 2026). */
const SIZES:Record<ModelSize,Record<string,number>>={
 base:{'fp16+q4f16':110,'fp32+q4':206,'q8+q8':77},
 small:{'fp16+q4f16':322,'fp32+q4':586,'q8+q8':249},
};
/** WebGPU runs half precision where the GPU has it (half the download, faster); the CPU runs 8-bit weights. */
export function precision(device:Device,shaderF16:boolean):{encoder:DType;decoder:DType}{
 return device==='wasm'?{encoder:'q8',decoder:'q8'}:shaderF16?{encoder:'fp16',decoder:'q4f16'}:{encoder:'fp32',decoder:'q4'};
}
export function modelChoice(size:ModelSize,device:Device,shaderF16:boolean):ModelChoice{
 const {encoder,decoder}=precision(device,shaderF16);
 return{size,repo:MODELS[size],device,encoder,decoder,downloadMB:SIZES[size][`${encoder}+${decoder}`]};
}
/** small (better words, ~3x the work) on a real GPU with memory to spare; base on the CPU or a tight machine. The speed
 * probe has the last word: a device too slow for small is moved to base, and one too slow for base to the cloud. */
export function chooseModel(caps:Capabilities,override:{size?:ModelSize;device?:Device}={}):ModelChoice{
 const device=override.device??(caps.webgpu&&!caps.adapter?.fallback?'webgpu':'wasm');
 const roomy=(caps.deviceMemoryGB??8)>=8&&(caps.maxBufferMB??0)>=1024;
 return modelChoice(override.size??(device==='webgpu'&&caps.shaderF16&&roomy?'small':'base'),device,device==='webgpu'&&caps.shaderF16);
}

export async function capabilities():Promise<Capabilities>{
 const nav=navigator as Navigator&{gpu?:{requestAdapter(o?:object):Promise<any>};deviceMemory?:number};
 let adapter:any=null;try{adapter=await nav.gpu?.requestAdapter({powerPreference:'high-performance'});}catch{}
 return{
  webgpu:!!adapter,shaderF16:!!adapter?.features?.has('shader-f16'),
  ...(adapter?{adapter:{vendor:adapter.info?.vendor??'',architecture:adapter.info?.architecture??'',fallback:!!adapter.info?.isFallbackAdapter},maxBufferMB:Math.round(adapter.limits.maxBufferSize/2**20)}:{}),
  ...(nav.deviceMemory?{deviceMemoryGB:nav.deviceMemory}:{}),cores:nav.hardwareConcurrency??4,crossOriginIsolated:!!globalThis.crossOriginIsolated,
 };
}

/** Speech runs about 100 tokens per 30-second window (150 words a minute); windows advance 26 s. */
export const TOKENS_PER_WINDOW=100;
export function estimateRtf(encoderMs:number,tokenMs:number,stepSec=26){return(encoderMs+(TOKENS_PER_WINDOW+3)*tokenMs)/(stepSec*1000);}
/** Local unless it would take over half the audio's length: an hour of footage should not take more than 30 minutes. */
export const LOCAL_RTF=.5;
