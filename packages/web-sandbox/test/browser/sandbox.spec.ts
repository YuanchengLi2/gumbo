import {test,expect,type Page} from '@playwright/test';
import {writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from './server';
import type {SandboxClient} from '../../src/client';
import type {ProcessResult,InitResult} from '../../src/index';

type Server=Awaited<ReturnType<typeof startServer>>;
let server:Server,page:Page,init:InitResult;
const timings:Record<string,number>={};
test.describe.configure({mode:'serial'});
test.beforeAll(async({browser})=>{
 server=await startServer();page=await browser.newPage();
 page.on('console',m=>{if(m.type()==='error')console.log('[page]',m.text());});
 await page.goto(server.url);await expect(page.locator('#state')).toHaveText('ready');
 init=await page.evaluate(()=>(globalThis as unknown as {client:SandboxClient}).client.start());
});
test.afterAll(async()=>{
 // The sizes of the parts each program loads on first use, as this server sent them.
 const report={timingsMs:timings,bytes:Object.fromEntries([...server.bytes].filter(([k])=>/^\/(dist|assets)\//.test(k)&&!k.endsWith('/')).sort())};
 const out=join(dirname(fileURLToPath(import.meta.url)),'..','..','test-results');mkdirSync(out,{recursive:true});writeFileSync(join(out,'browser-sizes.json'),JSON.stringify(report,null,1));
 console.log(JSON.stringify(report,null,1));
 await page?.close();await server?.close();
});
const run=async(command:string,timeoutMs=240000)=>{
 const started=Date.now();
 const result=await page.evaluate(([c,t])=>(globalThis as unknown as {client:SandboxClient}).client.runCommand({command:c,timeoutMs:t},Math.max(t+60000,240000)).then(r=>r.process as ProcessResult),[command,timeoutMs] as const);
 return{...result,ms:Date.now()-started};
};
const write=(path:string,text:string)=>page.evaluate(([p,t])=>(globalThis as unknown as {client:SandboxClient}).client.writeFile(p,t),[path,text] as const);

test('the page is cross-origin isolated, so ffmpeg gets threads',async()=>{
 expect(init.crossOriginIsolated).toBe(true);expect(init.threads).toBe(true);
 expect(init.commands).toEqual(expect.arrayContaining(['python3','ffmpeg','ffprobe','node','esbuild','grep','sed','awk']));
});
test('shell and Unix tools run in the worker',async()=>{
 const r=await run('mkdir -p notes && printf "b\\na\\nb\\n" > notes/x.txt && sort notes/x.txt | uniq -c | awk \'{print $2"="$1}\'');
 expect(r.output).toBe('a=1\nb=2\n');expect(r.status).toBe('complete');
});
test('python -c runs on Pyodide and sees the shell files',async()=>{
 const r=await run('python3 -c "import sys; print(sum(range(10)), sys.version_info[:2], open(\'notes/x.txt\').read().split())"');
 timings.pythonFirstRun=r.ms;
 expect(r.output).toBe("45 (3, 14) ['b', 'a', 'b']\n");expect(r.status).toBe('complete');
 const again=await run('python3 -c "print(\'warm\')"');timings.pythonWarm=again.ms;expect(again.output).toBe('warm\n');
});
test('python loads numpy and Pillow on import',async()=>{
 const r=await run('python3 -c "import numpy as np; from PIL import Image; a = np.zeros((4, 6, 3), dtype=np.uint8); a[..., 0] = 255; Image.fromarray(a).save(\'red.png\'); print(a.shape, Image.open(\'red.png\').size, Image.open(\'red.png\').getpixel((0, 0)))" && ls -l red.png | awk \'{print ($5 > 0)}\'');
 timings.numpyPillowFirstImport=r.ms;
 expect(r.output).toBe('(4, 6, 3) (6, 4) (255, 0, 0)\n1\n');
});
test('ffmpeg -version and a tiny transcode',async()=>{
 const version=await run('ffmpeg -version | head -1');timings.ffmpegFirstRun=version.ms;
 expect(version.output).toMatch(/^ffmpeg version /);expect(version.status).toBe('complete');
 // A grey 64x36 frame from node (binary-safe), a one-second H.264 clip from it, then a scaled transcode of that clip.
 const make=await run('node -e "require(\'fs\').writeFileSync(\'frame.ppm\', Buffer.concat([Buffer.from(\'P6 64 36 255\\n\'), Buffer.alloc(64 * 36 * 3, 128)]))" && ffmpeg -hide_banner -loglevel error -loop 1 -i frame.ppm -t 1 -r 10 -pix_fmt yuv420p -c:v libx264 clip.mp4 && ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,nb_frames -of csv=p=0 clip.mp4');
 expect(make.output).toBe('h264,64,36,10\n');
 const t=await run('ffmpeg -hide_banner -loglevel error -i clip.mp4 -vf scale=32:18 -c:v libx264 small.mp4 && ffprobe -v error -show_entries stream=width,height -of csv=p=0 small.mp4 && ls small.mp4');
 timings.ffmpegTranscode=t.ms;
 expect(t.output).toBe('32,18\nsmall.mp4\n');expect(t.status).toBe('complete');
 // Two decoders, a filter graph and x264 at once: more threads than the core preloads unless the sandbox caps them.
 const wide=await run('ffmpeg -hide_banner -loglevel error -i clip.mp4 -i clip.mp4 -filter_complex "[0:v][1:v]hstack,scale=128:36" -c:v libx264 wide.mp4 && ffprobe -v error -show_entries stream=width -of csv=p=0 wide.mp4');
 expect(wide.output).toBe('128\n');
 const bad=await run('ffmpeg -hide_banner -i missing.mp4 out.mp4');expect(bad.status).toBe('failed');expect(bad.output).toContain('missing.mp4: No such file or directory');
 const probe=await run('ffprobe -v error missing.mp4');expect(probe.exitCode).toBe(1);
});
test('esbuild bundles a TypeScript scene in the worker and node runs it',async()=>{
 await write('scene/main.ts','import {frames} from "./timing";\nimport {pad} from "pad-lib";\nconst fps: number = 30;\nconsole.log(pad(String(frames(2.5, fps)), 5));\n');
 await write('scene/timing.ts','export const frames = (sec: number, fps: number): number => Math.round(sec * fps);\n');
 await write('node_modules/pad-lib/package.json',JSON.stringify({name:'pad-lib',main:'index.js'}));
 await write('node_modules/pad-lib/index.js','exports.pad = (s, n) => s.padStart(n, "0");\n');
 const r=await run('esbuild scene/main.ts --bundle --format=iife --outfile=output/scene.js && node output/scene.js && head -c 40 output/scene.js');
 timings.esbuildFirstRun=r.ms;
 expect(r.output).toMatch(/output\/scene\.js\s+\d+(\.\d)?(b|kb)\n\n⚡ Done in \d+ms\n00075\n/);expect(r.status).toBe('complete');
});
test('a Python loop is interrupted at its time limit without restarting the worker',async()=>{
 const r=await run('python3 -c "while True: pass"',3000);
 expect(r.status).toBe('cancelled');expect(r.output).toMatch(/ran past its 3s time limit/);expect(r.ms).toBeLessThan(9000);
 expect(await page.evaluate(()=>(globalThis as unknown as {client:SandboxClient}).client.restarts)).toBe(0);
 expect((await run('python3 -c "print(\'still here\')"')).output).toBe('still here\n');
});
test('a long command goes to the background and can be stopped',async()=>{
 const first=await page.evaluate(()=>(globalThis as unknown as {client:SandboxClient}).client.runCommand({command:'echo started; sleep 30'},500));
 expect(first.process.status).toBe('running');expect(first.note).toContain('processId');
 const stopped=await page.evaluate(id=>(globalThis as unknown as {client:SandboxClient}).client.runCommand({processId:id,stop:true}),first.process.id);
 expect(stopped.process.status).toBe('cancelled');expect(stopped.process.output).toContain('started');
});
test('a stuck JS loop is ended by restarting the worker, and the next command runs',async()=>{
 const r=await run('node -e "while (true) {}"',2000);
 expect(r.status).toBe('cancelled');expect(r.output).toMatch(/ran past its 2s time limit/);
 expect(await page.evaluate(()=>(globalThis as unknown as {client:SandboxClient}).client.restarts)).toBe(1);
 expect((await run('echo alive')).output).toBe('alive\n');
});
