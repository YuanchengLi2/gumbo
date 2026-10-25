import {it,expect} from 'vitest';
import {connectPrograms,spawn} from '../../apps/web/src/project/shims/child-process';

/** ffmpeg and ffprobe in the browser go to the less busy of the media workers (apps/web/src/project/shims/child-process.ts),
 * so a look at a few frames runs beside a long analysis instead of waiting for it. */
class FakeWorker{sent:any[]=[];private listeners:((event:MessageEvent)=>void)[]=[];postMessage(message:any){this.sent.push(message);}addEventListener(_type:string,fn:(event:MessageEvent)=>void){this.listeners.push(fn);}finish(id:string){for(const fn of this.listeners)fn({data:{id,exit:0}} as MessageEvent);}}

it('sends each program to the worker with the fewest running, the first when they are equal',async()=>{
 const a=new FakeWorker(),b=new FakeWorker();connectPrograms(a as unknown as Worker,b as unknown as Worker);
 const ran=(w:FakeWorker)=>w.sent.filter(m=>m.run).map(m=>m.run.args[0]);
 // A long analysis takes the first worker; a frame grab then goes to the second.
 spawn('ffmpeg',['analysis']);spawn('ffmpeg',['frame-1']);
 expect(ran(a)).toEqual(['analysis']);expect(ran(b)).toEqual(['frame-1']);
 // The frame is done: the next one goes to the second worker again, beside the analysis still running.
 b.finish(b.sent[0].run.id);
 const closed=new Promise<number>(resolve=>{const child=spawn('ffprobe',['frame-2']);child.on('close',code=>resolve(code));});
 expect(ran(b)).toEqual(['frame-1','frame-2']);
 b.finish(b.sent[1].run.id);expect(await closed).toBe(0);
 // Stopping a program reaches the worker that runs it.
 const child=spawn('ffmpeg',['frame-3']);child.kill();expect(b.sent.at(-1)).toEqual({cancel:b.sent.at(-2).run.id});
});
