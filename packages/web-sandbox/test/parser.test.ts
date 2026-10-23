import {describe,it,expect} from 'vitest';
import {parse,ShellSyntaxError} from '../src/shell/parser';

const simple=(src:string)=>{const list=parse(src) as any;return list.items[0].node;};
const text=(word:any[])=>word.map(p=>p.t==='lit'?p.v:`<${p.t}:${p.name??p.src}>`).join('');
describe('shell parser',()=>{
 it('splits words and keeps quoting',()=>{
  const n=simple(`echo 'a b' "c $d" e\\ f`);
  expect(n.type).toBe('simple');expect(n.words.map(text)).toEqual(['echo','a b','c <param:d>','e f']);
  expect(n.words[1][0].q).toBe(1);expect(n.words[2][0].q).toBe(2);
 });
 it('reads pipelines, and-or lists, sequences and background jobs',()=>{
  const list=parse('a | b | c && d || e; f & g') as any;
  expect(list.items.map((i:any)=>i.background)).toEqual([false,true,false]);
  const andor=list.items[0].node;expect(andor.type).toBe('andor');expect(andor.first.type).toBe('pipeline');expect(andor.first.commands).toHaveLength(3);
  expect(andor.rest.map((r:any)=>r.op)).toEqual(['&&','||']);
 });
 it('reads redirects with descriptors, duplication and here-strings',()=>{
  const n=simple('cmd <in >out 2>>log 2>&1 &>both <<<word');
  expect(n.redirects.map((r:any)=>[r.fd,r.op,text(r.target)])).toEqual([[0,'<','in'],[1,'>','out'],[2,'>>','log'],[2,'>&','1'],[1,'&>','both'],[0,'<<<','word']]);
 });
 it('reads here-documents, quoted and unquoted, with <<- tab stripping',()=>{
  const list=parse("cat <<EOF >a\nhi $x\nEOF\ncat <<'END'\n$y\nEND\ncat <<-T\n\tz\n\tT\n") as any;
  const [a,b,c]=list.items.map((i:any)=>i.node.redirects[0]);
  expect(text(a.heredoc)).toBe('hi <param:x>\n');expect(text(b.heredoc)).toBe('$y\n');expect(text(c.heredoc)).toBe('z\n');
 });
 it('reads assignments before a command and alone',()=>{
  const n=simple('A=1 B="x y" cmd C=2');expect(n.assigns.map((a:any)=>[a.name,text(a.value)])).toEqual([['A','1'],['B','x y']]);expect(n.words.map(text)).toEqual(['cmd','C=2']);
  expect(simple('X+=more').assigns[0].name).toBe('X+');
 });
 it('reads parameter expansions with operators',()=>{
  const w=simple('echo ${a:-def} ${#b} ${c%.mp4} ${d//x/y} ${e:1:2} ${!f}').words.slice(1).map((w:any)=>w[0]);
  expect(w.map((p:any)=>p.op)).toEqual([':-','length','%','//','substr','indirect']);
  expect(text(w[0].arg)).toBe('def');expect(text(w[3].arg)).toBe('x');expect(text(w[3].arg2)).toBe('y');
 });
 it('reads command and arithmetic substitution, nested',()=>{
  const n=simple('echo $(echo $(date) ")") `ls` $((1 + (2*3)))');
  expect(n.words[1][0]).toMatchObject({t:'cmd',src:'echo $(date) ")"'});expect(n.words[2][0]).toMatchObject({t:'cmd',src:'ls'});expect(n.words[3][0]).toMatchObject({t:'arith',src:'1 + (2*3)'});
 });
 it('reads compound commands',()=>{
  const list=parse(`if a; then b; elif c; then d; else e; fi
for f in *.mp4 x; do echo "$f"; done
while read l; do :; done < file
until false; do break; done
case $x in a|b) one;; *.mp4) two;; *) ;; esac
f() { echo hi; }
function g { :; }
( cd sub && ls )
{ a; b; } > out
[[ -f x && $y == *.png ]]
(( i++ ))
for ((i=0;i<3;i++)); do :; done`) as any;
  expect(list.items.map((i:any)=>i.node.type)).toEqual(['if','for','while','while','case','func','func','subshell','group','test','arith','cfor']);
  expect(list.items[0].node.clauses).toHaveLength(2);expect(list.items[4].node.arms[0].patterns).toHaveLength(2);expect(list.items[2].node.redirects[0].op).toBe('<');
  expect(list.items[9].node.words.map(text)).toEqual(['-f','x','&&','<param:y>','==','*.png']);
 });
 it('treats # as a comment only at the start of a word',()=>{expect(simple('echo a#b # gone').words.map(text)).toEqual(['echo','a#b']);});
 it('joins lines ending in a backslash',()=>{expect(simple('echo a \\\n  b').words.map(text)).toEqual(['echo','a','b']);});
 it('reads $\'…\' escapes',()=>{expect(text(simple("echo $'a\\tb\\n'").words[1])).toBe('a\tb\n');});
 it('reports syntax errors with a line',()=>{
  expect(()=>parse('if true; then echo')).toThrow(ShellSyntaxError);
  expect(()=>parse('echo "open')).toThrow(/unterminated/);
  expect(()=>parse('echo a\nfi')).toThrow(/line 2/);
 });
});
