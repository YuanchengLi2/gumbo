import {readFileSync,statSync} from 'node:fs';
import {isAbsolute,relative} from 'node:path';
import {workspacePath} from '../../../packages/project-db/src/workspace-store';

/** The code around each line an error points at, the way a developer's error overlay shows it: a few lines either side,
 * the failing line marked, a caret under the column. Errors only said "src/Paper.tsx:7:13 inputRange must be strictly
 * monotonically increasing", so the agent read the file again (or guessed) before it could see the line. */
export type CodeFrame={file:string;line:number;column?:number;code:string};

const SOURCE=/\.(?:tsx?|jsx?|mjs|cjs|py|json|css|html?)$/i;
// src/Paper.tsx:7:13, C:\...\Workspace\cut.py:12, file:///C:/.../scene.js:3:5 and Python's File "cut.py", line 12.
const REFERENCES=[/(?:file:\/\/\/)?((?:[A-Za-z]:)?[\w.@~\/\\ -]*?[\w@~-]+\.(?:tsx?|jsx?|mjs|cjs|py|json|css|html?)):(\d+)(?::(\d+))?/g,/File "([^"]+)", line (\d+)/g];

/** One file's lines around line (1-based), with column (1-based) under a caret. */
export function codeFrame(text:string,line:number,column?:number,around=2){
 const lines=text.split(/\r?\n/);if(line<1||line>lines.length)return undefined;
 const first=Math.max(1,line-around),last=Math.min(lines.length,line+around),width=String(last).length,out:string[]=[];
 for(let n=first;n<=last;n++){out.push(`${n===line?'>':' '} ${String(n).padStart(width)} | ${lines[n-1].slice(0,200)}`);if(n===line&&column&&column>0&&column<=200)out.push(`  ${' '.repeat(width)} | ${' '.repeat(column-1)}^`);}
 return out.join('\n');
}

/** Frames for the workspace files and lines named in an error's text (up to max, each file and line once). Paths outside
 * the workspace, missing files and large files are skipped. */
export function codeContext(root:string,text:string,max=3):CodeFrame[]{
 const frames:CodeFrame[]=[],seen=new Set<string>();
 for(const pattern of REFERENCES)for(const match of text.matchAll(pattern)){
  if(frames.length>=max)return frames;
  let file=match[1].replace(/\\/g,'/').trim();const line=Number(match[2]),column=match[3]?Number(match[3]):undefined;
  if(isAbsolute(file)||/^[A-Za-z]:\//.test(file)){const inside=relative(root,file).replace(/\\/g,'/');if(inside.startsWith('..')||isAbsolute(inside))continue;file=inside;}
  file=file.replace(/^\.\//,'');if(!SOURCE.test(file)||file.includes('node_modules/'))continue;
  const key=file+':'+line;if(seen.has(key))continue;seen.add(key);
  try{const path=workspacePath(root,file);if(statSync(path).size>2_000_000)continue;const code=codeFrame(readFileSync(path,'utf8'),line,column);if(code)frames.push({file,line,...(column?{column}:{}),code});}catch{}
 }
 return frames;
}
