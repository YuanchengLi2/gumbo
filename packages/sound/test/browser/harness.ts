import {soundAnalyser} from '../../../../apps/web/src/project/web-sound-runtime';

/** The page side of the browser test: reads a 16-bit WAV, hands its samples to the web's sound analysis a second at a
 * time, as the project worker hands over what ffmpeg decodes, and returns what it found with the time it took. */
async function analyse(url:string){
 const bytes=new DataView(await (await fetch(url)).arrayBuffer());let at=12,data=0,length=0,rate=16000;
 while(at+8<=bytes.byteLength){const id=String.fromCharCode(...new Uint8Array(bytes.buffer,at,4)),size=bytes.getUint32(at+4,true);if(id==='fmt ')rate=bytes.getUint32(at+12,true);if(id==='data'){data=at+8;length=size;break;}at+=8+size;}
 if(rate!==16000)throw new Error('The fixture must be 16 kHz.');
 const samples=new Float32Array(length/2);for(let i=0;i<samples.length;i++)samples[i]=bytes.getInt16(data+i*2,true)/32768;
 async function* read(){for(let i=0;i<samples.length;i+=16000)yield samples.slice(i,i+16000);}
 const started=performance.now(),result=await soundAnalyser()(read(),samples.length/16000,new AbortController().signal);
 return{result,ms:Math.round(performance.now()-started),threads:navigator.hardwareConcurrency};
}
(window as any).sound={analyse};
