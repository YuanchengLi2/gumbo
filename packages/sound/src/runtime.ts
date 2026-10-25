import type {SoundModels} from './analyse';

/** The two models, pinned to a revision and checked by hash. Both are Apache-2.0:
 *  - YAMNet (Google), the AudioSet sound classifier, as converted to ONNX with its spectrogram front end inside;
 *  - CAM++ (3D-Speaker, Alibaba), a speaker embedding model trained on VoxCeleb, as exported by sherpa-onnx. */
export type SoundModelFile={id:'yamnet'|'speaker';filename:string;url:string;sha256:string;bytes:number};
export const soundModelFiles:SoundModelFile[]=[
 {id:'yamnet',filename:'yamnet.onnx',url:'https://huggingface.co/audiomagic/yamnet-onnx/resolve/f25b741c2f0bdc6d7e6db24b5fddda23347dbafd/yamnet.onnx',sha256:'d3835ffbbd4a1bb3e777f0ca217b5007907f5171dd5d17c4236b95b2af8f908e',bytes:16093355},
 {id:'speaker',filename:'campplus_en_voxceleb_16k.onnx',url:'https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/0743f301363dec56491a490f6d6cbc9d67f9a3bf/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx',sha256:'357a834f702b80161e5b981182c038e18553c1f2ca752ed6cec2052365d4129b',bytes:29596978},
];

/** The part of ONNX Runtime used here, the same in onnxruntime-node (the desktop: native, about ten times faster, and it
 * runs the models on its own threads, so the service it shares a process with keeps going) and onnxruntime-web (the
 * browser: WebAssembly, in a worker of its own). */
type Tensor={data:unknown;dims:readonly number[]};
type Session={inputNames:readonly string[];outputNames:readonly string[];run(feeds:Record<string,Tensor>):Promise<Record<string,Tensor>>;release():Promise<void>};
export type OnnxRuntime={InferenceSession:{create(model:Uint8Array,options?:object):Promise<Session>};Tensor:new(type:'float32',data:Float32Array,dims:number[])=>Tensor};

export type LoadedSoundModels=SoundModels&{release():Promise<void>};
/** Both models on the given runtime. load gives a model's bytes (from disk, or downloaded and checked); sessionOptions
 * picks the execution provider and threads. */
export async function loadSoundModels(ort:OnnxRuntime,load:(file:SoundModelFile)=>Promise<Uint8Array>,sessionOptions:object={}):Promise<LoadedSoundModels>{
 // One after the other: WebGPU creates one session at a time.
 const yamnet=await ort.InferenceSession.create(await load(soundModelFiles[0]),sessionOptions),speaker=await ort.InferenceSession.create(await load(soundModelFiles[1]),sessionOptions);
 return{
  async classify(wave){
   const out=await yamnet.run({[yamnet.inputNames[0]]:new ort.Tensor('float32',wave,[wave.length])}),scores=out[yamnet.outputNames[0]],mel=out[yamnet.outputNames[2]];
   return{scores:scores.data as Float32Array,frames:scores.dims[0],logMel:mel.data as Float32Array,rows:mel.dims[0]};
  },
  async embed(features,frames,count){
   const out=await speaker.run({[speaker.inputNames[0]]:new ort.Tensor('float32',features,[count,frames,features.length/frames/count])}),data=out[speaker.outputNames[0]].data as Float32Array,size=data.length/count;
   return Array.from({length:count},(_,k)=>data.slice(k*size,(k+1)*size));
  },
  async release(){await Promise.all([yamnet.release(),speaker.release()]);},
 };
}
