import {describe,it,expect} from 'vitest';
import {sh,out} from './helpers';

describe('expansion',()=>{
 it('expands variables, defaults and lengths',async()=>{
  expect(await out('a=hello; b=; echo "$a" ${a}x ${b:-def} ${c-unset} ${#a} ${a:1:3} ${a: -2}')).toBe('hello hellox def unset 5 ell lo\n');
  expect(await out('x=; echo ${x:=set} $x; y=v; echo ${y:+alt} ${z:+alt}.')).toBe('set set\nalt .\n');
 });
 it('removes and replaces patterns',async()=>{
  expect(await out('f=dir/clip.final.mp4; echo ${f%.*} ${f%%.*} ${f#*/} ${f##*.} ${f/clip/shot} ${f//./_}')).toBe('dir/clip.final dir/clip clip.final.mp4 mp4 dir/shot.final.mp4 dir/clip_final_mp4\n');
  expect(await out('s=aXbXc; echo ${s/#a/A} ${s/%c/C} ${s^^} ${s,,}')).toBe('AXbXc aXbXC AXBXC axbxc\n');
 });
 it('splits unquoted expansions into fields and keeps quoted ones whole',async()=>{
  expect(await out('v="a  b c"; for w in $v; do echo "[$w]"; done; for w in "$v"; do echo "[$w]"; done')).toBe('[a]\n[b]\n[c]\n[a  b c]\n');
  expect(await out('IFS=,; v="x,y,,z"; for w in $v; do echo "[$w]"; done')).toBe('[x]\n[y]\n[]\n[z]\n');
 });
 it('expands "$@" to separate words and $* to one',async()=>{
  expect(await out('set -- "a b" c; for x in "$@"; do echo "<$x>"; done; echo "$*" $#')).toBe('<a b>\n<c>\na b c 2\n');
  expect(await out('set --; for x in "$@"; do echo no; done; echo done')).toBe('done\n');
 });
 it('runs command substitution and keeps its status',async()=>{
  expect(await out('x=$(echo hi; echo there); echo "$x"; y=`echo back`; echo $y')).toBe('hi\nthere\nback\n');
  expect(await out('x=$(false); echo $?; echo $(echo a | tr a b)')).toBe('1\nb\n');
 });
 it('does arithmetic',async()=>{
  expect(await out('i=5; echo $((i*2+1)) $((10/3)) $((10%3)) $((2**10)) $((i>3?1:0)) $((0x10)) $((1<<4))')).toBe('11 3 1 1024 1 16 16\n');
  expect(await out('n=0; n=$((n+1)); ((n+=2)); let n++; echo $n')).toBe('4\n');
 });
 it('expands braces, tildes and globs',async()=>{
  expect(await out('echo {a,b}{1,2} x{1..3} {03..1}')).toBe('a1 a2 b1 b2 x1 x2 x3 03 02 01\n');
  expect(await out('echo ~ ~/f')).toBe('/w /w/f\n');
  expect(await out('echo *.mp4 sub/*.txt "*.mp4" nomatch*',{'a.mp4':'','b.mp4':'','c.mov':'','sub/n.txt':'','.hidden.mp4':''})).toBe('a.mp4 b.mp4 sub/n.txt *.mp4 nomatch*\n');
  expect(await out('echo [ab].mp4 ?.mov',{'a.mp4':'','b.mp4':'','c.mov':''})).toBe('a.mp4 b.mp4 c.mov\n');
 });
 it('treats quoted and escaped characters literally',async()=>{
  expect(await out(`echo '$HOME' "\\$HOME" \\* "a\\"b" 'it'"'"'s'`,{'x':''})).toBe('$HOME $HOME * a"b it\'s\n');
 });
});
describe('redirects and pipes',()=>{
 it('writes, appends and reads files',async()=>{
  const r=await sh('echo one > f.txt; echo two >> f.txt; cat < f.txt; wc -l < f.txt');expect(r.out).toBe('one\ntwo\n2\n');expect(r.read('f.txt')).toBe('one\ntwo\n');
 });
 it('sends stderr where asked',async()=>{
  const r=await sh('ls missing 2> err.txt; echo "[$(cat err.txt)]"; ls missing 2>&1 | wc -l; ls missing &> both.txt; cat both.txt | grep -c missing; ls missing 2>/dev/null; echo $?');
  expect(r.out).toBe("[ls: cannot access 'missing': No such file or directory]\n1\n1\n2\n");expect(r.err).toBe('');
 });
 it('keeps the order of 2>&1 >file like a shell',async()=>{const r=await sh('ls missing 2>&1 >/dev/null');expect(r.out).toContain('missing');});
 it('feeds here-documents and here-strings',async()=>{
  expect(await out('name=Roux; cat <<EOF\nHi $name\n$(echo sub)\nEOF\ncat <<\'RAW\'\n$name\nRAW\ntr a-z A-Z <<< "here"')).toBe('Hi Roux\nsub\n$name\nHERE\n');
 });
 it('writes a script with a here-document and runs it',async()=>{
  const r=await sh("cat > run.sh <<'EOF'\n#!/bin/sh\necho \"args: $1 $2\"\nexit 3\nEOF\nsh run.sh a b; echo status $?; ./run.sh c; echo $?");
  expect(r.out).toBe('args: a b\nstatus 3\nargs: c \n3\n');
 });
 it('pipes many stages and stops writers when the reader leaves',async()=>{
  expect(await out('seq 1 100000 | head -3 | tr "\\n" " "')).toBe('1 2 3 ');
  expect(await out('yes | head -2')).toBe('y\ny\n');
  expect(await out('printf "b\\na\\nb\\n" | sort | uniq -c | sort -rn | head -1')).toBe('      2 b\n');
 });
 it('reports pipeline status, pipefail and !',async()=>{
  expect(await out('false | true; echo $?; set -o pipefail; false | true; echo $?; ! false; echo $?')).toBe('0\n1\n0\n');
 });
 it('fails on a redirect it cannot open and goes on',async()=>{
  const r=await sh('echo x > nodir/f; echo $?; cat < nope; echo $?');expect(r.out).toBe('1\n1\n');expect(r.err).toContain("can't create nodir/f: nonexistent directory");expect(r.err).toContain("can't open 'nope'");
 });
 it('keeps redirects from exec for the rest of the script',async()=>{
  const r=await sh('exec > log.txt 2>&1; echo inside; ls nothing; exec >&-; echo gone');expect(r.read('log.txt')).toContain('inside\n');expect(r.read('log.txt')).toContain('nothing');expect(r.out).toBe('');
 });
});
describe('control flow',()=>{
 it('runs if, loops, case and functions',async()=>{
  expect(await out(`
for f in a b c; do
  if [ "$f" = b ]; then continue; fi
  echo "$f"
done
i=0; while [ $i -lt 3 ]; do i=$((i+1)); done; echo $i
until [ $i -eq 0 ]; do i=$((i-1)); done; echo $i
for x in clip.mp4 song.mp3 notes; do case $x in *.mp4|*.mov) echo video;; *.mp3) echo audio;; *) echo other;; esac; done
greet() { local who=$1; echo "hi $who"; return 4; }
greet Roux; echo $? "[$who]"
for ((k=0;k<3;k++)); do printf "%d" $k; done; echo
`)).toBe('a\nc\n3\n0\nvideo\naudio\nother\nhi Roux\n4 []\n012\n');
 });
 it('breaks out of nested loops',async()=>{expect(await out('for a in 1 2; do for b in 1 2; do [ $b = 2 ] && break 2; echo $a$b; done; done')).toBe('11\n');});
 it('reads lines with while read',async()=>{
  expect(await out('while IFS=, read -r name n; do echo "$name=$n"; done < list.csv',{'list.csv':'a,1\nb,2\nc,3'})).toBe('a=1\nb=2\nc=3\n');
  expect(await out('printf "x y z\\n" | { read a rest; echo "$a|$rest"; }')).toBe('x|y z\n');
 });
 it('evaluates [[ ]] with patterns, regexes and logic',async()=>{
  expect(await out('f=clip.MP4; [[ $f == *.MP4 && -n $f ]] && echo yes; [[ $f =~ ^c(l)ip ]] && echo "${BASH_REMATCH}"; [[ ! -f nope || 1 -eq 2 ]] && echo ok')).toBe('yes\nclip\nok\n');
 });
 it('isolates subshells and pipeline stages',async()=>{expect(await out('x=1; (x=2; cd /tmp); echo $x $PWD; echo z | read y; echo "[$y]"')).toBe('1 /w\n[]\n');});
 it('changes folders with cd and resolves relative paths there',async()=>{
  const r=await sh('mkdir -p a/b; cd a/b; echo hi > f; pwd; cd -; cd ..; pwd; cat /w/a/b/f; cd nowhere; echo $?');
  expect(r.out).toBe('/w/a/b\n/w\n/\nhi\n1\n');expect(r.err).toContain("can't cd to nowhere");
 });
 it('stops on errors with set -e but not in conditions',async()=>{
  const r=await sh('set -e; if false; then :; fi; false || true; false && true; echo before; false; echo after');expect(r.out).toBe('before\n');expect(r.status).toBe(1);
 });
 it('exits with the given status and runs the EXIT trap',async()=>{
  const r=await sh('trap "echo cleanup" EXIT; echo work; exit 7; echo never');expect(r.out).toBe('work\ncleanup\n');expect(r.status).toBe(7);
 });
 it('runs background jobs and waits for them',async()=>{expect(await out('(sleep 0.05; echo late) & echo early; wait; echo end')).toBe('early\nlate\nend\n');});
 it('evals, sources and exports',async()=>{
  const r=await sh('echo "V=sourced" > env.sh; . ./env.sh; echo $V; eval "W=\\$V-2"; echo $W; export E=1; sh -c \'echo "child $E $V"\'');
  expect(r.out).toBe('sourced\nsourced-2\nchild 1 \n');
 });
 it('answers unknown programs with what is available',async()=>{
  const r=await sh('magicprog --x; echo $?; npm install x; echo $?');
  expect(r.out).toBe('127\n127\n');expect(r.err).toMatch(/magicprog: not found\. .*available: .*awk.*grep.*sed/s);expect(r.err).toContain('npm is not available in the browser sandbox');
 });
 it('reports syntax errors as status 2',async()=>{const r=await sh('if true; then');expect(r.status).toBe(2);expect(r.err).toMatch(/syntax error/);});
 it('runs set -x traces and ${x:?} errors',async()=>{
  const r=await sh('set -x; echo hi');expect(r.err).toBe('+ echo hi\n');
  const e=await sh('echo ${missing:?need it}; echo after');expect(e.status).toBe(1);expect(e.err).toContain('missing: need it');expect(e.out).toBe('');
 });
 it('runs the type and command -v builtins',async()=>{expect(await out('command -v cd; command -v grep; type echo; f(){ :; }; type f')).toBe('cd\n/usr/bin/grep\necho is a shell builtin\nf is a function\n');});
});
