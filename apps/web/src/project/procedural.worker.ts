import {createHash} from 'node:crypto';
import {ScoreSchema,SoundDesignSchema,renderArrangement,renderSfx,renderSound,SCORE_RENDERER_VERSION} from '@dream/procedural-media';
import {writeFile} from './media/paths';

/** The desktop's procedural-worker.ts in the browser: composes a score, a sound design or a preset effect off the project
 * worker, and writes its mix, stems and manifest into the project's folder in this browser's storage. Same messages:
 * progress, complete (the manifest) or error. */
self.onmessage=async(event:MessageEvent)=>{
 const {directory,score,sound,sfxId,stems:keepStems=true}=event.data as {directory:string;score?:unknown;sound?:unknown;sfxId?:string;stems?:boolean};
 try{
  const writes:Promise<void>[]=[],stems:{trackId:string;filename:string;waveform:number[];sha256:string}[]=[];
  const write=(filename:string,bytes:Uint8Array)=>{writes.push(writeFile(`${directory}/${filename}`,bytes as Uint8Array<ArrayBuffer>));return createHash('sha256').update(bytes).digest('hex');};
  const document=score?ScoreSchema.parse(score):undefined;
  // Separate instrument tracks are written only when something will play them (the music library's stem player).
  const result=document?renderArrangement(document,(track,wav,waveform)=>{if(!keepStems)return;const filename=`stem-${stems.length}.wav`;stems.push({trackId:track.id,filename,waveform,sha256:write(filename,wav)});},progress=>postMessage({progress})):sound?renderSound(SoundDesignSchema.parse(sound)):renderSfx(sfxId!);
  const sha256=write('mix.wav',result.wav);
  const manifest={rendererVersion:SCORE_RENDERER_VERSION,sha256,waveform:result.waveform,stems,durationSec:document?.durationSec??('durationSec' in result?result.durationSec:0),beats:'beats' in result?result.beats:[],masterGain:'masterGain' in result?result.masterGain:1};
  write('manifest.json',new TextEncoder().encode(JSON.stringify(manifest)));
  await Promise.all(writes);postMessage({complete:manifest});
 }catch(error){postMessage({error:(error as Error).message});}
};
