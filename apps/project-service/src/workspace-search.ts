import {lstatSync,readdirSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {sourceExcluded,workspacePath} from '../../../packages/project-db/src/workspace-store';

/** Explicit paths search text contents, including generated context documents. */
export function searchWorkspace(root:string,path:string,query:string){
 const target=workspacePath(root,path),files:string[]=[];
 const walk=(file:string)=>{if(files.length>=200)return;const stat=lstatSync(file);if(stat.isSymbolicLink())return;if(stat.isDirectory()){for(const name of readdirSync(file)){if(sourceExcluded.has(name))continue;walk(workspacePath(root,relative(root,join(file,name))));}}else if(stat.isFile()&&stat.size<=4_000_000)files.push(file);};walk(target);
 const terms=query.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean),matches:{path:string;line:number;text:string;score:number}[]=[];
 for(const file of files){const text=readFileSync(file,'utf8');if(text.includes('\0'))continue;const lines=text.split('\n');for(let n=0;n<lines.length;n++){const score=terms.reduce((sum,term)=>sum+(lines[n].toLowerCase().includes(term)?1:0),0);if(score)matches.push({path:relative(root,file).replaceAll('\\','/'),line:n+1,text:lines.slice(Math.max(0,n-2),Math.min(lines.length,n+4)).join('\n').slice(0,3000),score});}}
 return{query,filesSearched:files.length,matches:matches.sort((a,b)=>b.score-a.score).slice(0,20),truncated:files.length===200||matches.length>20};
}
