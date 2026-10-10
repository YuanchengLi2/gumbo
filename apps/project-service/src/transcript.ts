import type {Word} from '@dream/footage';

type Token={text?:string;offsets?:{from:number;to:number};p?:number};
type Transcript={result?:{language?:string};transcription?:{tokens?:Token[]}[]};

/** Whisper BPE tokens are not words. Segment their text, then map each lexical
 * word to overlapping token timings. Punctuation is displayed with its word,
 * without using punctuation-token silence as spoken-word duration. */
export function transcriptWords(assetId:string,transcript:Transcript,durationSec:number):Word[]{
 const words:Word[]=[];
 let segmenter:Intl.Segmenter;
 try{segmenter=new Intl.Segmenter(transcript.result?.language??'en',{granularity:'word'});}catch{segmenter=new Intl.Segmenter('en',{granularity:'word'});}
 for(const segment of transcript.transcription??[]){
  let text='';const tokens:{from:number;to:number;start:number;end:number;confidence:number}[]=[];
  for(const token of segment.tokens??[]){if(!token.text||token.text.startsWith('[_')||!token.offsets)continue;const from=text.length;text+=token.text;tokens.push({from,to:text.length,start:Math.max(0,token.offsets.from/1000),end:Math.min(durationSec,token.offsets.to/1000),confidence:Math.max(0,Math.min(1,token.p??0))});}
  let previous:Word|undefined;
  for(const part of segmenter.segment(text)){
   if(!part.isWordLike){if(previous&&part.segment.trim()&&/^[\p{P}\p{S}]+$/u.test(part.segment))previous.text+=part.segment;continue;}
   const overlapping=tokens.filter(token=>token.from<part.index+part.segment.length&&token.to>part.index);
   if(!overlapping.length)continue;
   const start=overlapping[0].start,end=overlapping.at(-1)!.end;if(end<=start||start>=durationSec)continue;
   previous={id:`${assetId}:w${words.length}`,assetId,text:part.segment,start,end,confidence:overlapping.reduce((sum,t)=>sum+t.confidence,0)/overlapping.length,speaker:'unknown',pauseBefore:Math.max(0,start-(words.at(-1)?.end??0))};words.push(previous);
  }
 }
 return words;
}
