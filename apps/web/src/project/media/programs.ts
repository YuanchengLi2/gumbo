import {Input,BlobSource,ALL_FORMATS,Output,Mp4OutputFormat,StreamTarget,Conversion,CanvasSink,AudioSampleSink,EncodedPacketSink,QUALITY_MEDIUM,type InputVideoTrack,type InputAudioTrack} from 'mediabunny';
import {fileAt,writable,writeFile} from './paths';
import {LoudnessMeter} from './loudness';

/** ffmpeg and ffprobe in the browser, for the commands the project service runs (apps/project-service/src/media.ts,
 * loudness.ts): probing, keyframe times, thumbnails, the playback proxy and preview copy, the audio master, the waveform
 * and loudness. Each is done with WebCodecs through mediabunny (hardware decoding and encoding) rather than a port of
 * ffmpeg, so they run at the browser's speed. An unknown command fails plainly, naming itself. */
export type Io={stdout:(data:Uint8Array)=>void;stderr:(text:string)=>void;signal:AbortSignal};
const IMAGE=/\.(png|jpe?g|webp|bmp|gif|avif|heic|heif|tiff?)$/i;
const ffprobeCodec:Record<string,string>={avc:'h264',hevc:'hevc',vp8:'vp8',vp9:'vp9',av1:'av1',aac:'aac',opus:'opus',mp3:'mp3',vorbis:'vorbis',flac:'flac',ac3:'ac3',eac3:'eac3','pcm-s16':'pcm_s16le','pcm-s16be':'pcm_s16be','pcm-s24':'pcm_s24le','pcm-s24be':'pcm_s24be','pcm-s32':'pcm_s32le','pcm-f32':'pcm_f32le','pcm-f64':'pcm_f64le','pcm-u8':'pcm_u8',ulaw:'pcm_mulaw',alaw:'pcm_alaw'};

type Args={inputs:{path:string;seek?:number}[];output?:string;options:Map<string,string>;flags:Set<string>};
const valued=new Set(['-v','-ss','-t','-vf','-af','-c:v','-c:a','-ar','-ac','-f','-frames:v','-map','-preset','-crf','-pix_fmt','-b:a','-movflags','-g','-keyint_min','-force_key_frames','-fps_mode','-select_streams','-read_intervals','-show_entries','-of','-loglevel']);
export function parse(args:string[]):Args{
 const inputs:Args['inputs']=[],options=new Map<string,string>(),flags=new Set<string>();let output:string|undefined,seek:number|undefined;
 for(let i=0;i<args.length;i++){const a=args[i];
  if(a==='-i'){inputs.push({path:args[++i],seek});seek=undefined;continue;}
  if(a==='-ss'&&!inputs.length){seek=Number(args[++i]);continue;}
  if(valued.has(a)){const value=args[++i];if(a==='-map')options.set(a,(options.get(a)?options.get(a)+' ':'')+value);else options.set(a,value);continue;}
  if(a.startsWith('-')){flags.add(a);continue;}
  output=a;
 }
 return{inputs,output,options,flags};
}
async function open(path:string){return new Input({source:new BlobSource(await fileAt(path)),formats:ALL_FORMATS});}
const even=(n:number)=>Math.max(2,Math.round(n/2)*2);

