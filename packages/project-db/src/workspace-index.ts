import {readFileSync,statSync} from 'node:fs';
import type {ProjectDB} from './index';
import {authoredFiles,digest,workspacePath} from './workspace-store';
export class WorkspaceIndex {
 constructor(private db:ProjectDB,private root:string){}
 refresh(){
  const files=authoredFiles(this.root),live=new Set(files);
  this.db.db.transaction(()=>{
   for(const {path} of this.db.db.prepare('SELECT path FROM workspace_files').all() as {path:string}[])if(!live.has(path))this.db.db.prepare('DELETE FROM workspace_files WHERE path=?').run(path);
   for(const path of files){const abs=workspacePath(this.root,path);if(statSync(abs).size>2_000_000){this.db.db.prepare('DELETE FROM workspace_files WHERE path=?').run(path);continue;}const text=readFileSync(abs,'utf8');if(text.includes('\0')){this.db.db.prepare('DELETE FROM workspace_files WHERE path=?').run(path);continue;}const hash=digest(text),old=this.db.db.prepare('SELECT hash FROM workspace_files WHERE path=?').get(path) as any;if(old?.hash===hash)continue;
    const lines=text.split('\n'),chunks:{start:number;end:number;text:string}[]=[];let start=0;
    for(let i=0;i<lines.length;i++){if(i-start>=100||i>start+15&&/^\s*(export |async |class |function |def )/.test(lines[i])){chunks.push({start:start+1,end:i,text:lines.slice(start,i).join('\n')});start=i;}}
    chunks.push({start:start+1,end:lines.length,text:lines.slice(start).join('\n')});this.db.db.prepare('INSERT OR REPLACE INTO workspace_files VALUES(?,?,?,?)').run(path,hash,text.length,JSON.stringify(chunks));
   }
  })();
 }
 search(query:string,limit=12){this.refresh();const terms=query.toLowerCase().split(/\W+/).filter(t=>t.length>2);const rows=this.db.db.prepare('SELECT * FROM workspace_files').all() as any[];const hits=rows.flatMap(row=>(JSON.parse(row.chunks) as any[]).map(chunk=>({path:row.path,hash:row.hash,...chunk,score:terms.reduce((n,t)=>n+(chunk.text.toLowerCase().includes(t)?1:0)+(row.path.toLowerCase().includes(t)?2:0),0)}))).filter(c=>c.score>0).sort((a,b)=>b.score-a.score).slice(0,limit).map(c=>({...c,text:c.text.slice(0,5000)}));return{availableCharacters:rows.reduce((n,r)=>n+r.characters,0),selectedCharacters:hits.reduce((n,r)=>n+r.text.length,0),files:rows.map(r=>({path:r.path,hash:r.hash,characters:r.characters})),hits};}
}
