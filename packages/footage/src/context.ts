import type {FootageIndex} from './index';

export function assetCatalog(index:FootageIndex,offset=0,limit=20){
 const visible=index.assets.filter(a=>a.generated?.role!=='stem');
 const assets=visible.slice(offset,offset+limit).map(a=>{
  const words=index.words.filter(w=>w.assetId===a.id),shots=index.shots.filter(s=>s.assetId===a.id);
  const sampleOffsets=[...new Set([0,Math.floor(words.length/2),Math.max(0,words.length-16)])];
  return{id:a.id,filename:a.filename,kind:a.kind,durationSec:a.durationSec,hasAudio:a.hasAudio,missing:a.missing,status:a.status,wordCount:words.length,shotCount:shots.length,
   transcriptSamples:sampleOffsets.filter(n=>n<words.length).map(n=>({start:words[n].start,end:words[Math.min(words.length-1,n+15)].end,text:words.slice(n,n+16).map(w=>w.text).join(' ').slice(0,1200)})),
   shotSamples:shots.filter(s=>s.log).slice(0,3).map(s=>({id:s.id,start:s.start,end:s.end,description:s.log!.description.slice(0,500)}))};
 });
 return{indexRevision:index.revision,totalAssets:visible.length,assets,nextOffset:offset+assets.length<visible.length?offset+assets.length:null,coverage:'Catalog excerpts are samples. Use search_footage and read_footage before selecting source ranges or quoting dialogue.'};
}

export function readFootage(index:FootageIndex,request:{assetId:string;startSec:number;endSec:number;offset:number;limit:number}){
 const {assetId,startSec,endSec,offset,limit}=request,asset=index.assets.find(a=>a.id===assetId);
 if(!asset)throw new Error('Asset not found in this project.');
 if(endSec<=startSec||startSec>asset.durationSec)throw new Error('Use a positive range inside the asset duration.');
 const words=index.words.filter(w=>w.assetId===assetId&&w.end>startSec&&w.start<endSec).sort((a,b)=>a.start-b.start);
 const shots=index.shots.filter(s=>s.assetId===assetId&&s.end>startSec&&s.start<endSec);
 return{indexRevision:index.revision,assetId,startSec,endSec:Math.min(endSec,asset.durationSec),words:words.slice(offset,offset+limit),totalWords:words.length,nextOffset:offset+limit<words.length?offset+limit:null,
  shots:shots.slice(0,40).map(({framePaths,...shot})=>({...shot,log:shot.log?{...shot.log,description:shot.log.description.slice(0,1000)}:undefined})),shotsTruncated:shots.length>40,
  faces:index.faces.filter(f=>f.assetId===assetId&&f.samples.some(s=>s.t>=startSec&&s.t<endSec)).slice(0,40).map(f=>({id:f.id,speaker:f.speaker??'unknown'})),
  coverage:words.length?'Only this source range and page were read. Word times are source seconds; attachments also need a clip occurrence ID.':'No aligned words are available in this range. Do not infer silence or invent dialogue.'};
}
