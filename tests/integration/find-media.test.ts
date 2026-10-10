import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,utimesSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FileAccess} from '../../apps/desktop/src/main/file-access';
import {FileOperations} from '../../apps/desktop/src/main/file-operations';
import {findMedia,mediaWindow,familiarMediaFolders} from '../../apps/desktop/src/main/media-catalog';

const touch=(path:string,when:Date,content='media')=>{writeFileSync(path,content);utimesSync(path,when,when);};

it('turns today, yesterday, this week and the last 7 days into local-time windows',()=>{
 const now=new Date(2026,9,10,15,30);// Saturday 10 October, 15:30 local time
 expect(mediaWindow({when:'today'},now)).toEqual({from:new Date(2026,9,10),to:new Date(2026,9,11)});
 expect(mediaWindow({when:'yesterday'},now)).toEqual({from:new Date(2026,9,9),to:new Date(2026,9,10)});
 expect(mediaWindow({when:'this_week'},now)!.from).toEqual(new Date(2026,9,5));expect(mediaWindow({when:'last_7_days'},now)!.from).toEqual(new Date(2026,9,4));
 expect(mediaWindow({},now)).toBeUndefined();
});

it('finds today\'s media in nested folders, sorted by capture time, and skips other days and other files',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'dream-find-'))),camera=join(root,'Camera Roll'),nested=join(camera,'2026','10');mkdirSync(nested,{recursive:true});
 const now=new Date(2026,9,10,18);
 touch(join(nested,'evening.mp4'),new Date(2026,9,10,17,30));touch(join(camera,'morning.jpg'),new Date(2026,9,10,8,15));
 touch(join(camera,'yesterday.mp4'),new Date(2026,9,9,20));touch(join(camera,'notes.txt'),new Date(2026,9,10,9));
 const today=await findMedia([{name:'Camera Roll',path:camera}],{when:'today'},undefined,now);
 expect(today.media.map(m=>m.name)).toEqual(['morning.jpg','evening.mp4']);expect(today.media[0]).toMatchObject({kind:'image',capturedAtSource:'file'});
 expect(today.window).toEqual({from:new Date(2026,9,10).toISOString(),to:new Date(2026,9,11).toISOString()});expect(today.timeZone).toBeTruthy();
 const videos=await findMedia([{name:'Camera Roll',path:camera}],{when:'last_7_days',kinds:['video'],sort:'name'},undefined,now);
 expect(videos.media.map(m=>m.name)).toEqual(['evening.mp4','yesterday.mp4']);
});

it('lists familiar camera, phone sync and download folders once, with memory-card DCIM folders',()=>{
 const home=realpathSync(mkdtempSync(join(tmpdir(),'dream-home-'))),pictures=join(home,'Pictures');mkdirSync(join(pictures,'Camera Roll'),{recursive:true});
 const folders=familiarMediaFolders({home,pictures,videos:join(home,'Videos'),downloads:join(home,'Downloads'),desktop:join(home,'Desktop')},{OneDrive:join(home,'OneDrive')},['Z:\\']);
 expect(folders.find(f=>f.name==='Camera Roll')).toMatchObject({exists:true});expect(folders.some(f=>f.name==='OneDrive Camera Roll')).toBe(true);
 expect(folders.find(f=>f.removable)).toMatchObject({path:join('Z:\\','DCIM')});expect(new Set(folders.map(f=>f.path.toLowerCase())).size).toBe(folders.length);
});

it('needs computer access to scan familiar folders, while a dropped folder can be searched with its own read-only grant',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'dream-find-access-'))),dropped=join(root,'Trip'),other=join(root,'Private');mkdirSync(dropped);mkdirSync(other);
 touch(join(dropped,'a.mp4'),new Date());touch(join(other,'b.mp4'),new Date());
 const access=new FileAccess(join(root,'profile'),[]);access.roots=()=>{if(!access.hasComputer())throw new Error('FILE_PERMISSION_REQUIRED');return[root];};
 const service=new FileOperations(access,join(root,'profile'),async()=>{},undefined,()=>[{name:'Videos',path:other,exists:true}]);
 expect(await service.request({action:'find_media',when:'today',sort:'captured',limit:100})).toEqual({permissionRequired:true});
 expect(await service.request({action:'computer_status'})).toMatchObject({access:false});
 access.grant('folder',dropped);
 const found=await service.request({action:'find_media',when:'today',folders:[dropped],sort:'captured',limit:100});if(!('media'in found))throw new Error('Expected a catalog');expect(found.media.map(m=>m.name)).toEqual(['a.mp4']);
 // A folder grant covers its subtree for reading only, never writing, and nothing outside it.
 expect(access.assert(join(dropped,'a.mp4'))).toBeTruthy();expect(()=>access.assert(join(dropped,'a.mp4'),true)).toThrow('FILE_PERMISSION_REQUIRED');expect(()=>access.assert(join(other,'b.mp4'))).toThrow('FILE_PERMISSION_REQUIRED');
 access.grant('computer',undefined,true);
 const all=await service.request({action:'find_media',when:'today',sort:'captured',limit:100});if(!('media'in all))throw new Error('Expected a catalog');expect(all.media.map(m=>m.name)).toEqual(['b.mp4']);
 expect(await service.request({action:'computer_status'})).toMatchObject({access:true,folders:[{name:'Videos'}]});
});
