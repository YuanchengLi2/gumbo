import {test,expect} from '@playwright/test';
import {session,use,text} from './roux-session';

/** A command that never gives the sandbox worker back (a JavaScript loop: nothing can interrupt it) is stopped at its
 * time limit by restarting the worker, and the sandbox works again for the next command. On October 24 a stuck command
 * restarted the sandbox and every command after it failed ("The sandbox worker failed: unknown error"). */
test('the sandbox comes back working after a command that blocks it',async({page})=>{
 test.setTimeout(240_000);
 const run=await session(page,()=>[
  [use('stuck','run',{command:'node -e "while(true){}"',timeoutMs:5000})],
  [use('after','run',{command:'echo back && python3 -c "print(6*7)"'})],
  [use('again','run',{command:'ffprobe -v error -show_entries format=duration -of csv=p=0 ../Media/Originals/*source.mp4'})],
  // An analysis that writes nothing (-f null -): it used to fail looking for an output file.
  [use('loud','run',{command:'ffmpeg -v error -i ../Media/Originals/*source.mp4 -af ebur128 -f null -; echo "ffmpeg exit=$?"'})],
  [{type:'text',text:'Checked the sandbox.'}]]);
 try{
  const started=Date.now();await run.ask('Run a few commands.');
  const {seen}=run;
  expect(text(seen.stuck)).toMatch(/time limit|restarted|cancelled/i);
  expect(text(seen.after)).toMatch(/Exit code 0/);expect(text(seen.after)).toMatch(/back/);expect(text(seen.after)).toMatch(/42/);
  expect(text(seen.again)).toMatch(/Exit code 0/);expect(text(seen.again)).toMatch(/\b6\.0/);
  expect(text(seen.loud)).toMatch(/ffmpeg exit=0/);expect(text(seen.loud)).not.toMatch(/ENOENT/);
  // Stopped near its 5-second limit, not left running for minutes.
  expect(Date.now()-started).toBeLessThan(120_000);
 }finally{await run.gateway.close();}
});
