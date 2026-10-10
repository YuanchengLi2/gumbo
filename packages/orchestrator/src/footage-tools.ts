import {z} from 'zod';
import {assetCatalog,readFootage,InspectFootageSchema,sourceFrameContent,type SourceFrames} from '@dream/footage';
import type {ProjectDB} from '@dream/project-db';

const schemas={
 inspect_footage:InspectFootageSchema,
 list_assets:z.object({offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(20).default(20)}),
 read_footage:z.object({observationOffset:z.number().int().nonnegative().default(0),assetId:z.string(),startSec:z.number().nonnegative(),endSec:z.number().positive(),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(250).default(150)}),
 search_footage:z.object({query:z.string().min(1).max(500)})
};
const descriptions={inspect_footage:'Inspect actual source images. Use preview for an immediate keyframe overview across any source duration, overview for scene-aware context across up to sixty seconds; normal or motion for a detailed range up to eight seconds. No completed background scan is required. Images carry exact source timestamps; inspect shorter ranges when selecting precise cuts.',list_assets:'Read a page of local asset metadata and sampled transcript/shot excerpts. No source files are uploaded.',read_footage:'Read timestamped visual observations, confidence, refinement evidence, exact speech and shot descriptions for a source range. Use nextOffset for words and nextObservationOffset for observations; those offsets are independent.',search_footage:'Search observed actions, objects, visible text, transcripts and shots across the local source index. Returns up to 20 matching records with source times and short nearby transcript context. Read promising ranges before choosing cuts.'};
export const footageTools=Object.entries(schemas).map(([name,schema])=>({name,description:descriptions[name as keyof typeof descriptions],input_schema:z.toJSONSchema(schema,{target:'draft-7'})}));
export const isFootageTool=(name:string)=>Object.hasOwn(schemas,name);
const parseRows=(rows:any[])=>rows.map(row=>JSON.parse(row.json));
function records(db:ProjectDB,kind:string,asset:string,start=0,end=Number.MAX_SAFE_INTEGER,offset=0,limit=150){return parseRows(db.db.prepare("SELECT json FROM index_records WHERE kind=? AND json_extract(json,'$.assetId')=? AND json_extract(json,'$.end')>? AND json_extract(json,'$.start')<? ORDER BY json_extract(json,'$.start'),id LIMIT ? OFFSET ?").all(kind,asset,start,end,limit,offset));}
function count(db:ProjectDB,kind:string,asset:string,start=0,end=Number.MAX_SAFE_INTEGER){return (db.db.prepare("SELECT COUNT(*) AS n FROM index_records WHERE kind=? AND json_extract(json,'$.assetId')=? AND json_extract(json,'$.end')>? AND json_extract(json,'$.start')<?").get(kind,asset,start,end) as {n:number}).n;}
export function executeFootageTool(db:ProjectDB,name:string,input:unknown,signal?:AbortSignal):unknown{
 const indexRevision=Number(db.getMeta('index_revision')??0);
 if(name==='inspect_footage'){if(!db.inspectSource)throw new Error('Source-frame inspection is unavailable in this runtime.');return db.inspectSource(InspectFootageSchema.parse(input),signal);}
 if(name==='list_assets'){
  const {offset,limit}=schemas.list_assets.parse(input),filter="COALESCE(json_extract(json,'$.generated.role'),'')<>'stem'";
  const total=(db.db.prepare('SELECT COUNT(*) AS n FROM assets WHERE '+filter).get() as {n:number}).n;
  const assets=parseRows(db.db.prepare('SELECT json FROM assets WHERE '+filter+' ORDER BY rowid LIMIT ? OFFSET ?').all(limit,offset)).map(a=>{
   const wordCount=count(db,'words',a.id),shotCount=count(db,'shots',a.id);
   const transcriptSamples=[...new Set([0,Math.floor(wordCount/2),Math.max(0,wordCount-16)])].flatMap(n=>{const words=records(db,'words',a.id,0,Number.MAX_SAFE_INTEGER,n,16);return words.length?[{start:words[0].start,end:words.at(-1).end,text:words.map(w=>w.text).join(' ').slice(0,1200)}]:[];});
   return{id:a.id,filename:a.filename,kind:a.kind,durationSec:a.durationSec,hasAudio:a.hasAudio,missing:a.missing,status:a.status,wordCount,shotCount,speechCoverage:JSON.parse(db.getMeta('speech-coverage:'+a.id)??'null'),visualContext:a.context,visualUnderstanding:a.understanding,observationCount:count(db,'observations',a.id),transcriptSamples,shotSamples:records(db,'shots',a.id,0,Number.MAX_SAFE_INTEGER,0,3).map(s=>({id:s.id,start:s.start,end:s.end,description:s.log?.description?.slice(0,500)}))};
  });return{indexRevision,totalAssets:total,assets,nextOffset:offset+assets.length<total?offset+assets.length:null,coverage:'Catalog excerpts are samples. Read exact source ranges before choosing cuts.'};
 }
 if(name==='read_footage'){
  const a=schemas.read_footage.parse(input),row=db.db.prepare('SELECT json FROM assets WHERE id=?').get(a.assetId) as {json:string}|undefined;if(!row)throw new Error('Asset not found in this project.');const asset=JSON.parse(row.json);
  if(a.endSec<=a.startSec||a.startSec>asset.durationSec)throw new Error('Use a positive range inside the asset duration.');
  const words=records(db,'words',a.assetId,a.startSec,a.endSec,a.offset,a.limit),shots=records(db,'shots',a.assetId,a.startSec,a.endSec,0,41),totalWords=count(db,'words',a.assetId,a.startSec,a.endSec);
  const faces=parseRows(db.db.prepare("SELECT json FROM index_records WHERE kind='faces' AND json_extract(json,'$.assetId')=? AND EXISTS(SELECT 1 FROM json_each(json,'$.samples') WHERE json_extract(value,'$.t')>=? AND json_extract(value,'$.t')<?) LIMIT 40").all(a.assetId,a.startSec,a.endSec)).map(f=>({id:f.id,speaker:f.speaker??'unknown'}));
  const observations=records(db,'observations',a.assetId,a.startSec,a.endSec,a.observationOffset,6),observationCount=count(db,'observations',a.assetId,a.startSec,a.endSec);
  return{observations,totalObservations:observationCount,nextObservationOffset:a.observationOffset+observations.length<observationCount?a.observationOffset+observations.length:null,visualUnderstanding:asset.understanding,speechCoverage:JSON.parse(db.getMeta('speech-coverage:'+a.assetId)??'null'),transcriptionJob:db.db.prepare("SELECT status,percent,error FROM jobs WHERE asset_id=? AND step='transcription'").get(a.assetId),indexRevision,assetId:a.assetId,startSec:a.startSec,endSec:Math.min(a.endSec,asset.durationSec),words,totalWords,nextOffset:a.offset+words.length<totalWords?a.offset+words.length:null,shots:shots.slice(0,40).map(({framePaths,...shot})=>({...shot,log:shot.log?{...shot.log,description:shot.log.description.slice(0,1000)}:undefined})),shotsTruncated:shots.length>40,faces,coverage:words.length?'Only this source range and page were read. Word times are source seconds; attachments also need a clip occurrence ID.':'No aligned words are available in this range. Do not infer silence or invent dialogue.'};
 }
 if(name==='search_footage')return db.search(schemas.search_footage.parse(input).query).map(hit=>{const row=db.db.prepare('SELECT json FROM index_records WHERE kind=? AND id=?').get(hit.kind,hit.id) as {json:string}|undefined;const value=row?JSON.parse(row.json):{};return{id:hit.id,assetId:hit.asset_id,kind:hit.kind,text:hit.text.slice(0,2000),...(hit.kind==='observations'?{evidenceType:'sampled_visual_sequence',confidence:value.report?.events?.map((e:any)=>e.confidence),coverage:value.coverage}:{}),start:value.start,end:value.end,...(value.start!==undefined?{nearbyText:records(db,'words',hit.asset_id,Math.max(0,value.start-3),value.start+5,0,100).map(w=>w.text).join(' ').slice(0,1200)}:{})};});
 throw new Error(`Unknown footage read tool: ${name}`);
}

export function footageResultContent(name:string,value:unknown){return name==='inspect_footage'?sourceFrameContent(value as SourceFrames):JSON.stringify(value);}

