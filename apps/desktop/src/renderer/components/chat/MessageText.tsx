import React from 'react';

function inline(text:string){return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part,i)=>part.startsWith('**')?<strong key={i}>{part.slice(2,-2)}</strong>:part.startsWith('`')?<code key={i}>{part.slice(1,-1)}</code>:part);}
export function MessageText({text}:{text:string}){
 const blocks:React.ReactNode[]=[];let lines:string[]=[],kind='p';
 const flush=()=>{if(!lines.length)return;const key=blocks.length;blocks.push(kind==='ul'?<ul key={key}>{lines.map((line,i)=><li key={i}>{inline(line)}</li>)}</ul>:kind==='ol'?<ol key={key}>{lines.map((line,i)=><li key={i}>{inline(line)}</li>)}</ol>:kind.startsWith('heading')?React.createElement('h'+kind.slice(7),{key},inline(lines.join(' '))):<p key={key}>{inline(lines.join('\n'))}</p>);lines=[];};
 for(const line of text.split('\n')){if(!line.trim()){flush();continue;}const heading=/^#{1,4}\s+(.*)/.exec(line),bullet=/^\s*[-*•]\s+(.*)/.exec(line),number=/^\s*\d+[.)]\s+(.*)/.exec(line),next=heading?'heading'+line.match(/^#+/)![0].length:bullet?'ul':number?'ol':'p';if(next!==kind||next.startsWith('heading'))flush();kind=next;lines.push((heading??bullet??number)?.[1]??line);}
 flush();return <div className="message-prose">{blocks}</div>;
}
