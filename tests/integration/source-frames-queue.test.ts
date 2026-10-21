import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {jpeg} from '../../apps/project-service/src/source-frames';

/** Frame reads queue a few at a time (source-frames.ts): nine at once all come back as frames, and a read still waiting in
 * the queue can be canceled without starting ffmpeg. */
it('reads many frames at once through the queue, and a queued read can be canceled',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-frames-'));try{
  const clip=join(folder,'clip.mp4');execFileSync(ffmpeg!,['-v','error','-f','lavfi','-i','testsrc2=s=1280x720:r=30:d=6','-c:v','libx264','-g','90','-pix_fmt','yuv420p',clip]);
  const frames=await Promise.all([.5,1,1.5,2,2.5,3,3.5,4,4.5].map(t=>jpeg(ffmpeg!,clip,t)));
  for(const bytes of frames){expect(bytes[0]).toBe(255);expect(bytes[1]).toBe(216);}
  // Fill the queue, then cancel one that is still waiting.
  const busy=[1,2,3].map(t=>jpeg(ffmpeg!,clip,t));const controller=new AbortController();const queued=jpeg(ffmpeg!,clip,4,controller.signal);
  controller.abort();await expect(queued).rejects.toThrow(/cancel/i);await Promise.all(busy);
  // The queue is free again afterwards.
  expect((await jpeg(ffmpeg!,clip,5))[0]).toBe(255);
 }finally{rmSync(folder,{recursive:true,force:true});}
},60_000);
