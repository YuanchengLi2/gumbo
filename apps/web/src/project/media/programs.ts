import {Input,BlobSource,ALL_FORMATS,Output,Mp4OutputFormat,StreamTarget,Conversion,CanvasSink,AudioSampleSink,EncodedPacketSink,QUALITY_MEDIUM,type InputVideoTrack,type InputAudioTrack} from 'mediabunny';
import {fileAt,writable,writeFile,exists} from './paths';
import {LoudnessMeter} from './loudness';
import {encodeAudio} from './audio-encode';

/** ffmpeg and ffprobe in the browser, for the commands the project service runs: at import (media.ts, loudness.ts)
 * probing, keyframe times, thumbnails, the playback proxy and preview copy, the audio master, the waveform and loudness;
 * for Roux's tools frames and keyframes (source-frames.ts, keyframe-context.ts, media-evidence.ts), contact sheets, the
 * shot index's small frames and sound (shot-index.ts), sound measurements (silence, levels, loudness) and speech clips
 * for transcription (speech.ts). Each is done with WebCodecs through mediabunny (hardware decoding and encoding) rather
 * than a port of ffmpeg, so they run at the browser's speed. An unknown command fails plainly, naming itself. */
export type Io={stdout:(data:Uint8Array)=>void;stderr:(text:string)=>void;signal:AbortSignal};
const IMAGE=/\.(png|jpe?g|webp|bmp|gif|avif|heic|heif|tiff?)$/i;
const ffprobeCodec:Record<string,string>={avc:'h264',hevc:'hevc',vp8:'vp8',vp9:'vp9',av1:'av1',aac:'aac',opus:'opus',mp3:'mp3',vorbis:'vorbis',flac:'flac',ac3:'ac3',eac3:'eac3','pcm-s16':'pcm_s16le','pcm-s16be':'pcm_s16be','pcm-s24':'pcm_s24le','pcm-s24be':'pcm_s24be','pcm-s32':'pcm_s32le','pcm-f32':'pcm_f32le','pcm-f64':'pcm_f64le','pcm-u8':'pcm_u8',ulaw:'pcm_mulaw',alaw:'pcm_alaw'};

type Args={inputs:{path:string;seek?:number}[];output?:string;options:Map<string,string>;flags:Set<string>};
const valued=new Set(['-v','-ss','-t','-vf','-af','-c:v','-c:a','-ar','-ac','-f','-frames:v','-map','-preset','-crf','-pix_fmt','-b:a','-movflags','-g','-keyint_min','-force_key_frames','-fps_mode','-select_streams','-read_intervals','-show_entries','-of','-loglevel','-threads','-skip_frame','-start_number','-q:v','-vcodec','-map_metadata','-filter_complex_script']);
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
/** The size a scale filter gives a w0×h0 picture: scale=W:-2 (W wide, never wider than the source), scale=W:H, or
 * scale=w='min(M,iw)':h='min(N,ih)':force_original_aspect_ratio=decrease (fitted inside M×N, never enlarged). */
function fit(vf:string,w0:number,h0:number):[number,number]{
 // The box form first: its min(…,…) holds commas, which end the other forms.
 const box=/scale=w='min\((\d+),iw\)':h='min\((\d+),ih\)'/.exec(vf),scale=/scale=([^,]+)/.exec(vf)?.[1];
 if(box){const k=Math.min(1,Number(box[1])/w0,Number(box[2])/h0);return[Math.max(1,Math.round(w0*k)),Math.max(1,Math.round(h0*k))];}
 if(!scale)return[w0,h0];const [w,h]=scale.split(':').map(Number);
 if(h<0){const width=Math.min(w,w0);return[even(width),even(width*h0/w0)];}
 return w>0&&h>0?[w,h]:[w0,h0];
}
/** A JPEG (or PNG or WebP by the output's name) to the output file, or to stdout for pipe:1. */
async function picture(canvas:OffscreenCanvas,output:string,io:Io){
 const blob=await canvas.convertToBlob({type:/\.png$/i.test(output)?'image/png':/\.webp$/i.test(output)?'image/webp':'image/jpeg',quality:.88});
 if(output==='pipe:1'||output==='-')io.stdout(new Uint8Array(await blob.arrayBuffer()));else await writeFile(output,blob);
}
/** Videos kept open between stills, so a run of frames from one video (Roux looking at chosen moments, the shot index's
 * frames) reuses its demuxer and decoder instead of opening the file and starting a decoder for every frame. At most four
 * stay open, closed when idle for a minute; one video's frames are taken one at a time. */
