import React from 'react';

// Chat markdown: paragraphs, headings, lists (nested, numbered, checklists), tables, quotes, code blocks and rules.
// Partial input while streaming always parses: an unfinished table or fence renders as far as it has arrived.
type Align='left'|'center'|'right'|undefined;
type Item={text:string;checked?:boolean;children:Block[]};
type Block={t:'p';lines:string[]}|{t:'h';level:number;text:string}|{t:'code';lang:string;text:string}|{t:'hr'}|{t:'quote';blocks:Block[]}|{t:'list';ordered:boolean;start:number;items:Item[]}|{t:'table';align:Align[];head:string[];rows:string[][]};

const fence=/^\s{0,3}(```+|~~~+)\s*([\w+#.-]*)/,rule=/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/,heading=/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,quote=/^\s{0,3}>\s?/,bullet=/^(\s*)([-*+•]|\d{1,9}[.)])\s+(.*)$/;
const separator=/^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const cells=(row:string)=>row.trim().replace(/^\|/,'').replace(/(?<!\\)\|$/,'').split(/(?<!\\)\|/).map(cell=>cell.trim().replace(/\\\|/g,'|'));
const tableStart=(lines:string[],i:number)=>lines[i].includes('|')&&i+1<lines.length&&lines[i+1].includes('|')&&separator.test(lines[i+1]);
const starts=(lines:string[],i:number)=>fence.test(lines[i])||rule.test(lines[i])||heading.test(lines[i])||quote.test(lines[i])||bullet.test(lines[i])||tableStart(lines,i);
const indent=(line:string)=>line.replace(/\t/g,'  ').match(/^\s*/)![0].length;

function parse(lines:string[]):Block[]{
 const blocks:Block[]=[];let i=0;
 while(i<lines.length){
  const line=lines[i];
  if(!line.trim()){i++;continue;}
  const open=fence.exec(line);
  if(open){const marker=open[1],body:string[]=[];i++;while(i<lines.length&&!lines[i].trim().startsWith(marker))body.push(lines[i++]);i++;blocks.push({t:'code',lang:open[2],text:body.join('\n')});continue;}
  if(rule.test(line)){blocks.push({t:'hr'});i++;continue;}
  const h=heading.exec(line);
  if(h){blocks.push({t:'h',level:h[1].length,text:h[2]});i++;continue;}
  if(tableStart(lines,i)){
   const head=cells(line),align=cells(lines[i+1]).map(c=>c.startsWith(':')&&c.endsWith(':')?'center':c.endsWith(':')?'right':c.startsWith(':')?'left':undefined) as Align[],rows:string[][]=[];i+=2;
   while(i<lines.length&&lines[i].trim()&&lines[i].includes('|'))rows.push(cells(lines[i++]));
   blocks.push({t:'table',align,head,rows});continue;
  }
  if(quote.test(line)){const body:string[]=[];while(i<lines.length&&lines[i].trim()&&(quote.test(lines[i])||!starts(lines,i)))body.push(lines[i++].replace(quote,''));blocks.push({t:'quote',blocks:parse(body)});continue;}
  const b=bullet.exec(line);
  if(b){
   const base=indent(line),ordered=/\d/.test(b[2]),items:Item[]=[];
   while(i<lines.length){
    const current=lines[i],m=bullet.exec(current);
    if(!current.trim()){if(i+1<lines.length&&(bullet.test(lines[i+1])||indent(lines[i+1])>base))i++;else break;continue;}
    if(m&&indent(current)===base&&/\d/.test(m[2])===ordered){const task=/^\[([ xX])\]\s+(.*)$/.exec(m[3]);items.push({text:task?task[2]:m[3],checked:task?task[1]!==' ':undefined,children:[]});i++;continue;}
    if(indent(current)>base&&items.length){const nested:string[]=[];while(i<lines.length&&(indent(lines[i])>base&&lines[i].trim()||!lines[i].trim()&&i+1<lines.length&&indent(lines[i+1])>base))nested.push(lines[i++]);const item=items.at(-1)!,shift=Math.min(...nested.filter(l=>l.trim()).map(indent));
     // Indented text right after an item continues it; indented list markers start a nested list.
     if(!bullet.test(nested[0])){const text:string[]=[];while(nested.length&&nested[0].trim()&&!bullet.test(nested[0]))text.push(nested.shift()!.trim());item.text+='\n'+text.join('\n');}
     item.children.push(...parse(nested.map(l=>l.slice(Math.min(shift,indent(l))))));continue;}
    break;
   }
   blocks.push({t:'list',ordered,start:ordered?Number(b[2].replace(/\D/g,''))||1:1,items});continue;
  }
  const body:string[]=[];while(i<lines.length&&lines[i].trim()&&(!body.length||!starts(lines,i)))body.push(lines[i++].trim());
  blocks.push({t:'p',lines:body});
 }
 return blocks;
}

// Code spans first so their contents stay literal; then links, bold, strikethrough and italics (underscores only at word edges).
const span=/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__(?!\w)|~~(?=\S)([\s\S]*?\S)~~|(?<![\w*])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?![\w*])|(?<![\w_])_(?=[^\s_])([\s\S]*?[^\s_])_(?![\w_])/g;
function inline(text:string,key='s'):React.ReactNode[]{
 const out:React.ReactNode[]=[];let last=0,n=0,m:RegExpExecArray|null;const pattern=new RegExp(span.source,'g');
 while((m=pattern.exec(text))){
  if(m.index>last)out.push(text.slice(last,m.index));const k=key+'.'+n++;
  if(m[1])out.push(<code key={k}>{m[2].replace(/^ (.*) $/,'$1')}</code>);
  else if(m[3])out.push(<span key={k} className="md-link" title={m[4]}>{inline(m[3],k)}</span>);
  else if(m[5]??m[6])out.push(<strong key={k}>{inline((m[5]??m[6])!,k)}</strong>);
  else if(m[7])out.push(<del key={k}>{inline(m[7],k)}</del>);
  else out.push(<em key={k}>{inline((m[8]??m[9])!,k)}</em>);
  last=pattern.lastIndex;
 }
 if(last<text.length)out.push(text.slice(last));return out;
}
const lines=(text:string,key:string)=>text.split('\n').flatMap((line,i)=>i?[<br key={key+'br'+i}/>,...inline(line,key+'l'+i)]:inline(line,key+'l'+i));
const caret=<span className="stream-cursor" aria-hidden="true"/>;

function render(blocks:Block[],key:string,cursor:boolean):React.ReactNode[]{
 return blocks.map((block,index)=>{
  const k=key+index,tail=cursor&&index===blocks.length-1?caret:null;
  switch(block.t){
   case 'p':return <p key={k}>{lines(block.lines.join('\n'),k)}{tail}</p>;
   case 'h':return React.createElement('h'+Math.min(6,block.level+1),{key:k,className:'md-h'+block.level},...inline(block.text,k),tail);
   case 'code':return <pre key={k} data-lang={block.lang||undefined}><code>{block.text}{tail}</code></pre>;
   case 'hr':return <hr key={k}/>;
   case 'quote':return <blockquote key={k}>{render(block.blocks,k,!!tail)}</blockquote>;
   case 'table':return <div key={k} className="md-table"><table><thead><tr>{block.head.map((cell,c)=><th key={c} style={{textAlign:block.align[c]}}>{inline(cell,k+'h'+c)}</th>)}</tr></thead><tbody>{block.rows.map((row,r)=><tr key={r}>{block.head.map((_,c)=><td key={c} style={{textAlign:block.align[c]}}>{inline(row[c]??'',k+'r'+r+'c'+c)}</td>)}</tr>)}</tbody></table>{tail}</div>;
   case 'list':{const List=block.ordered?'ol':'ul';return <List key={k} start={block.ordered&&block.start!==1?block.start:undefined}>{block.items.map((item,n)=>{const last=!!tail&&n===block.items.length-1;return <li key={n} className={item.checked===undefined?undefined:'md-task'}>{item.checked!==undefined&&<span className={'md-check'+(item.checked?' done':'')} aria-label={item.checked?'Done':'Not done'}/>}{lines(item.text,k+'i'+n)}{last&&!item.children.length&&caret}{render(item.children,k+'i'+n+'-',last&&!!item.children.length)}</li>;})}</List>;}
  }
 });
}

export function MessageText({text,streaming=false}:{text:string;streaming?:boolean}){
 const blocks=parse(text.replace(/\r\n?/g,'\n').trim().split('\n'));
 return <div className="message-prose">{render(blocks,'b',streaming)}{streaming&&!blocks.length&&caret}</div>;
}
