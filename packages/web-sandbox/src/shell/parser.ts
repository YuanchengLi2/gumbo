/** A POSIX sh parser (BusyBox ash's language, which Roux's commands were written for on the desktop) plus the bash bits
 * models write anyway: [[ ]], (( )), $'…', <<<, &>, {a,b} and C-style for. Words keep their quoting so expansion can
 * split and glob only what was unquoted. */
export type Part=
 |{t:'lit';v:string;q:0|1|2}// q: 0 unquoted, 1 literal (single quotes, backslash), 2 inside double quotes
 |{t:'param';name:string;op?:string;arg?:Word;arg2?:Word;q:boolean}
 |{t:'cmd';src:string;q:boolean}
 |{t:'arith';src:string;q:boolean};
export type Word=Part[];
export type RedirectOp='>'|'>>'|'>|'|'<'|'<>'|'>&'|'<&'|'&>'|'&>>'|'<<'|'<<-'|'<<<';
export type Redirect={fd:number;op:RedirectOp;target:Word;heredoc?:Word};
export type Node=
 |{type:'simple';assigns:{name:string;value:Word}[];words:Word[];redirects:Redirect[];line:number}
 |{type:'pipeline';commands:Node[];negate:boolean;time:boolean;stderrToo:boolean[]}
 |{type:'andor';first:Node;rest:{op:'&&'|'||';node:Node}[]}
 |{type:'list';items:{node:Node;background:boolean}[]}
 |{type:'subshell';body:Node;redirects:Redirect[]}
 |{type:'group';body:Node;redirects:Redirect[]}
 |{type:'if';clauses:{cond:Node;body:Node}[];otherwise?:Node;redirects:Redirect[]}
 |{type:'for';name:string;items:Word[]|null;body:Node;redirects:Redirect[]}
 |{type:'cfor';init:string;cond:string;step:string;body:Node;redirects:Redirect[]}
 |{type:'while';cond:Node;body:Node;until:boolean;redirects:Redirect[]}
 |{type:'case';word:Word;arms:{patterns:Word[];body:Node;next:';;'|';&'|';;&'}[];redirects:Redirect[]}
 |{type:'func';name:string;body:Node}
 |{type:'test';words:Word[];redirects:Redirect[]}
 |{type:'arith';src:string;redirects:Redirect[]};

export class ShellSyntaxError extends Error{}
const META=new Set([' ','\t','\n',';','&','|','<','>','(',')']);
const RESERVED=new Set(['if','then','elif','else','fi','do','done','case','esac','while','until','for','in','{','}','!','function','[[',']]','time']);
const REDIRECT=/^(\d*)(&>>|&>|>>|>&|>\||>|<<<|<<-|<<|<&|<>|<)/;
const NAME=/^[A-Za-z_][A-Za-z0-9_]*/;

export function parse(source:string):Node{return new Parser(source).program();}