/** ffprobe -show_format -show_streams -of json: the fields probe() in media.ts reads, as ffprobe names them. */
async function probeJson(path:string){
 if(IMAGE.test(path)){const bitmap=await createImageBitmap(await fileAt(path));const out={streams:[{codec_type:'video',codec_name:path.split('.').pop()!.toLowerCase(),width:bitmap.width,height:bitmap.height,avg_frame_rate:'0/0'}],format:{duration:'5',tags:{}}};bitmap.close();return out;}
 const input=await open(path);try{
  const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack(),duration=await input.computeDuration(),tags=await (input as any).getMetadataTags?.().catch(()=>({}))??{};
  const streams:any[]=[];
  if(video){const stats=await video.computePacketStats(120).catch(()=>null),rate=stats?.averagePacketRate||30,[num,den]=Number.isInteger(rate)?[rate,1]:[Math.round(rate*1000),1000];
   streams.push({codec_type:'video',codec_name:ffprobeCodec[video.codec??'']??video.codec??'unknown',width:video.codedWidth,height:video.codedHeight,avg_frame_rate:`${num}/${den}`,duration:String(await video.computeDuration()),...(video.rotation?{side_data_list:[{side_data_type:'Display Matrix',rotation:-video.rotation}]}:{})});}
  if(audio)streams.push({codec_type:'audio',codec_name:ffprobeCodec[audio.codec??'']??audio.codec??'unknown',sample_rate:String(audio.sampleRate),channels:audio.numberOfChannels,duration:String(await audio.computeDuration())});
  const created=tags.date instanceof Date?tags.date.toISOString():undefined;
  return{streams,format:{duration:String(duration),tags:created?{creation_time:created}:{}}};
 }finally{input.dispose?.();}
}
/** ffprobe -select_streams v:0 -read_intervals %+N -show_entries packet=pts_time,flags -of csv=p=0: "time,flags" lines. */
async function keyframes(path:string,options:Map<string,string>,io:Io){
 const span=Number(/%\+(\d+(?:\.\d+)?)/.exec(options.get('-read_intervals')??'')?.[1]??Infinity),input=await open(path);
 try{const track=await input.getPrimaryVideoTrack();if(!track)return;const sink=new EncodedPacketSink(track);const lines:string[]=[];
  for await(const packet of sink.packets(undefined,undefined,{metadataOnly:true})){if(io.signal.aborted)throw new DOMException('Canceled','AbortError');if(packet.timestamp>span)break;lines.push(`${packet.timestamp.toFixed(6)},${packet.type==='key'?'K_':'__'}`);}
  io.stdout(new TextEncoder().encode(lines.join('\n')+'\n'));
 }finally{input.dispose?.();}
}
/** -ss T -i IN -frames:v 1 -vf scale=W:-2 OUT.jpg: one frame (or the photo) at width W as JPEG. */
async function thumbnail(input:Args['inputs'][number],output:string,options:Map<string,string>){
 const width=Number(/scale=(\d+)/.exec(options.get('-vf')??'')?.[1]??480);
 let canvas:OffscreenCanvas;
 if(IMAGE.test(input.path)){const bitmap=await createImageBitmap(await fileAt(input.path)),w=Math.min(width,bitmap.width),h=even(w*bitmap.height/bitmap.width);canvas=new OffscreenCanvas(w,h);canvas.getContext('2d')!.drawImage(bitmap,0,0,w,h);bitmap.close();}
 else{const media=await open(input.path);try{const track=await media.getPrimaryVideoTrack();if(!track)throw new Error('No video stream for a thumbnail.');const w=Math.min(width,track.displayWidth),h=even(w*track.displayHeight/track.displayWidth);
  const sink=new CanvasSink(track,{width:w,height:h,fit:'fill'}),start=await track.getFirstTimestamp(),frame=await sink.getCanvas(start+(input.seek??0))??await sink.getCanvas(start);if(!frame)throw new Error('No frame could be decoded for a thumbnail.');
  canvas=new OffscreenCanvas(w,h);canvas.getContext('2d')!.drawImage(frame.canvas as OffscreenCanvas,0,0);}finally{media.dispose?.();}}
 const type=/\.png$/i.test(output)?'image/png':/\.webp$/i.test(output)?'image/webp':'image/jpeg';
 await writeFile(output,await canvas.convertToBlob({type,quality:.88}));
}

/** Decoded sound, resampled to `rate` with `channels` channels, as float frames in pieces; silence past the end up to
 * `seconds` (ffmpeg's apad with -t). Linear interpolation, which is what the preview and export need. */