type Opened={input:Input;track:InputVideoTrack;sinks:Map<string,CanvasSink>;used:number;queue:Promise<unknown>};
const opened=new Map<string,Promise<Opened>>();
const close=(key:string)=>{const entry=opened.get(key);opened.delete(key);void entry?.then(e=>e.input.dispose?.(),()=>{});};
setInterval(()=>{for(const [key,entry] of opened)void entry.then(e=>{if(Date.now()-e.used>60_000)close(key);},()=>close(key));},15_000);
async function openVideo(path:string):Promise<Opened>{
 const file=await fileAt(path),key=`${path}:${file.size}:${file.lastModified}`;
 let entry=opened.get(key);
 if(!entry){
  entry=(async()=>{const input=new Input({source:new BlobSource(file),formats:ALL_FORMATS}),track=await input.getPrimaryVideoTrack();if(!track){input.dispose?.();throw new Error('No video stream to take a frame from.');}return{input,track,sinks:new Map(),used:Date.now(),queue:Promise.resolve()};})();
  opened.set(key,entry);entry.catch(()=>opened.delete(key));
  if(opened.size>4){const times=await Promise.all([...opened].map(async([k,e])=>[k,await e.then(x=>x.used,()=>0)] as const));close(times.sort((a,b)=>a[1]-b[1])[0][0]);}
 }
 const video=await entry;video.used=Date.now();return video;
}
/** [-skip_frame nokey] -ss T -i IN -frames:v 1 [-vf scale…[,showinfo]] OUT|pipe:1: the frame at T (or the photo) as an
 * image. With -skip_frame nokey, the keyframe at or before T; showinfo reports the frame's time as ffmpeg does. */
async function still(input:Args['inputs'][number],output:string,options:Map<string,string>,io:Io){
 const vf=options.get('-vf')??'',at=span(input,options).from;let canvas!:OffscreenCanvas,time=at;
 if(IMAGE.test(input.path)){const bitmap=await createImageBitmap(await fileAt(input.path)),[w,h]=fit(vf,bitmap.width,bitmap.height);canvas=new OffscreenCanvas(w,h);canvas.getContext('2d')!.drawImage(bitmap,0,0,w,h);bitmap.close();time=0;}
 else{const video=await openVideo(input.path),take=async()=>{
  const {track}=video,[w,h]=fit(vf,track.displayWidth,track.displayHeight),start=await track.getFirstTimestamp();
  let target=start+at;if(options.get('-skip_frame')==='nokey'){const packets=new EncodedPacketSink(track),key=await packets.getKeyPacket(target,{metadataOnly:true})??await packets.getFirstPacket({metadataOnly:true});if(key)target=key.timestamp;}
  const size=`${w}x${h}`,sink=video.sinks.get(size)??video.sinks.set(size,new CanvasSink(track,{width:w,height:h,fit:'fill'})).get(size)!;
  const frame=await sink.getCanvas(target)??await sink.getCanvas(start);if(!frame)throw new Error('No frame could be decoded there.');
  canvas=new OffscreenCanvas(w,h);canvas.getContext('2d')!.drawImage(frame.canvas as OffscreenCanvas,0,0);time=frame.timestamp;};
  const turn=video.queue.then(take,take);video.queue=turn.catch(()=>{});await turn;video.used=Date.now();}
 if(vf.includes('showinfo'))io.stderr(`[Parsed_showinfo_1 @ 0] n:   0 pts:${Math.round(time*90000)} pts_time:${time} duration:0\n`);
 await picture(canvas,output,io);
}
/** -start_number K -i DIR/%03d.jpg -frames:v 1 -vf scale=W:H:…,pad=…:color=C,tile=CxR:padding=P:margin=M:color=B: the
 * numbered images from K, each fitted into a W×H cell of colour C, in a C×R grid with P between cells and M around, on B. */
