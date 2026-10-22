import {it,expect} from 'vitest';
import {mergeSeam,collapseRepeats,normalizeWord} from '../src';

type W={word:string;start:number;end:number;from?:string};
/** Words spaced 0.4 s apart from `at`, tagged with the window that heard them. */
const said=(text:string,at:number,from:string,shift=0):W[]=>text.split(' ').map((word,i)=>({word,start:at+i*.4+shift,end:at+i*.4+.3+shift,from}));
const seam={from:26,to:30,cut:28};
const text=(words:W[])=>words.map(w=>w.word).join(' ');

it('keeps the overlap once when both windows heard it, handing over at the agreeing word nearest the cut',()=>{
 // Window A heard 24.0–30.0; window B (from 26.0) heard the same words with times off by 0.15 s.
 const all='we are met on a great battlefield of that war we have come to dedicate a portion of that field';
 const a=said(all,24,'A').filter(w=>w.end<=30),b=said(all,24,'B',.15).filter(w=>w.start>=26);
 const merged=mergeSeam(a,b,seam);
 expect(text(merged)).toBe(all);
 // Before the hand-over the earlier window's take, after it the later one's.
 const handover=merged.findIndex(w=>w.from==='B');expect(merged[handover-1].from).toBe('A');
 expect(Math.abs((merged[handover-1].start+merged[handover-1].end)/2-seam.cut)).toBeLessThan(.6);
 expect(merged.slice(handover).every(w=>w.from==='B')).toBe(true);
});

it('anchors on the longest agreeing run when the takes disagree about a word in the overlap',()=>{
 // A lone agreeing "brought" after the disagreement does not outrank five agreeing words before it.
 const a=said('and seven years ago our fore fathers brought',26.5,'A'),b=said('and seven years ago our forefathers brought forth',26.6,'B');
 expect(text(mergeSeam(a,b,seam))).toBe('and seven years ago our forefathers brought forth');
});

it('splits by the cut when the takes share nothing, and does not keep a word heard on both sides twice',()=>{
 const a=[{word:'nation,',start:27.5,end:27.9},{word:'conceived',start:28.2,end:28.6}],b=[{word:'Nation',start:27.7,end:28.2},{word:'so',start:28.3,end:28.5}];
 // "nation" agrees (case and punctuation aside), so it anchors; "conceived" vs "so" is the later window's call.
 expect(text(mergeSeam(a,b,seam))).toBe('nation, so');
 // With nothing in common, each side keeps the words centred on its side of the cut.
 const x=[{word:'alpha',start:27,end:27.5},{word:'beta',start:28.2,end:28.6}],y=[{word:'gamma',start:27.2,end:27.6},{word:'delta',start:28.4,end:28.8}];
 expect(text(mergeSeam(x,y,seam))).toBe('alpha delta');
 // A word whose two takes sit just either side of the cut, too far apart to align, is still kept once.
 const p=[{word:'here',start:27.2,end:27.9}],q=[{word:'here',start:28.05,end:28.6},{word:'dedicated',start:28.7,end:29.3}];
 expect(text(mergeSeam(p,q,seam,.5))).toBe('here dedicated');
});

it('does not drop a word whose two takes fall on opposite sides of the cut',()=>{
 // Midpoint ownership alone would drop "nation": the earlier take is centred after the cut, the later before it.
 const a=[...said('a new',27,'A'),{word:'nation',start:27.9,end:28.3,from:'A'}],b=[{word:'nation',start:27.7,end:28.2,from:'B'},...said('conceived in liberty',28.4,'B')];
 expect(text(mergeSeam(a,b,seam))).toBe('a new nation conceived in liberty');
});

it('does not pair a common word with the same word said seconds apart',()=>{
 const a=[{word:'the',start:26.2,end:26.4},{word:'people',start:26.5,end:27}],b=[{word:'the',start:28.8,end:29},{word:'earth',start:29.1,end:29.6}];
 expect(text(mergeSeam(a,b,seam))).toBe('the people the earth');
});

it('leaves words before the overlap untouched and handles an empty side',()=>{
 const a=said('government of the people',10,'A');
 expect(mergeSeam(a,[],seam)).toEqual(a);
 const b=said('shall not perish',27,'B');expect(text(mergeSeam([],b,seam))).toBe('shall not perish');
});

it('collapses decoding loops but keeps ordinary repetition',()=>{
 const loop=said('and the and the and the and the and the end',0,'A');expect(text(collapseRepeats(loop))).toBe('and the and the and the end');
 expect(text(collapseRepeats(said('no no no',0,'A')))).toBe('no no no');
 expect(text(collapseRepeats(said('of the people by the people for the people',0,'A')))).toBe('of the people by the people for the people');
 expect(text(collapseRepeats(said('go go go go go go',0,'A')))).toBe('go go go');
 expect(normalizeWord('“Liberty,”')).toBe('liberty');
});
