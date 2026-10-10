import {parentPort,workerData} from 'node:worker_threads';
import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ScoreSchema,SoundDesignSchema,renderArrangement,renderSfx,renderSound,SCORE_RENDERER_VERSION} from '@dream/procedural-media';

const {directory,score,sound,sfxId}=workerData as {directory:string;score?:unknown;sound?:unknown;sfxId?:string};
try{
 mkdirSync(directory,{recursive:true});const stems:{trackId:string;filename:string;waveform:number[];sha256:string}[]=[];
 const write=(filename:string,bytes:Uint8Array)=>{writeFileSync(join(directory,filename),bytes);return createHash('sha256').update(bytes).digest('hex');};
 const document=score?ScoreSchema.parse(score):undefined;
 const result=document?renderArrangement(document,(track,wav,waveform)=>{const filename=`stem-${stems.length}.wav`;stems.push({trackId:track.id,filename,waveform,sha256:write(filename,wav)});},progress=>parentPort!.postMessage({progress})):sound?renderSound(SoundDesignSchema.parse(sound)):renderSfx(sfxId!);
 const sha256=write('mix.wav',result.wav);
 const manifest={rendererVersion:SCORE_RENDERER_VERSION,sha256,waveform:result.waveform,stems,durationSec:document?.durationSec??('durationSec' in result?result.durationSec:0),beats:'beats' in result?result.beats:[],masterGain:'masterGain' in result?result.masterGain:1};
 writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest));parentPort!.postMessage({complete:manifest});
}catch(error){parentPort!.postMessage({error:(error as Error).message});process.exitCode=1;}
