import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startCrashLog,markRunning,markQuit} from '../../apps/desktop/src/main/crash-log';

it('records a run that ended without quitting at the next start, with the newest crash dump from that run',()=>{
 const home=mkdtempSync(join(tmpdir(),'dream-crash-')),dumps=join(home,'Crashpad'),reports=join(dumps,'reports');mkdirSync(reports,{recursive:true});
 startCrashLog(home);const log=join(home,'logs','crashes.log');
 // A normal quit leaves nothing to report.
 markRunning(dumps);markQuit();markRunning(dumps);expect(existsSync(log)).toBe(false);
 // This run crashes: an old dump from before it and the dump it left.
 const old=join(reports,'old.dmp'),fresh=join(reports,'fresh.dmp');writeFileSync(old,'');writeFileSync(fresh,'');const past=new Date(Date.now()-3600_000);utimesSync(old,past,past);
 markRunning(dumps);
 const record=JSON.parse(readFileSync(log,'utf8').trim().split('\n').at(-1)!);
 expect(record).toMatchObject({kind:'previous-run-ended-unexpectedly',pid:process.pid,dump:fresh});expect(record.startedAt).toBeTruthy();
 markQuit();expect(existsSync(join(home,'logs','running.json'))).toBe(false);
});
