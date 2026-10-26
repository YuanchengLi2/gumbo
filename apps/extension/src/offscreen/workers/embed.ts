/** The embedding model (bge-small, shipped in the extension) in a worker of its own: texts in, unit vectors out. It never
 * fetches anything: the model and ONNX Runtime load from the extension's own files. */
import {pipeline,env} from '@huggingface/transformers';
import {EMBEDDING} from '../../shared/embedding';
env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath=new URL('/models/',self.location.href).href;
const onnx=(env.backends.onnx as any).wasm;onnx.wasmPaths=new URL('/ort/',self.location.href).href;
onnx.numThreads=(self as any).crossOriginIsolated?Math.max(1,Math.min(4,(navigator.hardwareConcurrency||2)-1)):1;
let extractor:any;
self.onmessage=async(event:MessageEvent<{id:number;texts:string[]}>)=>{
 const {id,texts}=event.data;
 try{
  extractor??=await pipeline('feature-extraction',EMBEDDING.model,{dtype:'q8',device:'wasm'});
  const out=await extractor(texts,{pooling:EMBEDDING.pooling,normalize:true});
  (self as any).postMessage({id,vectors:out.tolist()});
 }catch(error){(self as any).postMessage({id,error:String((error as Error)?.message??error)});}
};
