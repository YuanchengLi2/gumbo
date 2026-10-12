import type {ProjectDB} from './index';
import {contentHash} from './blob-store';

export const safeContext=(_key:string,value:unknown)=>/path|directory|fingerprint|waveform|framePaths|samples/i.test(_key)?undefined:value;
/** Line-preserving chunks; source boundaries remain readable and revision checked. */
export function textChunks(text:string,code=false){
 const lines=text.split('\n'),chunks:{text:string;startLine:number;endLine:number}[]=[];let start=0,current='';
 for(let n=0;n<lines.length;n++){
  const boundary=code&&/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|interface|type)\b/.test(lines[n]);
  if(current&&(current.length+lines[n].length>1800||boundary&&current.length>400)){chunks.push({text:current,startLine:start+1,endLine:n});start=n;current='';}
  // A minified line can still be paged without ever losing characters.
  if(lines[n].length>1800){if(current){chunks.push({text:current,startLine:start+1,endLine:n});current='';}for(let i=0;i<lines[n].length;i+=1800)chunks.push({text:lines[n].slice(i,i+1800),startLine:n+1,endLine:n+1});start=n+1;}
  else current+=(current?'\n':'')+lines[n];
 }
 if(current)chunks.push({text:current,startLine:start+1,endLine:lines.length});return chunks;
}
export function syncContext(p:ProjectDB){
 const db=p.db;const changed=p.getMeta('context_timeline_revision')!==p.head()||!!db.prepare('SELECT 1 FROM context_dirty LIMIT 1').get();
 const replace=(kind:string,owner:string,value:unknown)=>{
  const text=value===undefined?'':typeof value==='string'?value:JSON.stringify(value,safeContext),revision=p.blobs.put(text);
  const previous=db.prepare('SELECT revision FROM context_owners WHERE kind=? AND owner=?').get(kind,owner) as {revision:string}|undefined;
  if(previous?.revision===revision)return;
  if(previous||db.prepare('SELECT 1 FROM context_chunks WHERE kind=? AND owner=? LIMIT 1').get(kind,owner)){db.prepare('DELETE FROM context_fts WHERE id IN (SELECT id FROM context_chunks WHERE kind=? AND owner=?)').run(kind,owner);
  db.prepare('DELETE FROM context_chunks WHERE kind=? AND owner=?').run(kind,owner);}
  const insert=db.prepare('INSERT INTO context_chunks(id,kind,owner,text,hash) VALUES(?,?,?,?,?)'),fts=db.prepare('INSERT INTO context_fts(id,text) VALUES(?,?)');
  textChunks(text,kind==='code').forEach((part,n)=>{const id=`${kind}:${owner}:${n}`;insert.run(id,kind,owner,part.text,revision);fts.run(id,part.text);});
  db.prepare('INSERT INTO context_owners VALUES(?,?,?) ON CONFLICT(kind,owner) DO UPDATE SET revision=excluded.revision').run(kind,owner,revision);
 };
 db.transaction(()=>{
  if(p.getMeta('context_timeline_revision')!==p.head()){
   const t=p.timeline(),present=new Set<string>();
   for(const [kind,items] of [['clip',t.spine],['overlay',t.attached],['music',t.music],['beat',t.beats],['captions',t.captions?[{id:'project',...t.captions}]:[]]] as const)for(const item of items){present.add(kind+':'+item.id);replace(kind,item.id,item);}
   for(const row of db.prepare("SELECT kind,owner FROM context_owners WHERE kind IN ('clip','overlay','music','beat','captions')").all() as {kind:string;owner:string}[])if(!present.has(row.kind+':'+row.owner))replace(row.kind,row.owner,undefined);
   p.setMeta('context_timeline_revision',p.head());
  }
  for(const row of db.prepare('SELECT kind,owner FROM context_dirty').all() as {kind:string;owner:string}[]){
   if(row.kind==='execution'){replace('execution',row.owner,p.getMeta('workspace-receipt-summary:'+row.owner));continue;}
   if(row.kind==='workflow'){replace('workflow',row.owner,p.getMeta('workflow:'+row.owner));}
   else if(row.kind==='decision'){replace('decision',row.owner,db.prepare('SELECT id,source_id AS sourceId,scope,text,supersedes FROM project_decisions WHERE id=? AND active=1').get(row.owner));}
   else if(row.kind==='asset'){const value=db.prepare('SELECT json FROM assets WHERE id=?').get(row.owner) as {json:string}|undefined;
    // Facts about the source only: earlier projects' footage maps and visual summaries are interpretations the agent no longer relies on.
    const {footageMap:_map,context:_context,understanding:_understanding,...asset}=value?JSON.parse(value.json):{};replace(row.kind,row.owner,value?asset:undefined);}
   else if(row.kind==='conversation'){replace(row.kind,row.owner,db.prepare('SELECT role,text,turn_id AS turnId FROM messages WHERE id=?').get(row.owner));}
   else if(row.kind==='library'){
    const found=db.prepare('SELECT kind,json FROM library WHERE id=?').get(row.owner) as {kind:string;json:string}|undefined;const v=found?JSON.parse(found.json):undefined;
    replace('library',row.owner,v?{id:row.owner,kind:found!.kind,title:v.definition?.title??v.document?.title??v.title,revisionId:v.revisionId,assetId:v.assetId}:undefined);
    replace('code',row.owner,v?.definition?.code);
    if(v?.definition?.source?.modules)for(const [name,hash] of Object.entries(v.definition.source.modules))replace('code',row.owner+'/'+name,p.blobs.get(String(hash)));
   }else replace(row.kind,row.owner,p.getMeta(row.kind));
  }
  db.prepare('DELETE FROM context_dirty').run();if(changed)p.setMeta('context_generation',String(Number(p.getMeta('context_generation')??0)+1));
 })();
}
