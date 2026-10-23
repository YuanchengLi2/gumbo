import {describe,it,expect} from 'vitest';
import {MemoryFS} from '../src/fs/memory';
import {Sandbox,type ProcessResult} from '../src/sandbox';
import {python,pip,PYODIDE_VERSION} from '../src/programs/python';
import {decode} from '../src/fs/util';
import pkg from '../package.json' with {type:'json'};

/** Pyodide runs under Node too, so the file bridge and the driver are checked here; the browser test covers the worker. */
describe('python (Pyodide under Node)',()=>{
 const fs=new MemoryFS({'workspace/data.csv':'a,1\nb,2\n','workspace/lib/helper.py':'def double(x):\n    return 2 * x\n'});
 const sandbox=new Sandbox(fs,{programs:{python,python3:python,pip,pip3:pip}});
 const run=async(command:string)=>(await sandbox.runCommand({command,timeoutMs:120000})).process as ProcessResult;
 it('pins the Pyodide version the CDN folder is named after',()=>{expect(pkg.dependencies.pyodide).toBe(PYODIDE_VERSION);});
 it('runs -c and reports the version without loading',async()=>{
  expect((await run('python3 --version')).output).toBe('Python 3.14.2\n');
  const r=await run('python3 -c "import sys; print(sum(range(10)), sys.version_info[:2], sys.argv)" x y');
  expect(r.output).toBe("45 (3, 14) ['-c', 'x', 'y']\n");expect(r.status).toBe('complete');
 },120000);
 it('reads and writes the sandbox files from Python, in the command folder',async()=>{
  const r=await run(`mkdir -p out && python3 -c "
import csv, os
rows = list(csv.reader(open('data.csv')))
os.makedirs('out/deep', exist_ok=True)
with open('out/deep/total.txt', 'w') as f: f.write(str(sum(int(n) for _, n in rows)))
print(os.getcwd(), sorted(os.listdir('out')))
" && cat out/deep/total.txt`);
  expect(r.output).toBe("/workspace ['deep']\n3");expect(decode(fs.readFile('/workspace/out/deep/total.txt'))).toBe('3');
 });
 it('runs script files with arguments, imports workspace modules and rereads them after edits',async()=>{
  fs.writeFile('/workspace/lib/main.py',new TextEncoder().encode('import sys\nfrom helper import double\nprint(double(int(sys.argv[1])), __name__)\n'));
  expect((await run('python3 lib/main.py 21')).output).toBe('42 __main__\n');
  fs.writeFile('/workspace/lib/helper.py',new TextEncoder().encode('def double(x):\n    return 3 * x\n'));
  expect((await run('python3 lib/main.py 21')).output).toBe('63 __main__\n');
 });
 it('takes stdin, here-documents and pipes',async()=>{
  expect((await run('printf "3\\n4\\n" | python3 -c "import sys; print(sum(int(l) for l in sys.stdin))"')).output).toBe('7\n');
  expect((await run("python3 - <<'EOF'\nprint('from heredoc')\nEOF")).output).toBe('from heredoc\n');
  expect((await run('python3 -c "print(\'a\\nb\')" | wc -l')).output).toBe('2\n');
 });
 it('returns exit codes and clean tracebacks',async()=>{
  const exit=await run('python3 -c "import sys; sys.exit(3)"');expect(exit).toMatchObject({status:'failed',exitCode:3});
  const err=await run('python3 -c "1/0"');expect(err.exitCode).toBe(1);
  expect(err.output).toBe('Traceback (most recent call last):\n  File "<string>", line 1, in <module>\nZeroDivisionError: division by zero\n');
  expect((await run('python3 missing.py')).output).toContain("can't open file '/workspace/missing.py'");
 });
 it('keeps environment variables and the folder per command',async()=>{
  expect((await run('mkdir -p sub && cd sub && FOO=bar python3 -c "import os; print(os.environ[\'FOO\'], os.getcwd())"')).output).toBe('bar /workspace/sub\n');
  expect((await run('python3 -c "import os; print(os.environ.get(\'FOO\'), os.getcwd())"')).output).toBe('None /workspace\n');
 });
 it('lists packages with pip',async()=>{const r=await run('pip list');expect(r.status).toBe('complete');expect(r.output).toContain('micropip');},120000);
});
