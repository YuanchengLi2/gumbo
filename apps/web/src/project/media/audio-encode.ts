import {Output,Mp4OutputFormat,Mp3OutputFormat,WavOutputFormat,StreamTarget,BufferTarget,AudioSample,AudioSampleSource,canEncodeAudio,type OutputFormat,type AudioCodec} from 'mediabunny';
import {registerAacEncoder} from '@mediabunny/aac-encoder';
import {registerMp3Encoder} from '@mediabunny/mp3-encoder';
import {writable,remove} from './paths';

/** Sound encoded as the export and Roux's tools need it: AAC in MP4 (an .m4a), MP3 or 16-bit WAV. The browser's own
 * encoder is used when it takes the settings (WebCodecs), mediabunny's WebAssembly one otherwise (Chromium has no MP3
 * encoder, and Windows' AAC encoder stops at 192 kb/s). */
export type AudioFormat='aac'|'mp3'|'wav';
const formats:Record<AudioFormat,{codec:AudioCodec;format:()=>OutputFormat;register:()=>void}>={
 aac:{codec:'aac',format:()=>new Mp4OutputFormat({fastStart:false}),register:registerAacEncoder},
 mp3:{codec:'mp3',format:()=>new Mp3OutputFormat(),register:registerMp3Encoder},
 wav:{codec:'pcm-s16',format:()=>new WavOutputFormat(),register:()=>{}},
};
const registered=new Set<AudioFormat>();

/** Encodes planar float blocks (one array per channel) to `output`, or to memory when there is none (the bytes are
 * returned). A failed or stopped encode leaves no file behind. */
export async function encodeAudio(blocks:AsyncIterable<Float32Array[]>|Iterable<Float32Array[]>,options:{format:AudioFormat;rate:number;channels:number;bitrate:number},output?:string,signal?:AbortSignal):Promise<Uint8Array|undefined>{
 const {format,rate,channels,bitrate}=options,encoder=formats[format];
 if(!registered.has(format)&&!await canEncodeAudio(encoder.codec,{numberOfChannels:channels,sampleRate:rate,bitrate})){encoder.register();registered.add(format);}
 const file=output?await writable(output):undefined,memory=file?undefined:new BufferTarget();
 const out=new Output({format:encoder.format(),target:file?new StreamTarget(file as unknown as WritableStream<any>,{chunked:true}):memory!});
 const source=new AudioSampleSource({codec:encoder.codec,bitrate});out.addAudioTrack(source);await out.start();
 try{
  let at=0;
  for await(const planes of blocks){
   signal?.throwIfAborted();const n=planes[0]?.length??0;if(!n)continue;
   const data=new Float32Array(n*channels);for(let c=0;c<channels;c++)data.set(planes[Math.min(c,planes.length-1)],c*n);
   const sample=new AudioSample({data,format:'f32-planar',numberOfChannels:channels,sampleRate:rate,timestamp:at/rate});
   try{await source.add(sample);}finally{sample.close();}at+=n;
  }
  source.close();await out.finalize();
 }catch(error){await out.cancel().catch(()=>{});if(output)await remove(output).catch(()=>{});throw error;}
 return memory?new Uint8Array(memory.buffer!):undefined;
}