async function sheet(input:Args['inputs'][number],output:string,options:Map<string,string>,io:Io){
 const vf=options.get('-vf')??'',number=(re:RegExp,fallback:number)=>Number(re.exec(vf)?.[1]??fallback),colour=(re:RegExp)=>'#'+(re.exec(vf)?.[1]??'000000');
 const [,w,h]=(/scale=(\d+):(\d+)/.exec(vf)??[0,320,180]).map(Number),[,columns,rows]=(/tile=(\d+)x(\d+)/.exec(vf)??[0,1,1]).map(Number),padding=number(/padding=(\d+)/,0),margin=number(/margin=(\d+)/,0);
 const paths:string[]=[];for(let n=Number(options.get('-start_number')??0);paths.length<columns*rows;n++){const path=input.path.replace(/%0?(\d*)d/,(_,width)=>String(n).padStart(Number(width||0),'0'));if(!await exists(path))break;paths.push(path);}
 const canvas=new OffscreenCanvas(columns*w+(columns-1)*padding+2*margin,rows*h+(rows-1)*padding+2*margin),context=canvas.getContext('2d')!;
 context.fillStyle=colour(/tile=[^,]*color=0x([0-9a-f]{6})/i);context.fillRect(0,0,canvas.width,canvas.height);context.imageSmoothingQuality='high';
 for(const [n,path] of paths.entries()){
  const x=margin+(n%columns)*(w+padding),y=margin+Math.floor(n/columns)*(h+padding),bitmap=await createImageBitmap(await fileAt(path)),k=Math.min(w/bitmap.width,h/bitmap.height),iw=Math.floor(bitmap.width*k/2)*2,ih=Math.floor(bitmap.height*k/2)*2;
  context.fillStyle=colour(/pad=[^,]*color=0x([0-9a-f]{6})/i);context.fillRect(x,y,w,h);context.drawImage(bitmap,x+Math.floor((w-iw)/2),y+Math.floor((h-ih)/2),iw,ih);bitmap.close();
 }
 await picture(canvas,output,io);
}
/** -i IN -an [-frames:v 1] -vf [fps=R,]scale=W:H:flags=area,format=rgb24 -f rawvideo pipe:1: the picture R times a
 * second (or the photo once), W×H, as packed RGB bytes, sent a few frames at a time. */
async function rawFrames(input:Args['inputs'][number],options:Map<string,string>,io:Io){
 const vf=options.get('-vf')??'',[,w,h]=(/scale=(\d+):(\d+)/.exec(vf)??[0,96,54]).map(Number),rate=Number(/fps=([\d.]+)/.exec(vf)?.[1]??0);
 const canvas=new OffscreenCanvas(w,h),context=canvas.getContext('2d',{willReadFrequently:true})!;let batch:Uint8Array[]=[];
 const send=()=>{if(!batch.length)return;const out=new Uint8Array(batch.length*w*h*3);batch.forEach((frame,i)=>out.set(frame,i*w*h*3));io.stdout(out);batch=[];};
 const take=(source:CanvasImageSource)=>{context.drawImage(source,0,0,w,h);const rgba=context.getImageData(0,0,w,h).data,rgb=new Uint8Array(w*h*3);for(let i=0,j=0;i<rgba.length;i+=4,j+=3){rgb[j]=rgba[i];rgb[j+1]=rgba[i+1];rgb[j+2]=rgba[i+2];}batch.push(rgb);if(batch.length>=16)send();};
 if(IMAGE.test(input.path)){const bitmap=await createImageBitmap(await fileAt(input.path));take(bitmap);bitmap.close();send();return;}
 const media=await open(input.path);
 try{
  const track=await media.getPrimaryVideoTrack();if(!track)return;const start=await track.getFirstTimestamp(),end=await track.computeDuration(),sink=new CanvasSink(track,{width:w,height:h,fit:'fill',poolSize:2});
  const times=function*(){if(!rate||options.get('-frames:v')==='1'){yield start;return;}for(let n=0;start+n/rate<end;n++)yield start+n/rate;};
  for await(const frame of sink.canvasesAtTimestamps(times())){io.signal.throwIfAborted();if(frame)take(frame.canvas as OffscreenCanvas);}
  send();
 }finally{media.dispose?.();}
}

/** Decoded sound from `from` seconds, resampled to `rate` with `channels` channels, as float frames in pieces; silence
 * past the end up to `seconds` (ffmpeg's apad with -t). Linear interpolation, which is what the preview and export need. */