async function*pcm(path:string,rate:number,channels:number,seconds:number|undefined,signal:AbortSignal):AsyncGenerator<Float32Array[]>{
 const input=await open(path);
 try{
  const track:InputAudioTrack|null=await input.getPrimaryAudioTrack();
  const total=seconds!==undefined?Math.round(seconds*rate):Infinity;let written=0;
  if(track){
   // t: where the next output sample falls in the current piece, in source samples (-1 ≤ t: between the previous piece's
   // last sample and this piece's first); prev: each channel's last sample of the previous piece.
   const sink=new AudioSampleSink(track);let t=0,first=true;const prev:number[]=new Array(channels).fill(0);
   for await(const sample of sink.samples()){
    signal.throwIfAborted();const n=sample.numberOfFrames,ratio=sample.sampleRate/rate,src:Float32Array[]=[];
    for(let c=0;c<sample.numberOfChannels;c++){const plane=new Float32Array(n);sample.copyTo(plane,{planeIndex:c,format:'f32-planar'});src.push(plane);}
    // Sound that starts after the file's time zero (audio offset from the video) begins with silence, as aresample's
    // first_pts=0 does, so it stays in sync.
    if(first){first=false;const lead=Math.min(Math.round(Math.max(0,sample.timestamp)*rate),total-written);if(lead>0){yield Array.from({length:channels},()=>new Float32Array(lead));written+=lead;}}
    sample.close();
    const planes=Array.from({length:channels},(_,c)=>channels===1&&src.length>1?src.reduce((sum,p)=>{for(let i=0;i<n;i++)sum[i]+=p[i]/src.length;return sum;},new Float32Array(n)):src[Math.min(c,src.length-1)]);
    const count=Math.max(0,Math.min(Math.floor((n-1-t)/ratio)+1,total-written)),out=Array.from({length:channels},()=>new Float32Array(count));
    for(let k=0;k<count;k++,t+=ratio){const i=Math.floor(t),f=t-i;for(let c=0;c<channels;c++){const p=planes[c],a=i<0?prev[c]:p[i],b=i+1<n?p[i+1]:a;out[c][k]=a+(b-a)*f;}}
    for(let c=0;c<channels;c++)prev[c]=planes[c][n-1]??0;t-=n;written+=count;
    if(count)yield out;
    if(written>=total)break;
   }
  }
  // apad: silence to the requested length.
  for(;written<total&&Number.isFinite(total);){const n=Math.min(48000,total-written);yield Array.from({length:channels},()=>new Float32Array(n));written+=n;}
 }finally{input.dispose?.();}
}
function wavHeader(rate:number,channels:number,frames:number){const bytes=frames*channels*2,h=new DataView(new ArrayBuffer(44)),s=(o:number,t:string)=>{for(let i=0;i<4;i++)h.setUint8(o+i,t.charCodeAt(i));};
 s(0,'RIFF');h.setUint32(4,36+bytes,true);s(8,'WAVE');s(12,'fmt ');h.setUint32(16,16,true);h.setUint16(20,1,true);h.setUint16(22,channels,true);h.setUint32(24,rate,true);h.setUint32(28,rate*channels*2,true);h.setUint16(32,channels*2,true);h.setUint16(34,16,true);s(36,'data');h.setUint32(40,bytes,true);return new Uint8Array(h.buffer);}
const s16=(planes:Float32Array[])=>{const n=planes[0].length,out=new Int16Array(n*planes.length);for(let i=0;i<n;i++)for(let c=0;c<planes.length;c++)out[i*planes.length+c]=Math.max(-32768,Math.min(32767,Math.round(planes[c][i]*32767)));return new Uint8Array(out.buffer);};
/** -i IN -vn -ar R -ac C [-t T] OUT: the sound as 16-bit PCM WAV, padded to T. The audio master is named .flac by the
 * service; its bytes are WAV, which every reader here detects by content. */
async function audioFile(input:string,output:string,options:Map<string,string>,io:Io){
 const rate=Number(options.get('-ar')??48000),channels=Number(options.get('-ac')??2),seconds=options.has('-t')?Number(options.get('-t')):undefined;
 // Written as it decodes (an hour of 48 kHz stereo is 700 MB); the header's sizes are filled in once the length is known.
 const out=await writable(output);let frames=0;
 try{await out.write(wavHeader(rate,channels,0));for await(const planes of pcm(input,rate,channels,seconds,io.signal)){await out.write(s16(planes));frames+=planes[0].length;}
  await out.write({type:'write',position:0,data:wavHeader(rate,channels,frames)});await out.close();}
 catch(error){await out.abort().catch(()=>{});throw error;}
}
/** -i IN -vn -ar 1000 -ac 1 -f s16le pipe:1: the waveform's samples, keeping each millisecond's peak. */
async function waveformPcm(input:string,options:Map<string,string>,io:Io){
 const rate=Number(options.get('-ar')??1000),fine=Math.max(rate,8000),step=fine/rate;let peak=0,count=0;const out:number[]=[];
 for await(const planes of pcm(input,fine,1,undefined,io.signal)){for(const v of planes[0]){peak=Math.max(peak,Math.abs(v));if(++count>=step){out.push(peak);peak=0;count=0;}}if(out.length>=8192){io.stdout(s16([Float32Array.from(out.splice(0))]));}}
 if(count)out.push(peak);if(out.length)io.stdout(s16([Float32Array.from(out)]));
}
/** -i IN -af ebur128 -f null -: integrated loudness (ITU-R BS.1770-4, EBU R128 gating), reported as ffmpeg prints it. */
async function loudness(input:string,io:Io){
 const meter=new LoudnessMeter(2);for await(const planes of pcm(input,48000,2,undefined,io.signal))meter.add(planes);const integrated=meter.integrated();
 io.stderr(`[Parsed_ebur128_0] Summary:\n\n  Integrated loudness:\n    I:         ${integrated.toFixed(1)} LUFS\n    Threshold: ${(integrated-10).toFixed(1)} LUFS\n`);
}
/** -i IN … -c:v libx264 OUT.mp4: the playback proxy (width at most 960, with its sound as AAC) or the preview copy (short
 * side at most 1080, a keyframe every -force_key_frames seconds, no sound), encoded with WebCodecs. */
