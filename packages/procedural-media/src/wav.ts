export const AUDIO_RATE=48000;
export function encodeWav(pcm:Float32Array,channels=2){
 const bytes=new Uint8Array(44+pcm.length*2),v=new DataView(bytes.buffer);
 const tag=(offset:number,text:string)=>[...text].forEach((c,i)=>v.setUint8(offset+i,c.charCodeAt(0)));
 tag(0,'RIFF');v.setUint32(4,36+pcm.length*2,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,AUDIO_RATE,true);v.setUint32(28,AUDIO_RATE*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);tag(36,'data');v.setUint32(40,pcm.length*2,true);
 for(let i=0;i<pcm.length;i++)v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,pcm[i]))*32767),true);return bytes;
}
export function waveform(pcm:Float32Array,channels=2,count=1000){const frames=pcm.length/channels;count=Math.min(count,frames);return Array.from({length:count},(_,n)=>{let peak=0;for(let i=Math.floor(n*frames/count)*channels;i<Math.min(pcm.length,Math.floor((n+1)*frames/count)*channels);i++)peak=Math.max(peak,Math.abs(pcm[i]));return peak;});}