async function*pcm(path:string,rate:number,channels:number,seconds:number|undefined,signal:AbortSignal,from=0,pad=false):AsyncGenerator<Float32Array[]>{
 const input=await open(path);
 try{
  const track:InputAudioTrack|null=await input.getPrimaryAudioTrack();
  const total=seconds!==undefined?Math.round(seconds*rate):Infinity;let written=0;
  if(track){
   // t: where the next output sample falls in the current piece, in source samples (-1 ≤ t: between the previous piece's
   // last sample and this piece's first); prev: each channel's last sample of the previous piece.
   const sink=new AudioSampleSink(track);let t=0,first=true;const prev:number[]=new Array(channels).fill(0);
   for await(const sample of sink.samples(from)){
    signal.throwIfAborted();let n=sample.numberOfFrames;const ratio=sample.sampleRate/rate,src:Float32Array[]=[];
    for(let c=0;c<sample.numberOfChannels;c++){const plane=new Float32Array(n);sample.copyTo(plane,{planeIndex:c,format:'f32-planar'});src.push(plane);}
    // The first piece starts at or before `from`: what comes before it is dropped. Sound that starts after `from` (audio
    // offset from the video) begins with silence, as aresample's first_pts=0 does, so it stays in sync.
    if(first){first=false;const skip=Math.max(0,Math.min(n,Math.round((from-sample.timestamp)*sample.sampleRate)));if(skip){for(let c=0;c<src.length;c++)src[c]=src[c].subarray(skip);n-=skip;}
     const lead=Math.min(Math.round(Math.max(0,sample.timestamp-from)*rate),total-written);if(lead>0){yield Array.from({length:channels},()=>new Float32Array(lead));written+=lead;}}
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
  for(;pad&&written<total&&Number.isFinite(total);){const n=Math.min(48000,total-written);yield Array.from({length:channels},()=>new Float32Array(n));written+=n;}
 }finally{input.dispose?.();}
}
function wavHeader(rate:number,channels:number,frames:number){const bytes=frames*channels*2,h=new DataView(new ArrayBuffer(44)),s=(o:number,t:string)=>{for(let i=0;i<4;i++)h.setUint8(o+i,t.charCodeAt(i));};
 s(0,'RIFF');h.setUint32(4,36+bytes,true);s(8,'WAVE');s(12,'fmt ');h.setUint32(16,16,true);h.setUint16(20,1,true);h.setUint16(22,channels,true);h.setUint32(24,rate,true);h.setUint32(28,rate*channels*2,true);h.setUint16(32,channels*2,true);h.setUint16(34,16,true);s(36,'data');h.setUint32(40,bytes,true);return new Uint8Array(h.buffer);}
const s16=(planes:Float32Array[])=>{const n=planes[0].length,out=new Int16Array(n*planes.length);for(let i=0;i<n;i++)for(let c=0;c<planes.length;c++)out[i*planes.length+c]=Math.max(-32768,Math.min(32767,Math.round(planes[c][i]*32767)));return new Uint8Array(out.buffer);};
/** Where an input is read from and for how long: -ss before -i seeks the input, after it the output; -t is the length. */
const span=(input:Args['inputs'][number],options:Map<string,string>)=>({from:(input.seek??0)+Number(options.get('-ss')??0),seconds:options.has('-t')?Number(options.get('-t')):undefined});
/** [-ss S] -i IN [-t T] -vn -ar R -ac C [-af …apad] [-c:a libmp3lame|aac -b:a B] OUT: the sound as MP3 or AAC when asked
 * (Roux's listening clips), else as 16-bit PCM WAV (padded to T with apad). The audio master is named .flac by the
 * service; its bytes are WAV, which every reader here detects by content. */
async function audioFile(input:Args['inputs'][number],output:string,options:Map<string,string>,io:Io){
 const rate=Number(options.get('-ar')??48000),channels=Number(options.get('-ac')??2),{from,seconds}=span(input,options),pad=(options.get('-af')??'').includes('apad');
 const codec=options.get('-c:a'),encoded=codec==='libmp3lame'||/\.mp3$/i.test(output)?'mp3':codec==='aac'||/\.m4a$/i.test(output)?'aac':undefined;
 if(encoded){const bitrate=Number(/^(\d+)k$/.exec(options.get('-b:a')??'')?.[1]??(encoded==='mp3'?128:192))*1000;await encodeAudio(pcm(input.path,rate,channels,seconds,io.signal,from,pad),{format:encoded,rate,channels,bitrate},output,io.signal);return;}
 // Written as it decodes (an hour of 48 kHz stereo is 700 MB); the header's sizes are filled in once the length is known.
 const out=await writable(output);let frames=0;
 try{await out.write(wavHeader(rate,channels,0));for await(const planes of pcm(input.path,rate,channels,seconds,io.signal,from,pad)){await out.write(s16(planes));frames+=planes[0].length;}
  await out.write({type:'write',position:0,data:wavHeader(rate,channels,frames)});await out.close();}
 catch(error){await out.abort().catch(()=>{});throw error;}
}
/** -i IN -vn -ac 1 -ar 16000 -f f32le pipe:1: the samples themselves, interleaved, as they decode (the sound analysis
 * reads an hour this way without holding it). */
async function samplesPcm(input:Args['inputs'][number],options:Map<string,string>,io:Io){
 const rate=Number(options.get('-ar')??16000),channels=Number(options.get('-ac')??1),{from,seconds}=span(input,options);
 for await(const planes of pcm(input.path,rate,channels,seconds,io.signal,from)){
  const frames=planes[0].length,out=new Float32Array(frames*channels);
  for(let i=0;i<frames;i++)for(let c=0;c<channels;c++)out[i*channels+c]=planes[c][i];
  io.stdout(new Uint8Array(out.buffer));
 }
}
/** -i IN -vn -ar 1000 -ac 1 -f s16le pipe:1: the waveform's samples, keeping each millisecond's peak. */
async function waveformPcm(input:string,options:Map<string,string>,io:Io){
 const rate=Number(options.get('-ar')??1000),fine=Math.max(rate,8000),step=fine/rate;let peak=0,count=0;const out:number[]=[];
 for await(const planes of pcm(input,fine,1,undefined,io.signal)){for(const v of planes[0]){peak=Math.max(peak,Math.abs(v));if(++count>=step){out.push(peak);peak=0;count=0;}}if(out.length>=8192){io.stdout(s16([Float32Array.from(out.splice(0))]));}}
 if(count)out.push(peak);if(out.length)io.stdout(s16([Float32Array.from(out)]));
}
/** -i IN [-ss S] [-t T] -af silencedetect=noise=N:d=D,astats,ebur128=peak=true -f null -: what those filters print, as
 * ffmpeg prints it: the silent spans (every channel below N for D seconds or more, in seconds of the file), the peak and
 * RMS levels, and the loudness (integrated, BS.1770-4 with EBU R128 gating; its range; the true peak). */
async function analyse(input:Args['inputs'][number],options:Map<string,string>,io:Io){
 const af=options.get('-af')??'',{from,seconds}=span(input,options),silence=/silencedetect=([^,]*)/.exec(af)?.[1],meter=new LoudnessMeter(2),lines:string[]=[];
 const noise=Math.pow(10,Number(/noise=(-?[\d.]+)dB/.exec(silence??'')?.[1]??-60)/20),minimum=Number(/d=([\d.]+)/.exec(silence??'')?.[1]??2),at=(t:number)=>String(Number(t.toFixed(6)));
 let n=0,quietSince:number|undefined,reported=false,peak=0,peakCount=0,squares=0,count=0;
 for await(const planes of pcm(input.path,48000,2,seconds,io.signal,from)){
  if(af.includes('ebur128'))meter.add(planes);
  for(let i=0;i<planes[0].length;i++,n++){
   const left=Math.abs(planes[0][i]),right=Math.abs(planes[1][i]),top=Math.max(left,right),time=from+n/48000;
   if(top>peak){peak=top;peakCount=1;}else if(top===peak&&top>0)peakCount++;squares+=left*left+right*right;count+=2;
   if(!silence)continue;
   if(top<noise){if(quietSince===undefined)quietSince=time;else if(!reported&&time-quietSince>=minimum){lines.push(`[silencedetect @ 0] silence_start: ${at(quietSince)}`);reported=true;}}
   else{if(reported)lines.push(`[silencedetect @ 0] silence_end: ${at(time)} | silence_duration: ${at(time-quietSince!)}`);quietSince=undefined;reported=false;}
  }
 }
 const end=from+n/48000;if(silence&&quietSince!==undefined&&end-quietSince>=minimum){if(!reported)lines.push(`[silencedetect @ 0] silence_start: ${at(quietSince)}`);lines.push(`[silencedetect @ 0] silence_end: ${at(end)} | silence_duration: ${at(end-quietSince)}`);}
 const db=(v:number)=>v>0?(20*Math.log10(v)).toFixed(6):'-inf';
 if(af.includes('astats'))lines.push('[Parsed_astats_1 @ 0] Overall',`[Parsed_astats_1 @ 0] Peak level dB: ${db(peak)}`,`[Parsed_astats_1 @ 0] RMS level dB: ${db(Math.sqrt(squares/Math.max(1,count)))}`,`[Parsed_astats_1 @ 0] Peak count: ${peakCount}`);
 if(af.includes('ebur128')){const integrated=meter.integrated(),range=meter.range(),f=(v:number)=>v.toFixed(1),tp=meter.truePeakDb();
  lines.push('[Parsed_ebur128_2 @ 0] Summary:','','  Integrated loudness:',`    I:         ${f(integrated)} LUFS`,`    Threshold: ${f(integrated-10)} LUFS`,'','  Loudness range:',`    LRA:       ${f(range.range)} LU`,`    Threshold: ${f(range.threshold)} LUFS`,`    LRA low:   ${f(range.low)} LUFS`,`    LRA high:  ${f(range.high)} LUFS`,'','  True peak:',`    Peak:      ${Number.isFinite(tp)?f(tp):'-inf'} dBFS`);}
 io.stderr(lines.join('\n')+'\n');
}
/** -i IN … -c:v libx264 OUT.mp4: the playback proxy (width at most 960, with its sound as AAC) or the preview copy (short
 * side at most 1080, a keyframe every -force_key_frames seconds, no sound), encoded with WebCodecs; with -c:v copy, the
 * playback copy of a playable codec in another container, its picture copied as it is. */
async function video(input:string,output:string,options:Map<string,string>,flags:Set<string>,io:Io){
 const media=await open(input);
 try{
  const track:InputVideoTrack|null=await media.getPrimaryVideoTrack();if(!track)throw new Error('No video stream to encode.');
  const scale=options.get('-vf')??'',w0=track.displayWidth,h0=track.displayHeight;let width=w0,height=h0;
  const maxWidth=/min\((\d+),iw\)/.exec(scale);if(maxWidth){width=Math.min(Number(maxWidth[1]),w0);height=h0*width/w0;}
  const shortSide=/(\d+)\/min\(iw,ih\)/.exec(scale);if(shortSide){const k=Math.min(1,Number(shortSide[1])/Math.min(w0,h0));width=w0*k;height=h0*k;}
  const every=Number(/n_forced\*([\d.]+)/.exec(options.get('-force_key_frames')??'')?.[1]??2),noAudio=flags.has('-an')||(options.get('-map')??'').split(' ').every(m=>m.includes(':v'));
  // -c:v copy (media.ts, for a playable codec in another container): the picture's packets go into the MP4 as they are.
  const copy=options.get('-c:v')==='copy',target=await writable(output);
  const conversion=await Conversion.init({input:media,output:new Output({format:new Mp4OutputFormat({fastStart:false}),target:new StreamTarget(target as unknown as WritableStream<any>,{chunked:true})}),
   video:copy?{}:{codec:'avc',width:even(width),height:even(height),fit:'fill',bitrate:QUALITY_MEDIUM,keyFrameInterval:every,forceTranscode:true},
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
  const input=a.inputs[0],out=a.output??'',af=a.options.get('-af')??'',format=a.options.get('-f');
  if(/silencedetect|astats|ebur128/.test(af)){await analyse(input,a.options,io);return 0;}
  if(format==='rawvideo'){await rawFrames(input,a.options,io);return 0;}
  if(out==='pipe:1'&&format==='f32le'){await samplesPcm(input,a.options,io);return 0;}
  if(out==='pipe:1'&&format==='s16le'){await waveformPcm(input.path,a.options,io);return 0;}
  if(/%\d*d/.test(input.path)&&(a.options.get('-vf')??'').includes('tile=')){await sheet(input,out,a.options,io);return 0;}
  if(a.options.get('-frames:v')==='1'){await still(input,out,a.options,io);return 0;}
  if(a.flags.has('-vn')||a.options.has('-ar')&&!a.options.has('-c:v')){await audioFile(input,out,a.options,io);return 0;}
  if(['libx264','copy'].includes(a.options.get('-c:v')??'')){await video(input.path,out,a.options,a.flags,io);return 0;}
 }
 throw new Error(`${name} ${args.filter(x=>!x.startsWith('/')).slice(0,8).join(' ')} … is not available in the browser yet.`);
}
