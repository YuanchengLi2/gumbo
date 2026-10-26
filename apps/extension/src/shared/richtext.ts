/** Rich text as the model reads and writes it: light Markdown. A selection in a rich editor goes to the model as Markdown
 * (bold, italics, links, code, lists, headings, line breaks) and the rewrite comes back to HTML, so formatting survives a
 * rewrite. Nothing else is kept; anything else becomes plain text. */
const escapeHtml=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const BLOCKS=new Set(['P','DIV','LI','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','PRE','UL','OL','TR','SECTION','ARTICLE']);

export function htmlToMarkdown(root:Node):string{
 const out:string[]=[];
 const walk=(node:Node,list?:{ordered:boolean;n:number}):string=>{
  if(node.nodeType===3)return (node as Text).data.replace(/\s+/g,' ');
  if(node.nodeType!==1&&node.nodeType!==11)return '';
  const el=node as Element,tag=el.tagName??'';
  const inner=(l=list)=>[...node.childNodes].map(c=>walk(c,l)).join('');
  switch(tag){
   case 'B':case 'STRONG':{const t=inner();return t.trim()?`**${t.trim()}**${/\s$/.test(t)?' ':''}`:t;}
   case 'I':case 'EM':{const t=inner();return t.trim()?`*${t.trim()}*${/\s$/.test(t)?' ':''}`:t;}
   case 'CODE':return '`'+inner()+'`';
   case 'A':{const href=el.getAttribute('href');const t=inner();return href&&/^https?:|^mailto:/.test(href)?`[${t}](${href})`:t;}
   case 'BR':return '\n';
   case 'UL':return '\n'+[...el.children].map(li=>'- '+walk(li,{ordered:false,n:0}).trim()).join('\n')+'\n';
   case 'OL':return '\n'+[...el.children].map((li,i)=>`${i+1}. `+walk(li,{ordered:true,n:i+1}).trim()).join('\n')+'\n';
   case 'H1':case 'H2':case 'H3':return '\n'+'#'.repeat(Number(tag[1]))+' '+inner().trim()+'\n';
   case 'SCRIPT':case 'STYLE':return '';
  }
  const t=inner();return BLOCKS.has(tag)?'\n'+t.trim()+'\n':t;
 };
 out.push(walk(root));
 return out.join('').replace(/\n{3,}/g,'\n\n').replace(/^\n+|\n+$/g,'');
}
/** Whether a piece of Markdown carries any formatting worth sending as HTML. */
export const hasFormatting=(md:string)=>/\*\*[^*]+\*\*|(^|[^*])\*[^*\s][^*]*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`|^\s*([-*]|\d+\.)\s|^#{1,3}\s/m.test(md);

function inline(md:string){
 return escapeHtml(md)
  .replace(/`([^`]+)`/g,'<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\s][^*]*)\*/g,'$1<em>$2</em>')
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+|mailto:[^)\s]+)\)/g,'<a href="$2">$1</a>');
}
export function markdownToHtml(md:string):string{
 const blocks=md.replace(/\r\n/g,'\n').split(/\n{2,}/),out:string[]=[];
 for(const block of blocks){
  const lines=block.split('\n');
  if(lines.every(l=>/^\s*[-*]\s+/.test(l)))out.push('<ul>'+lines.map(l=>`<li>${inline(l.replace(/^\s*[-*]\s+/,''))}</li>`).join('')+'</ul>');
  else if(lines.every(l=>/^\s*\d+\.\s+/.test(l)))out.push('<ol>'+lines.map(l=>`<li>${inline(l.replace(/^\s*\d+\.\s+/,''))}</li>`).join('')+'</ol>');
  else if(/^#{1,3}\s/.test(block)){const level=/^(#{1,3})/.exec(block)![1].length;out.push(`<h${level}>${inline(block.replace(/^#{1,3}\s+/,''))}</h${level}>`);}
  else out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
 }
 return out.join('');
}
/** The text Markdown reads as, without its marks: what the field's own text should say after the rewrite. */
export function plainOf(md:string):string{
 return md.replace(/\*\*([^*]+)\*\*/g,'$1').replace(/(^|[^*])\*([^*\s][^*]*)\*/g,'$1$2').replace(/`([^`]+)`/g,'$1').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/^\s*[-*]\s+/gm,'').replace(/^\s*\d+\.\s+/gm,'').replace(/^#{1,3}\s+/gm,'');
}