class Parser{
 i=0;private heredocs:Redirect[]=[];
 constructor(private s:string){}
 private fail(message:string):never{const line=this.s.slice(0,this.i).split('\n').length;throw new ShellSyntaxError(`sh: line ${line}: syntax error: ${message}`);}
 private get c(){return this.s[this.i];}
 private at(text:string){return this.s.startsWith(text,this.i);}
 private line(){let n=1;for(let k=0;k<this.i;k++)if(this.s[k]==='\n')n++;return n;}
 program():Node{const list=this.list([]);this.blank();if(this.i<this.s.length)this.fail(`unexpected "${this.s.slice(this.i,this.i+10).split('\n')[0]}"`);if(this.heredocs.length)this.readHeredocs();return list;}
 /** Spaces, tabs, line continuations and comments; not newlines. */
 private blank(){
  for(;;){const c=this.c;if(c===' '||c==='\t'||c==='\r')this.i++;else if(c==='\\'&&this.s[this.i+1]==='\n')this.i+=2;else if(c==='#'){while(this.i<this.s.length&&this.c!=='\n')this.i++;}else return;}
 }
 private newline(){this.i++;if(this.heredocs.length)this.readHeredocs();}
 private blankLines(){for(;;){this.blank();if(this.c==='\n')this.newline();else return;}}
 /** The next word if it is a plain, unquoted run of characters (a reserved word candidate), without consuming it. */
 private peekWord(){
  this.blank();let j=this.i;while(j<this.s.length&&!META.has(this.s[j])&&!'\'"\\$`'.includes(this.s[j]))j++;
  if(j<this.s.length&&!META.has(this.s[j]))return'';return this.s.slice(this.i,j);
 }
 private keyword(word:string){if(this.peekWord()!==word)return false;this.i+=word.length;return true;}
 private expect(word:string){if(!this.keyword(word))this.fail(`expected "${word}"${this.i<this.s.length?` near "${this.s.slice(this.i,this.i+12).split('\n')[0]}"`:' before the end'}`);}
 private atStop(stops:string[]){
  this.blank();if(this.i>=this.s.length)return true;
  for(const stop of stops){if(stop===')'&&this.c===')')return true;if(stop.startsWith(';')&&this.at(stop))return true;}
  const word=this.peekWord();return!!word&&stops.includes(word);
 }
 list(stops:string[]):Node{
  const items:{node:Node;background:boolean}[]=[];
  for(;;){
   this.blankLines();if(this.atStop(stops)||this.c===')'&&!stops.includes(')'))break;
   const node=this.andor();this.blank();let background=false;
   if(this.c==='&'&&this.s[this.i+1]!=='&'){background=true;this.i++;}
   else if(this.c===';'&&this.s[this.i+1]!==';'&&this.s[this.i+1]!=='&')this.i++;
   else if(this.c==='\n')this.newline();
   else{items.push({node,background});break;}
   items.push({node,background});
  }
  return{type:'list',items};
 }
 private andor():Node{
  const first=this.pipeline(),rest:{op:'&&'|'||';node:Node}[]=[];
  for(;;){this.blank();const op=this.at('&&')?'&&':this.at('||')?'||':null;if(!op)break;this.i+=2;this.blankLines();rest.push({op,node:this.pipeline()});}
  return rest.length?{type:'andor',first,rest}:first;
 }
 private pipeline():Node{
  let time=false,negate=false;
  for(;;){if(this.keyword('time')){time=true;continue;}if(this.keyword('!')){negate=!negate;continue;}break;}
  const commands=[this.command()],stderrToo:boolean[]=[];
  for(;;){this.blank();if(this.c==='|'&&this.s[this.i+1]!=='|'){const both=this.s[this.i+1]==='&';this.i+=both?2:1;stderrToo.push(both);this.blankLines();commands.push(this.command());}else break;}
  return commands.length===1&&!time&&!negate?commands[0]:{type:'pipeline',commands,negate,time,stderrToo};
 }
 private command():Node{
  this.blank();if(this.i>=this.s.length)this.fail('unexpected end of input');
  if(this.at('((')){const src=this.balanced('((','))');return{type:'arith',src,redirects:this.redirects()};}
  if(this.c==='('){this.i++;const body=this.list([')']);this.blank();if(this.s[this.i]!==')')this.fail('expected ")"');this.i++;return{type:'subshell',body,redirects:this.redirects()};}
  const word=this.peekWord();
  switch(word){
   case'{':{this.i++;const body=this.list(['}']);this.expect('}');return{type:'group',body,redirects:this.redirects()};}
   case'if':{this.i+=2;const clauses:{cond:Node;body:Node}[]=[];let otherwise:Node|undefined;
    for(;;){const cond=this.list(['then']);this.expect('then');const body=this.list(['elif','else','fi']);clauses.push({cond,body});if(this.keyword('elif'))continue;if(this.keyword('else'))otherwise=this.list(['fi']);this.expect('fi');break;}
    return{type:'if',clauses,otherwise,redirects:this.redirects()};}
   case'while':case'until':{this.i+=word.length;const cond=this.list(['do']);this.expect('do');const body=this.list(['done']);this.expect('done');return{type:'while',cond,body,until:word==='until',redirects:this.redirects()};}
   case'for':{this.i+=3;this.blank();
    if(this.at('((')){const [init='',cond='',step='']=this.balanced('((','))').split(';');this.blank();if(this.c===';')this.i++;this.blankLines();const loop=this.loopBody();return{type:'cfor',init,cond,step,body:loop,redirects:this.redirects()};}
    const name=NAME.exec(this.s.slice(this.i))?.[0];if(!name)this.fail('bad for loop variable');this.i+=name.length;this.blankLines();
    let items:Word[]|null=null;if(this.keyword('in')){items=[];for(;;){this.blank();if(this.c===';'||this.c==='\n'||this.i>=this.s.length)break;items.push(this.word());}}
    this.blank();if(this.c===';')this.i++;this.blankLines();return{type:'for',name,items,body:this.loopBody(),redirects:this.redirects()};}
   case'case':{this.i+=4;this.blank();const subject=this.word();this.blankLines();this.expect('in');const arms:{patterns:Word[];body:Node;next:';;'|';&'|';;&'}[]=[];
    for(;;){this.blankLines();if(this.keyword('esac'))break;if(this.c==='(')this.i++;const patterns:Word[]=[];
     for(;;){this.blank();patterns.push(this.word());this.blank();if(this.c==='|'){this.i++;continue;}if(this.c===')'){this.i++;break;}this.fail('expected ")" in case pattern');}
     const body=this.list([';;&',';;',';&','esac']);this.blank();let next:';;'|';&'|';;&'=';;';
     if(this.at(';;&')){next=';;&';this.i+=3;}else if(this.at(';;')){this.i+=2;}else if(this.at(';&')){next=';&';this.i+=2;}arms.push({patterns,body,next});}
    return{type:'case',word:subject,arms,redirects:this.redirects()};}
   case'function':{this.i+=8;this.blank();const name=/^[^\s(){};&|<>]+/.exec(this.s.slice(this.i))?.[0];if(!name)this.fail('bad function name');this.i+=name.length;this.blank();if(this.at('()'))this.i+=2;this.blankLines();return{type:'func',name,body:this.command()};}
   case'[[':{this.i+=2;const words:Word[]=[];for(;;){this.blankLines();if(this.i>=this.s.length)this.fail('expected "]]"');if(this.peekWord()===']]'){this.i+=2;break;}
    const op=/^(&&|\|\||==|=~|!=|<|>|\(|\)|!)/.exec(this.s.slice(this.i))?.[0];if(op&&(op!=='!'||META.has(this.s[this.i+1]??' '))){this.i+=op.length;words.push([{t:'lit',v:op,q:0}]);continue;}
    words.push(this.word(true));}
    return{type:'test',words,redirects:this.redirects()};}
   case'then':case'elif':case'else':case'fi':case'do':case'done':case'esac':case'}':case'in':case']]':this.fail(`unexpected "${word}"`);
  }
  return this.simple();
 }
 private loopBody(){this.blankLines();if(this.keyword('{')){const body=this.list(['}']);this.expect('}');return body;}this.expect('do');const body=this.list(['done']);this.expect('done');return body;}
 private simple():Node{
  const line=this.line(),assigns:{name:string;value:Word}[]=[],words:Word[]=[],redirects:Redirect[]=[];
  for(;;){
   this.blank();if(this.i>=this.s.length)break;const c=this.c;
   if(c===';'||c==='\n'||c===')'||(c==='&'&&this.s[this.i+1]!=='>')||c==='|')break;
   if(this.redirect(redirects))continue;
   if(c==='('){if(words.length===1&&!assigns.length&&this.s.slice(this.i).match(/^\(\s*\)/)){this.i=this.s.indexOf(')',this.i)+1;this.blankLines();const name=words[0].map(p=>p.t==='lit'?p.v:'').join('');return{type:'func',name,body:this.command()};}this.fail('unexpected "("');}
   const start=this.i,word=this.word();
   if(!words.length){const m=/^([A-Za-z_][A-Za-z0-9_]*)(\+?)=/.exec(this.s.slice(start));if(m&&word[0]?.t==='lit'&&word[0].q===0&&word[0].v.startsWith(m[0])){
    const value=structuredClone(word);(value[0] as {v:string}).v=(value[0] as {v:string}).v.slice(m[0].length);if(!(value[0] as {v:string}).v)value.shift();
    assigns.push({name:m[1]+(m[2]?'+':''),value});continue;}}
   words.push(word);
  }
  if(!words.length&&!assigns.length&&!redirects.length)this.fail(`unexpected "${this.c??'end of input'}"`);
  return{type:'simple',assigns,words,redirects,line};
 }
 private redirects(){const out:Redirect[]=[];for(;;){this.blank();if(!this.redirect(out))return out;}}
 private redirect(out:Redirect[]){
  const m=REDIRECT.exec(this.s.slice(this.i));if(!m)return false;if(m[1]&&m[2].startsWith('&'))return false;
  const op=m[2] as RedirectOp,fd=m[1]?Number(m[1]):op.startsWith('<')&&op!=='<>'?0:op==='<>'?0:1;this.i+=m[0].length;this.blank();
  if(op==='<<'||op==='<<-'){const start=this.i,word=this.word(),raw=this.s.slice(start,this.i);const quoted=/['"\\]/.test(raw);const delimiter=word.map(p=>p.t==='lit'?p.v:'').join('');const r:Redirect={fd,op,target:[{t:'lit',v:delimiter,q:quoted?1:0}]};this.heredocs.push(r);out.push(r);return true;}
  out.push({fd,op,target:this.word()});return true;
 }
 private readHeredocs(){
  for(const r of this.heredocs.splice(0)){
   const delimiter=(r.target[0] as {v:string}).v,quoted=(r.target[0] as {q:number}).q===1,lines:string[]=[];
   for(;;){if(this.i>=this.s.length)break;let end=this.s.indexOf('\n',this.i);if(end<0)end=this.s.length;let text=this.s.slice(this.i,end);this.i=Math.min(end+1,this.s.length);if(r.op==='<<-')text=text.replace(/^\t+/,'');if(text.replace(/\r$/,'')===delimiter)break;lines.push(text);}
   const body=lines.length?lines.join('\n')+'\n':'';
   r.heredoc=quoted?[{t:'lit',v:body,q:1}]:new Parser(body).quotedText(true);
  }
 }
 /** A `((…))`-style balanced span; returns the inside. */
 private balanced(open:string,close:string){
  this.i+=open.length;const start=this.i;let depth=0;
  for(;this.i<this.s.length;this.i++){const c=this.c;if(c==='(')depth++;else if(c===')'){if(depth===0&&this.at(close)){const inner=this.s.slice(start,this.i);this.i+=close.length;return inner;}depth--;}}
  this.fail(`expected "${close}"`);
 }
 /** One shell word with its quoting. `test` words treat < > ( ) as ordinary characters. */
 word(test?:boolean):Word{
  const parts:Word=[];const lit=(v:string,q:0|1|2)=>{const last=parts[parts.length-1];if(last?.t==='lit'&&last.q===q)last.v+=v;else parts.push({t:'lit',v,q});};
  const start=this.i;
  while(this.i<this.s.length){
   const c=this.c;
   // Inside [[ ]] only blanks end a word, so a regex like ^a(b|c)$ stays one word.
   if(test?c===' '||c==='\t'||c==='\n':META.has(c))break;
   if(c==='\\'){if(this.s[this.i+1]==='\n'){this.i+=2;continue;}if(this.i+1<this.s.length)lit(this.s[this.i+1],1);this.i+=2;continue;}
   if(c==="'"){const end=this.s.indexOf("'",this.i+1);if(end<0)this.fail('unterminated quoted string');lit(this.s.slice(this.i+1,end),1);this.i=end+1;continue;}
   if(c==='$'&&this.s[this.i+1]==="'"){this.i+=2;lit(this.ansiC(),1);continue;}
   if(c==='$'&&this.s[this.i+1]==='"'){this.i++;continue;}
   if(c==='"'){this.i++;const inner=this.doubleQuoted();if(!inner.length)lit('',2);parts.push(...inner);continue;}
   if(c==='$'||c==='`'){parts.push(this.dollar(false));continue;}
   lit(c,0);this.i++;
  }
  if(this.i===start)this.fail(`unexpected "${this.c}"`);
  return parts;
 }
 private ansiC(){
  let out='';const map:Record<string,string>={n:'\n',t:'\t',r:'\r','\\':'\\',"'":"'",'"':'"',a:'\x07',b:'\b',e:'\x1b',E:'\x1b',f:'\f',v:'\v','0':'\0'};
  while(this.i<this.s.length&&this.c!=="'"){if(this.c==='\\'){const n=this.s[this.i+1];if(n==='x'){const hex=/^[0-9a-fA-F]{1,2}/.exec(this.s.slice(this.i+2))?.[0]??'';out+=String.fromCharCode(parseInt(hex||'0',16));this.i+=2+hex.length;continue;}if(n==='u'){const hex=/^[0-9a-fA-F]{1,4}/.exec(this.s.slice(this.i+2))?.[0]??'';out+=String.fromCharCode(parseInt(hex||'0',16));this.i+=2+hex.length;continue;}out+=map[n]??'\\'+n;this.i+=2;continue;}out+=this.c;this.i++;}
  this.i++;return out;
 }
 /** Inside "…": $ and ` expand, a backslash escapes only $ ` " \ and newline. */
 private doubleQuoted():Word{
  const parts:Word=[];const lit=(v:string)=>{const last=parts[parts.length-1];if(last?.t==='lit')last.v+=v;else parts.push({t:'lit',v,q:2});};
  for(;;){
   if(this.i>=this.s.length)this.fail('unterminated quoted string');const c=this.c;
   if(c==='"'){this.i++;return parts;}
   if(c==='\\'){const n=this.s[this.i+1];if(n==='\n'){this.i+=2;continue;}if('$`"\\'.includes(n)){lit(n);this.i+=2;continue;}lit('\\');this.i++;continue;}
   if(c==='$'||c==='`'){parts.push(this.dollar(true));continue;}
   lit(c);this.i++;
  }
 }
 /** Text of a here-document: like inside double quotes, but " is ordinary. */
 quotedText(heredoc:boolean):Word{
  const parts:Word=[];const lit=(v:string)=>{const last=parts[parts.length-1];if(last?.t==='lit')last.v+=v;else parts.push({t:'lit',v,q:2});};
  while(this.i<this.s.length){const c=this.c;
   if(c==='\\'){const n=this.s[this.i+1];if(n==='\n'){this.i+=2;continue;}if((heredoc?'$`\\':'$`"\\').includes(n)){lit(n);this.i+=2;continue;}lit('\\');this.i++;continue;}
   if((c==='$'&&this.i+1<this.s.length)||c==='`'){parts.push(this.dollar(true));continue;}lit(c);this.i++;}
  return parts;
 }
 private dollar(q:boolean):Part{
  if(this.c==='`'){
   this.i++;let src='';while(this.i<this.s.length&&this.c!=='`'){if(this.c==='\\'&&'`$\\'.includes(this.s[this.i+1])){src+=this.s[this.i+1];this.i+=2;continue;}src+=this.c;this.i++;}
   if(this.c!=='`')this.fail('unterminated `');this.i++;return{t:'cmd',src,q};
  }
  this.i++;const c=this.c;
  if(this.at('((')){const src=this.balanced('((','))');return{t:'arith',src,q};}
  if(c==='('){this.i++;const start=this.i,sub=new Parser(this.s);sub.i=start;sub.list([')']);sub.blank();if(sub.s[sub.i]!==')')this.fail('expected ")" to close $(');this.i=sub.i+1;return{t:'cmd',src:this.s.slice(start,sub.i),q};}
  if(c==='{')return this.braced(q);
  if(c&&/[@*#?$!0-9-]/.test(c)){this.i++;return{t:'param',name:c,q};}
  const name=NAME.exec(this.s.slice(this.i))?.[0];if(name){this.i+=name.length;return{t:'param',name,q};}
  return{t:'lit',v:'$',q:q?2:0};
 }
 private braced(q:boolean):Part{
  this.i++;
  if(this.c==='#'&&this.s[this.i+1]!=='}'&&/[A-Za-z_@*0-9]/.test(this.s[this.i+1]??'')){this.i++;const name=NAME.exec(this.s.slice(this.i))?.[0]??this.s[this.i];this.i+=name.length;if(this.s[this.i]!=='}')this.fail('bad substitution');this.i++;return{t:'param',name,op:'length',q};}
  if(this.c==='!'){this.i++;const name=NAME.exec(this.s.slice(this.i))?.[0];if(!name)this.fail('bad substitution');this.i+=name.length;if(this.s[this.i]!=='}')this.fail('bad substitution');this.i++;return{t:'param',name,op:'indirect',q};}
  const name=NAME.exec(this.s.slice(this.i))?.[0]??(/^[@*#?$!0-9-]/.test(this.c)?/^\d+|^./.exec(this.s.slice(this.i))![0]:'');if(!name)this.fail('bad substitution');this.i+=name.length;
  if(this.c==='}'){this.i++;return{t:'param',name,q};}
  const op=/^(:-|:=|:\+|:\?|-|=|\+|\?|##|#|%%|%|\/\/|\/#|\/%|\/|\^\^|\^|,,|,|:)/.exec(this.s.slice(this.i))?.[0];if(!op)this.fail('bad substitution');this.i+=op.length;
  if(op.startsWith('/')){const arg=this.argWord(q,'/}');let arg2:Word=[];if(this.c==='/'){this.i++;arg2=this.argWord(q,'}');}this.i++;return{t:'param',name,op,arg,arg2,q};}
  if(op===':'){const arg=this.argWord(q,':}');let arg2:Word|undefined;if(this.c===':'){this.i++;arg2=this.argWord(q,'}');}this.i++;return{t:'param',name,op:'substr',arg,arg2,q};}
  const arg=this.argWord(q,'}');this.i++;return{t:'param',name,op,arg,q};
 }
 /** The word inside ${name op word}, up to one of `stops` at depth 0. */
 private argWord(q:boolean,stops:string):Word{
  const parts:Word=[];const lit=(v:string,lq:0|1|2)=>{const last=parts[parts.length-1];if(last?.t==='lit'&&last.q===lq)last.v+=v;else parts.push({t:'lit',v,q:lq});};
  for(;;){
   if(this.i>=this.s.length)this.fail('bad substitution: missing "}"');const c=this.c;
   if(stops.includes(c))return parts;
   if(c==='\\'){const n=this.s[this.i+1];lit(n,1);this.i+=2;continue;}
   if(c==="'"&&!q){const end=this.s.indexOf("'",this.i+1);if(end<0)this.fail('unterminated quoted string');lit(this.s.slice(this.i+1,end),1);this.i=end+1;continue;}
   if(c==='"'&&!q){this.i++;parts.push(...this.doubleQuoted());continue;}
   if(c==='$'||c==='`'){parts.push(this.dollar(q));continue;}
   lit(c,q?2:0);this.i++;
  }
 }
}
/** Words of a here-string or other text with $ expansions but no word splitting: the shell's "…" without the quotes. */
export function parseQuoted(text:string):Word{return new Parser(text).quotedText(false);}
export const isReserved=(word:string)=>RESERVED.has(word);
