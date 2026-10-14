import {mkdtempSync,rmSync,readdirSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/** Every test run writes its scratch projects, profiles and renders into one folder that is deleted when the run ends,
 * instead of leaving thousands of folders in the system's temp directory. Runs that crashed leave theirs behind; those
 * older than an hour are removed when the next run starts. Workers and launched apps inherit the folder through TEMP. */
export default function setup(){
 const base=tmpdir();
 for(const name of readdirSync(base))if(name.startsWith('dream-test-run-'))try{if(Date.now()-statSync(join(base,name)).mtimeMs>3600_000)rmSync(join(base,name),{recursive:true,force:true});}catch{}
 const run=mkdtempSync(join(base,'dream-test-run-'));
 for(const key of ['TEMP','TMP','TMPDIR'])process.env[key]=run;
 return()=>{try{rmSync(run,{recursive:true,force:true,maxRetries:5,retryDelay:500});}catch{}};
}
