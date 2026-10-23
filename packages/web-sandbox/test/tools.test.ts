import {describe,it,expect} from 'vitest';
import {sh,out} from './helpers';
import {unixTools} from '../src/tools';

const lines='alpha 3\nbeta 10\ngamma 2\nalpha 7\n';
const csv='name,dur,kind\nintro.mp4,4.5,video\nsong.mp3,180,audio\nb-roll.mov,12,video\n';

describe('the desktop tool list',()=>{
 it('has every tool BusyBox gave Roux on the desktop',()=>{
  const desktop=['awk','basename','cat','cut','diff','dirname','du','env','expr','find','grep','gunzip','gzip','head','ls','md5sum','mkdir','mktemp','mv','cp','printf','readlink','realpath','rm','sed','seq','sh','sha256sum','sleep','sort','stat','tail','tar','tee','touch','tr','uniq','unzip','wc','wget','which','xargs'];
  expect(desktop.filter(t=>!(t in unixTools))).toEqual([]);
 });
});
describe('text tools',()=>{
 it('cat joins files and numbers lines',async()=>{expect(await out('cat a b; cat -n a',{a:'1\n',b:'2\n'})).toBe('1\n2\n     1\t1\n');expect((await sh('cat nope')).err).toBe('cat: nope: No such file or directory\n');});
 it('head and tail take lines and bytes',async()=>{
  const f={'f':Array.from({length:20},(_,i)=>`l${i+1}`).join('\n')+'\n'};
  expect(await out('head -n 2 f; head -3 f | tail -1; tail -n 2 f; tail -n +19 f; head -c 5 f; echo; tail -c 4 f; head -n -18 f',f)).toBe('l1\nl2\nl3\nl19\nl20\nl19\nl20\nl1\nl2\nl20\nl1\nl2\n');
 });
 it('wc counts lines, words and bytes',async()=>{expect(await out('wc -l f; wc -w < f; wc f; wc -c f g',{f:'a b\nc\n',g:'xyz'})).toBe('2 f\n3\n2 3 6 f\n6 f\n3 g\n9 total\n');});
 it('sort sorts by keys, numbers and uniqueness',async()=>{
  expect(await out('sort f',{f:lines})).toBe('alpha 3\nalpha 7\nbeta 10\ngamma 2\n');
  expect(await out('sort -k2 -n f',{f:lines})).toBe('gamma 2\nalpha 3\nalpha 7\nbeta 10\n');
  expect(await out('sort -k2,2nr f | head -1',{f:lines})).toBe('beta 10\n');
  expect(await out('sort -t, -k2 -g f | cut -d, -f1',{f:csv.split('\n').slice(1).join('\n')})).toBe('intro.mp4\nb-roll.mov\nsong.mp3\n');
  expect(await out('printf "b\\na\\nb\\n" | sort -u; printf "10\\n9\\n1K\\n" | sort -h; printf "v1.10\\nv1.9\\n" | sort -V')).toBe('a\nb\n9\n10\n1K\nv1.9\nv1.10\n');
  expect(await out('cut -d" " -f1 f | sort | uniq -c | sort -k1nr -k2',{f:lines})).toBe('      2 alpha\n      1 beta\n      1 gamma\n');
 });
 it('uniq counts, keeps repeats or uniques',async()=>{expect(await out('uniq -c f; uniq -d f; uniq -u f; uniq -i f',{f:'a\na\nb\nA\n'})).toBe('      2 a\n      1 b\n      1 A\na\nb\nA\na\nb\nA\n');expect(await out('uniq -ic f',{f:'a\nA\nb\n'})).toBe('      2 a\n      1 b\n');});
 it('cut takes fields, characters and complements',async()=>{expect(await out('cut -d, -f1,3 f | head -2; cut -c1-3 f | tail -1; cut -d, -f2- --complement f | head -1',{f:csv})).toBe('name,kind\nintro.mp4,video\nb-r\nname\n');});
 it('tr maps, deletes and squeezes',async()=>{expect(await out('echo "Hello  World" | tr a-z A-Z; echo hello | tr -d l; echo "a   b" | tr -s " "; echo "a1b2" | tr -cd "[:digit:]\\n"; echo "x y" | tr " " "\\n"')).toBe('HELLO  WORLD\nheo\na b\n12\nx\ny\n');});
 it('tee writes to files and stdout',async()=>{const r=await sh('echo hi | tee a b; echo more | tee -a a > /dev/null');expect(r.out).toBe('hi\n');expect(r.read('a')).toBe('hi\nmore\n');expect(r.read('b')).toBe('hi\n');});
 it('printf formats like C and reuses its format',async()=>{
  expect(await out('printf "%s=%d|%5.2f|%-4s|%04d|%x|%e|%g\\n" a 42 3.14159 ab 7 255 12345.678 0.0001')).toBe('a=42| 3.14|ab  |0007|ff|1.234568e+04|0.0001\n');
  expect(await out("printf '%s\\n' one two three; printf '%c%%\\n' x; printf '%b' 'a\\tb\\n'")).toBe('one\ntwo\nthree\nx%\na\tb\n');
  expect(await out('printf "%05.1f %s\\n" 2.25 x 10 y')).toBe('002.2 x\n010.0 y\n');
 });
 it('seq counts with steps, widths and separators',async()=>{expect(await out('seq 3; seq 2 2 6; seq -w 8 10; seq -s, 1 3; seq 0.5 0.5 1.5; seq 3 -1 1 | tr "\\n" " "')).toBe('1\n2\n3\n2\n4\n6\n08\n09\n10\n1,2,3\n0.5\n1.0\n1.5\n3 2 1 ');});
 it('expr computes and matches',async()=>{expect(await out('expr 2 + 3 \\* 4; expr length hello; expr substr hello 2 3; expr index hello l; expr "clip_12.mp4" : "clip_\\([0-9]*\\)"; expr 5 \\> 3')).toBe('14\n5\nell\n3\n12\n1\n');const r=await sh('expr 0');expect(r.status).toBe(1);});
 it('rev, nl, paste and base64',async()=>{expect(await out('echo abc | rev; printf "a\\n\\nb\\n" | nl; paste -d, f g; echo hi | base64; echo aGkK | base64 -d',{f:'1\n2\n',g:'x\ny\n'})).toBe('cba\n     1\ta\n       \n     2\tb\n1,x\n2,y\naGkK\nhi\n');});
});
describe('grep',()=>{
 const f={'log.txt':'INFO start\nWARN low disk\nERROR failed: clip.mp4\nINFO done\nerror again\n','sub/a.js':'const x = 1;\n// TODO fix\n','sub/b.ts':'let todo = 2\n'};
 it('matches basic, extended, fixed and case-insensitive patterns',async()=>{
  expect(await out('grep ERROR log.txt; grep -i error log.txt | wc -l; grep -E "WARN|ERROR" log.txt | wc -l; grep -F "clip.mp4" log.txt; grep -c INFO log.txt',f)).toBe('ERROR failed: clip.mp4\n2\n2\nERROR failed: clip.mp4\n2\n');
  expect(await out("grep 'in\\(fo\\|it\\)' -i log.txt | wc -l; grep -w done log.txt; grep -x 'INFO done' log.txt; grep -v INFO log.txt | head -1",f)).toBe('2\nINFO done\nINFO done\nWARN low disk\n');
 });
 it('numbers lines, prints only matches and context',async()=>{
  expect(await out("grep -n WARN log.txt; grep -o '[a-z]*\\.mp4' log.txt; grep -A1 WARN log.txt; grep -B1 -n done log.txt",f)).toBe('2:WARN low disk\nclip.mp4\nWARN low disk\nERROR failed: clip.mp4\n3-ERROR failed: clip.mp4\n4:INFO done\n');
 });
 it('searches folders recursively with include filters and lists files',async()=>{
  expect(await out('grep -rn TODO sub; grep -rli todo . | sort; grep -rl todo --include="*.ts"; grep -rh again',f)).toBe('sub/a.js:2:// TODO fix\n./sub/a.js\n./sub/b.ts\nsub/b.ts\nerror again\n');
 });
 it('exits 1 when nothing matches and 2 on errors; -q is silent',async()=>{
  expect((await sh('grep nothing log.txt',f)).status).toBe(1);expect((await sh('grep x missing.txt',f)).status).toBe(2);
  const q=await sh('grep -q ERROR log.txt && echo found',f);expect(q.out).toBe('found\n');
  expect(await out('grep -e INFO -e WARN log.txt | wc -l; echo "a.b" | grep -c "a\\.b"; grep -m1 INFO log.txt',f)).toBe('3\n1\nINFO start\n');
 });
});
describe('sed',()=>{
 it('substitutes with flags, groups and other delimiters',async()=>{
  expect(await out("echo 'hello world' | sed 's/o/0/'; echo 'hello world' | sed 's/o/0/g'; echo 'a-b-c' | sed 's/-/+/2'; echo 'clip_01.mp4' | sed -E 's/clip_([0-9]+)\\.mp4/shot \\1/'; echo /a/b | sed 's|/|:|g'; echo abc | sed 's/b/[&]/'")).toBe('hell0 world\nhell0 w0rld\na-b+c\nshot 01\n:a:b\na[b]c\n');
  expect(await out("echo 'x' | sed 's/x/a\\nb/'; echo 'Ab' | sed 's/.*/\\U&/'; echo HELLO | sed 's/HELLO/hello/I'")).toBe('a\nb\nAB\nhello\n');
 });
 it('selects lines by number, range, regex and $',async()=>{
  const f={'f':'one\ntwo\nthree\nfour\nfive\n'};
  expect(await out("sed -n '2p' f; sed -n '2,3p' f; sed -n '/three/,$p' f; sed '1d;$d' f; sed -n '$=' f; sed '2q' f; sed -n '/t/!p' f",f)).toBe('two\ntwo\nthree\nthree\nfour\nfive\ntwo\nthree\nfour\n5\none\ntwo\none\nfour\nfive\n');
  expect(await out("sed -n '1~2p' f; sed '3,+1d' f",f)).toBe('one\nthree\nfive\none\ntwo\nfive\n');
 });
 it('appends, inserts, changes, translates and uses the hold space',async()=>{
  const f={'f':'a\nb\nc\n'};
  expect(await out("sed '2a\\\nafter' f; sed '1i before' f | head -2; sed '2c changed' f; echo abc | sed 'y/abc/xyz/'; sed -n '1!G;h;$p' f; sed '$!N;s/\\n/ /' f",f)).toBe('a\nb\nafter\nc\nbefore\na\na\nchanged\nc\nxyz\nc\nb\na\na b\nc\n');
 });
 it('runs blocks, labels and several scripts',async()=>{
  expect(await out("printf 'k=1\\nx\\nk=2\\n' | sed -n '/^k=/{s/k=//;p}'; echo aaa | sed ':a;s/a/b/;ta'; echo hi | sed -e 's/h/H/' -e 's/i/I/'")).toBe('1\n2\nbbb\nHI\n');
 });
 it('edits files in place, with a backup',async()=>{
  const r=await sh("sed -i 's/old/new/g' a.txt; sed -i.bak 's/1/2/' b.txt; cat a.txt b.txt b.txt.bak",{'a.txt':'old old\n','b.txt':'v1\n'});
  expect(r.out).toBe('new new\nv2\nv1\n');
 });
});
describe('awk',()=>{
 it('prints fields with separators and patterns',async()=>{
  expect(await out("awk '{print $1}' f | head -2; awk -F, 'NR>1 {print $1\" \"$2}' c; awk '$2 > 5' f; awk -F, -v OFS=';' '{$1=$1; print}' c | head -1",{f:lines,c:csv})).toBe('alpha\nbeta\nintro.mp4 4.5\nsong.mp3 180\nb-roll.mov 12\nbeta 10\nalpha 7\nname;dur;kind\n');
 });
 it('sums, counts with arrays and runs BEGIN and END',async()=>{
  expect(await out("awk '{s+=$2} END {print s, NR, s/NR}' f; awk '{c[$1]+=$2} END {for (k in c) print k, c[k]}' f | sort; awk 'BEGIN {x=2; y=x^3; print y, 7%3, int(7/2), length(\"abc\")}'",{f:lines})).toBe('22 4 5.5\nalpha 10\nbeta 10\ngamma 2\n8 1 3 3\n');
 });
 it('formats with printf and sprintf and uses string functions',async()=>{
  expect(await out("awk -F, 'NR>1 {printf \"%-10s %6.2f\\n\", $1, $2}' c; awk 'BEGIN {s=sprintf(\"%03d\", 7); print s, toupper(\"ab\"), substr(\"hello\", 2, 3), index(\"hello\",\"l\")}'",{c:csv})).toBe('intro.mp4    4.50\nsong.mp3   180.00\nb-roll.mov  12.00\n007 AB ell 3\n');
  expect(await out("awk 'BEGIN {s=\"a.b.c\"; n=split(s, p, \".\"); print n, p[3]; t=\"foo bar foo\"; gsub(/foo/, \"baz\", t); print t; u=\"x\"; sub(/x/, \"[&]\", u); print u; if (match(\"abc123\", /[0-9]+/)) print RSTART, RLENGTH}'")).toBe('3 c\nbaz bar baz\n[x]\n4 3\n');
 });
 it('handles ranges, next, NF, getline, functions and output files',async()=>{
  const r=await sh(`awk '/beta/,/gamma/' f; awk 'NR==2 {next} {print NR}' f; echo "a b c" | awk '{print NF, $NF, $(NF-1)}'; awk 'function sq(x) {return x*x} BEGIN {print sq(4)}'; awk '{print $1 > "out.txt"}' f; awk 'BEGIN {while ((getline line < "f") > 0) n++; print n}'; echo x | awk '{ "echo sub" | getline v; print v }'`,{f:lines});
  expect(r.out).toBe('beta 10\ngamma 2\n1\n3\n4\n3 c b\n16\n4\nsub\n');expect(r.read('out.txt')).toBe('alpha\nbeta\ngamma\nalpha\n');
 });
 it('compares numbers numerically and strings as strings',async()=>{
  expect(await out("printf '10\\n9\\nabc\\n' | awk '$1 > 5 {print}'; awk 'BEGIN {print (\"10\" < \"9\"), (10 < 9), 1e3, 0.1+0.2, -3 % 2}'")).toBe('10\n9\nabc\n1 0 1000 0.3 -1\n');
 });
 it('reads a program file and reports syntax errors',async()=>{
  expect(await out("awk -f prog.awk f",{f:lines,'prog.awk':'{ total += $2 }\nEND {\n  print "total", total\n}\n'})).toBe('total 22\n');
  const r=await sh("awk '{print $1' f",{f:lines});expect(r.status).toBe(2);expect(r.err).toMatch(/awk: syntax error/);
 });
});
describe('file tools',()=>{
 const tree={'a.mp4':'xx','b.txt':'hello\n','media/c.mov':'yyy','media/deep/d.png':'z','.hidden':''};
 it('ls lists names, long details and folders',async()=>{
  expect(await out('ls; ls -a | head -3; ls media; ls -d media; ls -1 -R media',tree)).toBe('a.mp4\nb.txt\nmedia\n.\n..\n.hidden\nc.mov\ndeep\nmedia\nmedia:\nc.mov\ndeep\n\nmedia/deep:\nd.png\n');
  const long=await out('ls -l b.txt; ls -lh a.mp4',tree);expect(long).toMatch(/^-rw-r--r-- 1 user user\s+6 \w{3} .. ..:.. b\.txt\n/);
  expect((await sh('ls nothing',tree)).status).toBe(2);
 });
 it('find matches names, types, depth, sizes and runs commands',async()=>{
  expect(await out('find . -name "*.mov"; find media -type d; find . -maxdepth 1 -type f | sort; find . -path "*deep*" -name "*.png"; find . -size +2c -type f',tree)).toBe('./media/c.mov\nmedia\nmedia/deep\n./.hidden\n./a.mp4\n./b.txt\n./media/deep/d.png\n./b.txt\n./media/c.mov\n');
  expect(await out('find . -name "*.txt" -exec cat {} \\;; find . \\( -name "*.mp4" -o -name "*.png" \\) | sort; find . -type f -name "*.mov" -exec echo got {} +; find media -mindepth 1 -printf "%f %s\\n" | sort; find . -empty',tree)).toBe('hello\n./a.mp4\n./media/deep/d.png\ngot ./media/c.mov\nc.mov 3\nd.png 1\ndeep 4096\n./.hidden\n');
  const r=await sh('find . -name "*.mov" -delete; ls media',tree);expect(r.out).toBe('deep\n');
 });
 it('cp, mv, rm, mkdir, rmdir and touch change the tree',async()=>{
  const r=await sh('mkdir -p out/x; cp a.mp4 out/; cp -r media out/m; mv b.txt out/renamed.txt; touch out/new; rm out/x -r; mkdir e; rmdir e; ls -R out; ls b.txt',tree);
  expect(r.out).toBe('out:\na.mp4\nm\nnew\nrenamed.txt\n\nout/m:\nc.mov\ndeep\n\nout/m/deep:\nd.png\n');expect(r.err).toContain("cannot access 'b.txt'");
  const e=await sh('rm media; echo $?; rm -f nope; echo $?; cp media x; echo $?; mkdir a.mp4; echo $?',tree);
  expect(e.out).toBe('1\n0\n1\n1\n');expect(e.err).toContain('Is a directory');expect(e.err).toContain('-r not specified');expect(e.err).toContain('File exists');
 });
 it('basename, dirname, realpath, readlink',async()=>{expect(await out('basename /a/b/clip.mp4 .mp4; basename -s .txt x.txt y.txt; dirname /a/b/c.mp4; dirname file; realpath media/../b.txt; readlink -f ./media',tree)).toBe('clip\nx\ny\n/a/b\n.\n/w/b.txt\n/w/media\n');});
 it('du and stat report sizes',async()=>{
  expect(await out('du -sb media; du -ab media | sort -k2 | head -2; stat -c "%n %s %F" b.txt media',tree)).toBe('4\tmedia\n4\tmedia\n3\tmedia/c.mov\nb.txt 6 regular file\nmedia 4096 directory\n');
 });
 it('mktemp makes unique files and folders',async()=>{const r=await sh('f=$(mktemp); d=$(mktemp -d); test -f "$f" && test -d "$d" && echo ok; mktemp -p . cut.XXXX | grep -c "^./cut\\."');expect(r.out).toBe('ok\n1\n');});
 it('diff shows normal and unified differences',async()=>{
  const f={'a':'one\ntwo\nthree\n','b':'one\n2\nthree\nfour\n'};
  const normal=await sh('diff a b',f);expect(normal.status).toBe(1);expect(normal.out).toBe('2c2\n< two\n---\n> 2\n3a4\n> four\n');
  const unified=await sh('diff -u a b',f);expect(unified.out).toMatch(/^--- a\t.*\n\+\+\+ b\t.*\n@@ -1,3 \+1,4 @@\n one\n-two\n\+2\n three\n\+four\n$/);
  expect((await sh('diff a a',f)).status).toBe(0);expect(await out('diff -q a b || true',f)).toBe('Files a and b differ\n');
 });
});
describe('archives and hashes',()=>{
 it('gzip and gunzip round-trip, to files and stdout',async()=>{
  const r=await sh('gzip -k notes.txt; ls notes.txt*; gunzip -c notes.txt.gz; rm notes.txt; gunzip notes.txt.gz; cat notes.txt; echo data | gzip | gunzip',{'notes.txt':'remember this\n'});
  expect(r.out).toBe('notes.txt\nnotes.txt.gz\nremember this\nremember this\ndata\n');
 });
 it('tar creates, lists and extracts, with gzip and -C',async()=>{
  const r=await sh('tar czf pack.tgz media b.txt; tar tzf pack.tgz | sort; mkdir out; tar -xzf pack.tgz -C out; cat out/b.txt; ls out/media; tar cf - b.txt | tar xOf -',{'b.txt':'bee\n','media/c.mov':'c','media/sub/d':'d'});
  expect(r.out).toBe('b.txt\nmedia/\nmedia/c.mov\nmedia/sub/\nmedia/sub/d\nbee\nc.mov\nsub\nbee\n');
 });
 it('zip and unzip',async()=>{
  const r=await sh('zip -rq pack.zip media; unzip -l pack.zip | grep -c c.mov; mkdir x; unzip -q pack.zip -d x; cat x/media/c.mov; unzip -p pack.zip media/c.mov',{'media/c.mov':'clip'});
  expect(r.out).toBe('1\nclipclip');
 });
 it('md5sum and sha256sum hash and check',async()=>{
  const r=await sh('md5sum f; echo -n abc | sha256sum; sha256sum f > sums; sha256sum -c sums',{f:'abc'});
  expect(r.out).toBe('900150983cd24fb0d6963f7d28e17f72  f\nba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  -\nf: OK\n');
 });
});
describe('system tools',()=>{
 it('env, which and sleep',async()=>{
  expect(await out('A=1 env | grep "^A="; env B=2 sh -c \'echo $B\'; env -i C=3 env; which grep sed; which nothing || echo none; sleep 0.01; echo slept')).toBe('A=1\n2\nC=3\n/usr/bin/grep\n/usr/bin/sed\nnone\nslept\n');
 });
 it('xargs batches, replaces and splits on NUL',async()=>{
  expect(await out('printf "a\\nb\\nc\\n" | xargs echo; printf "a b c d" | xargs -n 2 echo; printf "x\\ny\\n" | xargs -I{} echo "<{}>"; printf "p q\\0r\\0" | xargs -0 -n1 echo; echo "\'quoted arg\' plain" | xargs -n1 echo; printf "" | xargs -r echo nothing')).toBe('a b c\na b\nc d\n<x>\n<y>\np q\nr\nquoted arg\nplain\n');
  const r=await sh('find . -name "*.tmp" | xargs rm; ls',{'a.tmp':'','b.tmp':'','keep':''});expect(r.out).toBe('keep\n');
 });
 it('test and [ check files, strings and numbers',async()=>{
  expect(await out('[ -f f ] && echo file; [ -d f ] || echo notdir; test -s f && echo nonempty; [ "a" != "b" ] && echo ne; [ 10 -gt 9 ] && echo gt; [ -z "" ] && echo empty; [ ! -e none ] && echo absent; [ 1 -eq 1 -a 2 -eq 3 ] || echo and',{f:'x'})).toBe('file\nnotdir\nnonempty\nne\ngt\nempty\nabsent\nand\n');
  expect((await sh('[ 1 -eq')).status).toBe(2);
 });
 it('sh runs scripts and -c strings with arguments',async()=>{
  expect(await out('sh -c \'echo "$0 $1 $#"\' name one; bash -c "exit 4"; echo $?; echo "echo from stdin" | sh; sh -e -c "false; echo no"; echo $?')).toBe('name one 1\n4\nfrom stdin\n1\n');
 });
 it('timeout stops a slow command with 124',async()=>{expect(await out('timeout 0.05 sleep 5; echo $?; timeout 1 echo fast')).toBe('124\nfast\n');});
 it('date formats times',async()=>{expect(await out('date -u -d @0 +%Y-%m-%dT%H:%M:%S; date +%s | grep -c "^[0-9]*$"')).toBe('1970-01-01T00:00:00\n1\n');});
 it('wget and curl fetch through the host and say why a download fails',async()=>{
  const fetch=(async(url:string)=>{if(String(url).includes('blocked'))throw new TypeError('Failed to fetch');return new Response('body of '+new URL(url).pathname,{status:200});}) as typeof globalThis.fetch;
  const r=await sh('wget -q -O page.html https://example.test/a; cat page.html; echo; curl -s https://example.test/b; echo; curl -sS -o f.txt https://example.test/c; cat f.txt; echo; curl -sS https://blocked.test/x; echo $?',{},{fetch});
  expect(r.out).toBe('body of /a\nbody of /b\nbody of /c\n7\n');expect(r.err).toContain('cross-origin');
 });
});
