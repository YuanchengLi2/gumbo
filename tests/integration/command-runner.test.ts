import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {CodeRuntime,commandMemoryLimit} from '../../apps/desktop/src/main/code-runtime';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';

const localRuntime=()=>{
 const project=mkdtempSync(join(tmpdir(),'dream-runner-')),workspace=join(project,'Workspace');mkdirSync(workspace);
 mkdirSync(join(project,'runtime','shell'),{recursive:true});copyFileSync(resolve('apps/desktop/resources/staged/creation/shell/busybox.exe'),join(project,'runtime','shell','busybox.exe'));mkdirSync(join(project,'runtime','host'),{recursive:true});copyFileSync(resolve('apps/desktop/resources/staged/creation/host/creation-host.exe'),join(project,'runtime','host','creation-host.exe'));
 const runtime=new CodeRuntime({creation:join(project,'runtime'),ffmpeg:join(project,'bin','ffmpeg.exe'),ffprobe:'',browser:''});runtime.local=()=>true;return{runtime,workspace};
};

// "make the caption white" sat ten minutes on one command: a program left running in the background kept the output open.
it('ends a command when its shell exits, even if a program it started keeps running in the background',async()=>{
 // Normal priority: below normal (the app's setting) waits for a CPU the rest of the test suite keeps busy, and this
 // test is about when a command ends, not about priority.
 const {runtime,workspace}=localRuntime(),started=Date.now();runtime.priority='normal';
 const result=await runtime.run({id:'bg',projectId:'p',workspace,command:'sleep 20 & echo started',cwd:'.',timeoutMs:60000},new AbortController().signal,()=>{});
 expect(result).toMatchObject({status:'complete',exitCode:0});expect(result.output).toContain('started');
 expect(Date.now()-started).toBeLessThan(10000);
},30000);

// "'head' is not recognized": a program's own shell is cmd.exe on Windows, which had no Unix tools.
it('gives programs that start their own shell the Unix tools too',async()=>{
 const {runtime,workspace}=localRuntime();
 const result=await runtime.run({id:'sub',projectId:'p',workspace,command:'cmd /d /c "echo one two three| head -c 3"',cwd:'.',timeoutMs:30000},new AbortController().signal,()=>{});
 expect(result).toMatchObject({status:'complete',exitCode:0});expect(result.output.trim()).toBe('one');
},30000);

it('returns a long command\'s output so far and lets it run on, then waits for it again; finishing waits for it',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-long-')),db=new ProjectDB(root);process.env.DREAM_COMMAND_WAIT_MS='300';
 let finish!:()=>void;
 const ws=new CodeWorkspace(db,{ffmpeg:'unavailable',ffprobe:'unavailable',run:async(request,_signal,onOutput)=>{onOutput('frame 120 of 900\n');await new Promise<void>(r=>finish=r);return{id:request.id,status:'complete',exitCode:0,startedAt:'',finishedAt:'',output:'frame 900 of 900\n',logPath:'',isolation:'local',commandHash:'x'};}},()=>{});
 try{
  await ws.initialize();const signal=new AbortController().signal;
  const first=await ws.execute('run_command',{command:'python render_scores.py',cwd:'.'},'long1','turn',signal);
  expect(first.process).toMatchObject({id:'long1',status:'running'});expect(first.process.output).toContain('frame 120');expect(first.note).toContain('processId');
  expect(ws.runningCommands().map(c=>c.id)).toEqual(['long1']);
  // Other work is not held up by it.
  expect((await ws.execute('list_files',{path:'.'},'list','turn',signal)).length).toBeGreaterThan(0);
  const again=await ws.execute('run_command',{processId:'long1'},'wait1','turn',signal);expect(again.process.status).toBe('running');
  finish();const done=await ws.execute('run_command',{processId:'long1'},'wait2','turn',signal);
  expect(done.process).toMatchObject({status:'complete',output:'frame 900 of 900\n'});expect(ws.runningCommands()).toEqual([]);
 }finally{delete process.env.DREAM_COMMAND_WAIT_MS;db.close();}
});

// October 14: one agent command (a filter graph over a 21-minute source) used up the computer's memory and the app died.
it('stops a command that uses more memory than a command may, and says why, without touching the app',async()=>{
 const {runtime,workspace}=localRuntime(),before=process.env.DREAM_COMMAND_MEMORY_GB;process.env.DREAM_COMMAND_MEMORY_GB='0.5';
 try{
  const result=await runtime.run({id:'hog',projectId:'p',workspace,command:`node -e "const a=[];for(let i=0;i<40;i++)a.push(Buffer.alloc(64*1024*1024,1));console.log('allocated all')"`,cwd:'.',timeoutMs:60000},new AbortController().signal,()=>{});
  expect(result.status).toBe('failed');expect(result.output).not.toContain('allocated all');expect(result.output).toContain('used all 0.5 GB of memory a command may use');
  // The next command runs normally.
  const next=await runtime.run({id:'after',projectId:'p',workspace,command:'echo fine',cwd:'.',timeoutMs:60000},new AbortController().signal,()=>{});expect(next.output).toContain('fine');
 }finally{if(before===undefined)delete process.env.DREAM_COMMAND_MEMORY_GB;else process.env.DREAM_COMMAND_MEMORY_GB=before;}
},90_000);

it('lets a command use most of the computer\'s memory, keeping some for everything else',()=>{
 const gb=1024**3;expect(commandMemoryLimit(16*gb)/gb).toBeCloseTo(9.6,1);expect(commandMemoryLimit(4*gb)/gb).toBe(2);expect(commandMemoryLimit(64*gb)/gb).toBeCloseTo(38.4,1);
});
