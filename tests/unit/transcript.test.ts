import {it,expect} from 'vitest';
import {transcriptWords} from '../../apps/project-service/src/transcript';

it('turns subword tokens into lexical words without attaching a silent punctuation interval',()=>{
 const token=(text:string,from:number,to:number)=>({text,offsets:{from,to},p:.9});
 const words=transcriptWords('asset',{transcription:[{tokens:[token('[_BEG_]',0,0),token(' Un',100,200),token('believ',200,400),token('able',400,600),token(',',600,1400),token(' story',1600,2100),token('.',2100,2400)]}]},3);
 expect(words.map(w=>({text:w.text,start:w.start,end:w.end}))).toEqual([{text:'Unbelievable,',start:.1,end:.6},{text:'story.',start:1.6,end:2.1}]);
 expect(words[1].pauseBefore).toBe(1);
});
