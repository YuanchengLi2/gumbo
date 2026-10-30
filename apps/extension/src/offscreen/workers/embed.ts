/** The embedding model (bge-small, shipped in the extension) in a worker of its own: texts in, unit vectors out. It never
 * fetches anything: the model and ONNX Runtime load from the extension's own files. */
import {pipeline,env} from '@huggingface/transformers';
import {EMBEDDING} from '../../shared/embedding';
env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath=new URL('/models/',self.location.href).href;
const onnx=(env.backends.onnx as any).wasm;onnx.wasmPaths=new URL('/ort/',self.location.href).href;
onnx.numThreads=(self as any).crossOriginIsolated?Math.max(1,Math.min(4,(navigator.hardwareConcurrency||2)-1)):1;
let extractor:Promise<any>|undefined,queue:Promise<void>=Promise.resolve();
/** One request at a time: the model's session runs one batch at once, and two at once (memory filling in while a moment
 * is weighed) left one of them waiting for good. Requests are small (shared/embedding.ts EMBED_BATCH), so a question
 * never waits long behind the background's. */
self.onmessage=(event:MessageEvent<{id:number;texts:string[]}>)=>{
 const {id,texts}=event.data;
 queue=queue.then(async()=>{
  try{
   extractor??=pipeline('feature-extraction',EMBEDDING.model,{dtype:'q8',device:'wasm'});
   const out=await (await extractor)(texts,{pooling:EMBEDDING.pooling,normalize:true});
   (self as any).postMessage({id,vectors:out.tolist()});
  }catch(error){(self as any).postMessage({id,error:String((error as Error)?.message??error)});}
 });
};
