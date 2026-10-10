import type Database from 'better-sqlite3';
import {getLoadablePath} from 'sqlite-vec';

export type SearchHit={id:string;asset_id:string;kind:string;text:string;score:number};
function encode(vector:number[]){
 if(!vector.length||vector.length>4096||vector.some(n=>!Number.isFinite(n))||vector.every(n=>n===0))throw new Error('Embedding must be a finite nonzero vector with at most 4096 dimensions.');
 const values=Float32Array.from(vector);return Buffer.from(values.buffer);
}
export function installVectorSearch(db:Database.Database){db.loadExtension(getLoadablePath().replace(/app\.asar([\\/])/,'app.asar.unpacked$1'));}
export function saveVectors(db:Database.Database,modelId:string,rows:{id:string;assetId:string;vector:number[]}[]){
 if(!modelId)throw new Error('Embedding model revision is required.');
 const encoded=rows.map(row=>({...row,bytes:encode(row.vector)}));
 db.transaction(()=>{const insert=db.prepare('INSERT INTO embeddings(id,asset_id,model_id,dimensions,vector) VALUES(?,?,?,?,?) ON CONFLICT(id,model_id) DO UPDATE SET asset_id=excluded.asset_id,dimensions=excluded.dimensions,vector=excluded.vector');for(const row of encoded)insert.run(row.id,row.assetId,modelId,row.vector.length,row.bytes);})();
}
export function semanticSearch(db:Database.Database,modelId:string,vector:number[]):SearchHit[]{
 const bytes=encode(vector);
 return db.prepare("SELECT e.id,e.asset_id,'shots' AS kind,COALESCE(r.json,'') AS text,vec_distance_cosine(e.vector,?) AS score FROM embeddings e LEFT JOIN index_records r ON r.id=e.id AND r.kind='shots' WHERE e.model_id=? AND e.dimensions=? ORDER BY score LIMIT 20").all(bytes,modelId,vector.length) as SearchHit[];
}
export function fuseSearch(lexical:SearchHit[],semantic:SearchHit[]){
 const ranked=new Map<string,SearchHit>();
 for(const list of [lexical,semantic])list.forEach((hit,index)=>{const previous=ranked.get(hit.id);ranked.set(hit.id,{...hit,score:(previous?.score??0)+1/(60+index+1)});});
 return [...ranked.values()].sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,20);
}
