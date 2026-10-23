import {describe,it,expect} from 'vitest';
import {MemoryFS} from '../src/fs/memory';
import {Sandbox,type ProcessResult} from '../src/sandbox';
import {programs} from '../src/programs';
import {esmToRequires} from '../src/programs/node';
import {decode} from '../src/fs/util';
import pkg from '../package.json' with {type:'json'};
import {ESBUILD_VERSION} from '../src/programs/esbuild';
import {FFMPEG_CORE_VERSION} from '../src/programs/ffmpeg';

const files={
 'workspace/src/main.ts':'import {greet} from "./lib";\nimport {shout} from "tiny-pkg";\nimport note from "./note.txt";\nconst n: number = 2;\nconsole.log(shout(greet("roux")), n * 21, note.trim());\n',
 'workspace/src/lib.ts':'export const greet = (name: string): string => `hi ${name}`;\n',
 'workspace/src/note.txt':'from a text file\n',
 'workspace/node_modules/tiny-pkg/package.json':JSON.stringify({name:'tiny-pkg',exports:{'.':{import:'./esm/index.js',require:'./cjs/index.js'}}}),
 'workspace/node_modules/tiny-pkg/esm/index.js':'export const shout = s => s.toUpperCase();\n',
 'workspace/node_modules/tiny-pkg/cjs/index.js':'exports.shout = s => s.toUpperCase() + "!";\n',
 'workspace/scene.jsx':'const h = (tag, props, ...kids) => `<${tag}>${kids.join("")}</${tag}>`;\nconsole.log(<b>bold</b>);\n'
};
describe('esbuild and node (under Node)',()=>{
 const fs=new MemoryFS(files),sandbox=new Sandbox(fs,{programs});
 const run=async(command:string)=>(await sandbox.runCommand({command,timeoutMs:120000})).process as ProcessResult;
 it('pins the wasm versions the CDN fallbacks use',()=>{expect(pkg.dependencies['esbuild-wasm']).toBe(ESBUILD_VERSION);expect(pkg.dependencies['@ffmpeg/core']).toBe(FFMPEG_CORE_VERSION);expect(pkg.dependencies['@ffmpeg/core-mt']).toBe(FFMPEG_CORE_VERSION);});
 it('bundles TypeScript with relative imports, a package and loaders, then runs the bundle',async()=>{
  const r=await run('esbuild src/main.ts --bundle --format=iife --platform=browser --loader:.txt=text --outfile=out/bundle.js && node out/bundle.js');
  expect(r.output).toMatch(/out\/bundle\.js\s+\d+(\.\d)?(b|kb)\n\n⚡ Done in \d+ms\n/);expect(r.output.endsWith('HI ROUX 42 from a text file\n')).toBe(true);
  expect(decode(fs.readFile('/workspace/out/bundle.js'))).toContain('toUpperCase');
 },120000);
 it('writes to stdout without --outfile, transforms stdin and reports errors',async()=>{
  expect((await run('esbuild scene.jsx --jsx-factory=h | node')).output).toBe('<b>bold</b>\n');
  expect((await run("echo 'let x: number = 1; console.log(x)' | esbuild --loader=ts")).output).toBe('let x = 1;\nconsole.log(x);\n');
  const bad=await run('echo \'import "missing-lib"\' > bad.js && esbuild bad.js --bundle');
  expect(bad.status).toBe('failed');expect(bad.output).toContain('Could not resolve "missing-lib"');expect(bad.output).toContain('npm is not available');
  expect((await run('esbuild --version')).output).toBe(ESBUILD_VERSION+'\n');
 },120000);
 it('runs node -e and -p with argv, env and exit codes',async()=>{
  expect((await run('X=7 node -e "console.log(process.argv.length, process.env.X, [1,{a:2}])" a b')).output).toBe("3 7 [ 1, { a: 2 } ]\n");
  expect((await run('node -p "6*7"')).output).toBe('42\n');
  const exit=await run('node -e "process.exitCode = 3; console.log(\'set\')"');expect(exit).toMatchObject({exitCode:3,output:'set\n'});
  expect((await run('node -e "process.exit(5); console.log(1)"')).exitCode).toBe(5);
  const thrown=await run('node -e "throw new Error(\'boom\')"');expect(thrown.exitCode).toBe(1);expect(thrown.output).toMatch(/Error: boom/);
 });
 it('reads and writes workspace files through fs, path and Buffer',async()=>{
  const r=await run(`node -e "
const fs = require('fs'), path = require('node:path');
fs.mkdirSync('gen/deep', {recursive: true});
fs.writeFileSync(path.join('gen', 'deep', 'a.json'), JSON.stringify({n: 1}));
const data = JSON.parse(fs.readFileSync('gen/deep/a.json', 'utf8'));
console.log(data.n, fs.existsSync('gen/deep'), fs.readdirSync('gen'), Buffer.from('hi').toString('base64'), path.extname('x.mp4'));
" && cat gen/deep/a.json`);
  expect(r.output).toBe("1 true [ 'deep' ] aGk= .mp4\n{\"n\":1}");
 });
 it('waits for timers and promises, and runs ES modules, TypeScript and top-level await',async()=>{
  expect((await run('node -e "setTimeout(() => console.log(\'later\'), 30); console.log(\'now\')"')).output).toBe('now\nlater\n');
  fs.writeFile('/workspace/mod.mjs',new TextEncoder().encode("import {readFileSync} from 'node:fs';\nimport {greet} from './src/lib.ts';\nconst text = readFileSync('src/note.txt', 'utf8');\nawait new Promise(r => setTimeout(r, 10));\nconsole.log(greet('esm'), text.length);\n"));
  expect((await run('node mod.mjs')).output).toBe('hi esm 17\n');
  fs.writeFile('/workspace/t.ts',new TextEncoder().encode("const {shout} = require('tiny-pkg');\ninterface P { n: number }\nconst p: P = {n: 4};\nconsole.log(shout('ts'), p.n);\n"));
  expect((await run('node t.ts && npx tsx t.ts')).output).toBe('TS! 4\nTS! 4\n');
 },120000);
 it('reads stdin and runs shell commands with child_process.exec',async()=>{
  expect((await run('printf "a\\nb\\n" | node -e "console.log(require(\'fs\').readFileSync(0, \'utf8\').split(\'\\n\').filter(Boolean).length)"')).output).toBe('2\n');
  expect((await run('node -e "require(\'child_process\').exec(\'echo from-shell | tr a-z A-Z\', (e, out) => console.log(e, out.trim()))"')).output).toBe('null FROM-SHELL\n');
  const sync=await run('node -e "require(\'child_process\').execSync(\'ls\')"');expect(sync.exitCode).toBe(1);expect(sync.output).toContain('execSync is not available in the browser sandbox');
 });
 it('turns esbuild ES module output into requires',()=>{
  expect(esmToRequires('import fs from "fs";\nimport * as path from "path";\nimport { a, b as c } from "./x";\nimport "./side";\nexport const y = 1;\nexport default y;')).toBe('const __m0 = require("fs"); const fs = __m0 && __m0.__esModule ? __m0.default : __m0;\nconst path = require("path");\nconst { a, b: c } = require("./x");\nrequire("./side");\nconst y = 1;\nmodule.exports.default = y;');
 });
});
