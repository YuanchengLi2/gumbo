import {it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
vi.mock('electron',()=>({app:{isPackaged:false,getAppPath:()=>'.'},autoUpdater:{}}));
const {startUpdates,updateFeed}=await import('../../apps/desktop/src/main/updates');

/** Auto-update (apps/desktop/src/main/updates.ts): packaged Windows builds check the feed, download in the background, and
 * restart into the new version only when one is ready. */
const fakeUpdater=()=>{const e=new EventEmitter() as any;e.feed='';e.checks=0;e.installed=false;e.setFeedURL=({url}:{url:string})=>{e.feed=url;};e.checkForUpdates=()=>{e.checks++;};e.quitAndInstall=()=>{e.installed=true;};return e;};
const windows={packaged:true,platform:'win32',argv:['Dream.exe'],firstCheckMs:5,everyMs:60_000};

it('reads the feed from the environment or the packaged cloud.json, and only an https address',()=>{
 const dir=mkdtempSync(join(tmpdir(),'gumbo-feed-')),cloud=join(dir,'cloud.json');
 expect(updateFeed({DREAM_UPDATE_URL:'https://example.test/feed'},cloud)).toBe('https://example.test/feed');
 expect(updateFeed({},cloud)).toBeUndefined();
 writeFileSync(cloud,JSON.stringify({url:'https://x.supabase.co',updates:'https://github.com/o/r/releases/latest/download'}));
 expect(updateFeed({},cloud)).toBe('https://github.com/o/r/releases/latest/download');
 writeFileSync(cloud,JSON.stringify({updates:'http://insecure.test'}));expect(updateFeed({},cloud)).toBeUndefined();
});

it('checks only in a packaged Windows build with a feed, and not on the first run after installing',()=>{
 for(const options of [{...windows,packaged:false},{...windows,platform:'darwin'},{...windows,argv:['Dream.exe','--squirrel-firstrun']}]){
  const updater=fakeUpdater();expect(startUpdates(()=>{},{...options,feed:'https://feed.test',updater})).toBeUndefined();expect(updater.feed).toBe('');
 }
 expect(startUpdates(()=>{},{...windows,updater:fakeUpdater()})).toBeUndefined();
});

it('downloads in the background, says when it is ready, and restarts only into a ready update',async()=>{
 const updater=fakeUpdater(),seen:any[]=[];
 const updates=startUpdates(status=>seen.push(status),{...windows,feed:'https://feed.test',updater})!;
 try{
  expect(updater.feed).toBe('https://feed.test');expect(updates.restart()).toBe(false);expect(updater.installed).toBe(false);
  await new Promise(r=>setTimeout(r,20));expect(updater.checks).toBe(1);
  updater.emit('update-available');expect(updates.status()).toEqual({status:'downloading'});
  // No second download while one runs, and a failed check never hides a ready update.
  updates.check();expect(updater.checks).toBe(1);
  updater.emit('update-downloaded',{},'notes','0.2.1');updater.emit('error',new Error('offline'));
  expect(updates.status()).toEqual({status:'ready',version:'0.2.1'});expect(seen.at(-1)).toEqual({status:'ready',version:'0.2.1'});
  expect(updates.restart()).toBe(true);expect(updater.installed).toBe(true);
 }finally{updates.stop();}
});