async function video(input:string,output:string,options:Map<string,string>,flags:Set<string>,io:Io){
 const media=await open(input);
 try{
  const track:InputVideoTrack|null=await media.getPrimaryVideoTrack();if(!track)throw new Error('No video stream to encode.');
  const scale=options.get('-vf')??'',w0=track.displayWidth,h0=track.displayHeight;let width=w0,height=h0;
  const maxWidth=/min\((\d+),iw\)/.exec(scale);if(maxWidth){width=Math.min(Number(maxWidth[1]),w0);height=h0*width/w0;}
  const shortSide=/(\d+)\/min\(iw,ih\)/.exec(scale);if(shortSide){const k=Math.min(1,Number(shortSide[1])/Math.min(w0,h0));width=w0*k;height=h0*k;}
  const every=Number(/n_forced\*([\d.]+)/.exec(options.get('-force_key_frames')??'')?.[1]??2),noAudio=flags.has('-an')||(options.get('-map')??'').split(' ').every(m=>m.includes(':v'));
  const target=await writable(output);
  const conversion=await Conversion.init({input:media,output:new Output({format:new Mp4OutputFormat({fastStart:false}),target:new StreamTarget(target as unknown as WritableStream<any>,{chunked:true})}),
   video:{codec:'avc',width:even(width),height:even(height),fit:'fill',bitrate:QUALITY_MEDIUM,keyFrameInterval:every,forceTranscode:true},
   audio:noAudio?{discard:true}:{codec:'aac',bitrate:192_000}});
  if(!conversion.isValid){await target.abort?.();throw new Error('This video cannot be converted in the browser: '+conversion.discardedTracks.map(d=>`${d.track.type} (${d.reason})`).join(', '));}
  const abort=()=>void conversion.cancel();io.signal.addEventListener('abort',abort,{once:true});
  try{await conversion.execute();}finally{io.signal.removeEventListener('abort',abort);}
 }finally{media.dispose?.();}
}

export async function runProgram(program:string,args:string[],io:Io):Promise<number>{
 const name=program.split(/[\\/]/).pop()!.replace(/\.exe$/i,'').toLowerCase(),a=parse(args);
 if(name==='ffprobe'){
  const path=a.inputs[0]?.path??a.output!;
  if(args.includes('-show_streams')){io.stdout(new TextEncoder().encode(JSON.stringify(await probeJson(path))));return 0;}
  if((a.options.get('-show_entries')??'').startsWith('packet=')){await keyframes(path,a.options,io);return 0;}
 }
 if(name==='ffmpeg'&&a.inputs.length===1){
  const input=a.inputs[0],out=a.output??'',af=a.options.get('-af')??'';
  if(af.includes('ebur128')){await loudness(input.path,io);return 0;}
  if(out==='pipe:1'&&a.options.get('-f')==='s16le'){await waveformPcm(input.path,a.options,io);return 0;}
  if(a.options.get('-frames:v')==='1'){await thumbnail(input,out,a.options);return 0;}
  if(a.flags.has('-vn')||a.options.has('-ar')&&!a.options.has('-c:v')){await audioFile(input.path,out,a.options,io);return 0;}
  if(a.options.get('-c:v')==='libx264'){await video(input.path,out,a.options,a.flags,io);return 0;}
 }
 throw new Error(`${name} ${args.filter(x=>!x.startsWith('/')).slice(0,8).join(' ')} … is not available in the browser yet.`);
}
