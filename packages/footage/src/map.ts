import type {Asset,Shot} from './index';

/** Plain words for the problems the footage map records. */
export const problemWords:Record<string,string>={frozen:'frozen picture',black:'black',dark:'too dark',blurry:'blurry',shaky:'shaky camera',player_controls:'video player controls',recorder_window:'screen-recorder window',desktop:'desktop or app window',pause_icon:'pause icon',text_overlay:'text over the picture',watermark:'watermark',letterbox:'black bars',obstructed:'view blocked'};
const overlap=(a:[number,number],start:number,end:number)=>Math.max(0,Math.min(a[1],end)-Math.max(a[0],start));

/** Problems inside a source range: measured and seen problems of the shots it overlaps, and frozen or black stretches. */
export function rangeProblems(asset:Asset,shots:Shot[],start:number,end:number){
 const found:{problem:string;start:number;end:number}[]=[];
 for(const [a,b] of asset.footageMap?.frozen??[])if(overlap([a,b],start,end)>.3)found.push({problem:'frozen',start:Math.max(a,start),end:Math.min(b,end)});
 for(const [a,b] of asset.footageMap?.black??[])if(overlap([a,b],start,end)>.3)found.push({problem:'black',start:Math.max(a,start),end:Math.min(b,end)});
 for(const shot of shots)if(shot.assetId===asset.id&&overlap([shot.start,shot.end],start,end)>Math.min(.5,(shot.end-shot.start)/2))for(const problem of shot.quality?.problems??[])if(!['frozen','black'].includes(problem))found.push({problem,start:Math.max(shot.start,start),end:Math.min(shot.end,end)});
 return found;
}

/** Where usable footage of a source ends: the start of a final frozen, black or flagged stretch. */
export function usableUntil(asset:Asset,shots:Shot[]){
 let end=asset.durationSec;const bad=[...(asset.footageMap?.frozen??[]),...(asset.footageMap?.black??[]),...shots.filter(s=>s.assetId===asset.id&&(s.quality?.problems.length??0)>0&&s.log?.usableAsBroll===false).map(s=>[s.start,s.end] as [number,number])].sort((a,b)=>b[1]-a[1]);
 // A gap of under two seconds between bad stretches is not usable footage either.
 for(const [a,b] of bad)if(b>=end-2)end=Math.min(end,a);
 return Math.round(end*10)/10;
}

/** The map in a few lines for the agent: a summary, then one line per shot with its place, look and problems. */
export function mapLines(asset:Asset,shots:Shot[],limit=12){
 const own=shots.filter(s=>s.assetId===asset.id).sort((a,b)=>a.start-b.start),picked=own.length<=limit?own:own.filter(s=>s.log||s.quality?.problems.length).slice(0,limit);
 return picked.map(s=>`${s.start.toFixed(1)}-${s.end.toFixed(1)}s${s.log?': '+s.log.description:''}${s.quality?.problems.length?` [${s.quality.problems.map(p=>problemWords[p]??p).join(', ')}]`:''}`).concat(own.length>picked.length?[`…${own.length-picked.length} more shots; search finds them by description`]:[]);
}
