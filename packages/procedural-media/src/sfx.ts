import {sfxCatalog} from './catalog';
import {encodeWav,waveform} from './wav';
import {SoundDesignSchema,type SoundDesign} from './schema';
const wav=(pcm:Float32Array)=>encodeWav(pcm,1);const peaks=(pcm:Float32Array)=>waveform(pcm,1);
export function seeded(seed:number){let s=seed>>>0;return()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s/4294967296;};}
/** Phase-integrated pitch sweeps and independent seeded layers, rendered at the shared sample rate. */
export function renderSound(input:SoundDesign){
 const sound=SoundDesignSchema.parse(input),rate=48000,pcm=new Float32Array(Math.round(sound.durationSec*rate)*2);
 for(const layer of sound.layers){let hash=sound.seed;for(const c of layer.id)hash=Math.imul(hash,31)+c.charCodeAt(0);const rng=seeded(hash),count=Math.round(layer.durationSec*rate),start=Math.round(layer.startSec*rate),left=Math.cos((layer.pan+1)*Math.PI/4),right=Math.sin((layer.pan+1)*Math.PI/4),gain=10**(layer.gainDb/20),alpha=1-Math.exp(-2*Math.PI*layer.filterHz/rate);let phase=0,filtered=0;
  for(let n=0;n<count&&start+n<pcm.length/2;n++){const t=n/rate,p=n/Math.max(1,count-1);phase=(phase+(layer.frequencyHz*(layer.endFrequencyHz/layer.frequencyHz)**p)/rate)%1;const raw=layer.wave==='noise'?rng()*2-1:layer.wave==='sine'?Math.sin(2*Math.PI*phase):layer.wave==='triangle'?1-4*Math.abs(phase-.5):layer.wave==='saw'?2*phase-1:phase<.5?1:-1;filtered+=alpha*(raw-filtered);const env=Math.min(1,layer.attackSec?t/layer.attackSec:1,layer.releaseSec?(count-1-n)/rate/layer.releaseSec:1),value=filtered*gain*Math.max(0,env);pcm[(start+n)*2]+=value*left;pcm[(start+n)*2+1]+=value*right;}
 }
 let peak=0;for(const value of pcm)peak=Math.max(peak,Math.abs(value));const masterGain=peak>.9?.9/peak:1;if(masterGain<1)for(let n=0;n<pcm.length;n++)pcm[n]*=masterGain;
 return{wav:encodeWav(pcm,2),durationSec:sound.durationSec,waveform:waveform(pcm,2),masterGain};
}
export function renderSfx(id:string){const preset=sfxCatalog.find(p=>p.id===id);if(!preset)throw new Error('Sound preset not found.');const rate=48000,duration=['riser','sweep','whoosh'].includes(preset.kind)?1.5+preset.variation*.2:.2+preset.variation*.08,pcm=new Float32Array(Math.round(rate*duration)),rng=seeded(preset.seed);let filtered=0;for(let i=0;i<pcm.length;i++){const t=i/rate,p=i/pcm.length;filtered=.85*filtered+.15*(rng()*2-1);const tone=Math.sin(2*Math.PI*(preset.kind==='chime'?880:preset.kind==='hit'?65:280+600*p)*t);const env=preset.kind==='riser'?p*(1-p)**.15:preset.kind==='whoosh'||preset.kind==='sweep'?Math.sin(Math.PI*p):Math.exp(-p*8);pcm[i]=(preset.kind==='click'||preset.kind==='whoosh'||preset.kind==='sweep'?filtered*3:preset.kind==='riser'?filtered+tone*.2:tone)*env*.5;}return {wav:wav(pcm),durationSec:duration,waveform:peaks(pcm)};}
