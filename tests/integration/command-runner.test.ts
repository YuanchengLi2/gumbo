import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {CodeRuntime} from '../../apps/desktop/src/main/code-runtime';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';

const localRuntime=()=>{
 const project=mkdtempSync(join(tmpdir(),'dream-runner-')),workspace=join(project,'Workspace');mkdirSync(workspace);
 mkdirSync(join(project,'runtime','shell'),{recursive:true});copyFileSync(resolve('apps/desktop/resources/staged/creation/shell/busybox.exe'),join(project,'runtime','shell','busybox.exe'));
 const runtime=new CodeRuntime({creation:join(project,'runtime'),ffmpeg:join(project,'bin','ffmpeg.exe'),ffprobe:'',browser:''});runtime.local=()=>true;return{runtime,workspace};
};

// "make the caption white" sat ten minutes on one command: a program left running in the background kept the output open.
it('ends a command when its shell exits, even if a program it started keeps running in the background',async()=>{
 const {runtime,workspace}=localRuntime(),started=Date.now();
 const result=await runtime.run({id:'bg',projectId:'p',workspace,command:'sleep 20 & echo started',cwd:'.',timeoutMs:60000},new AbortController().signal,()=>{});
 expect(result).toMatchObject({status:'complete',exitCode:0});expect(result.output).toContain('started');expect(Date.now()-started).toBeLessThan(10000);
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
