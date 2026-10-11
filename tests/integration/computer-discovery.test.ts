import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
import {FileAccess} from '../../apps/desktop/src/main/file-access';
import {FileOperations} from '../../apps/desktop/src/main/file-operations';

it('searches across approved roots and familiar folders without duplicate results',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-computer-')),files=join(root,'files');mkdirSync(files);
 for(let i=0;i<70;i++)writeFileSync(join(files,`clip-${i}.txt`),'Brief');
 const access=new FileAccess(join(root,'profile'),[{name:'Documents',path:files}]);
 access.roots=()=>{if(!access.hasComputer())throw new Error('FILE_PERMISSION_REQUIRED');return[files];};
 const service=new FileOperations(access,join(root,'profile'),async()=>{});
 expect(await service.request({action:'search',path:'',query:'clip'})).toEqual({permissionRequired:true});
 const grant=access.grant('computer',undefined,true);
 const first=await service.request({action:'search',path:'',query:'clip'});if(!('entries'in first))throw new Error('Expected results');
 expect(first.entries).toHaveLength(60);expect(first.nextCursor).toBeTruthy();
 const second=await service.request({action:'search',path:'',query:'clip',cursor:first.nextCursor});if(!('entries'in second))throw new Error('Expected results');
 expect(second.entries).toHaveLength(10);expect(new Set([...first.entries,...second.entries].map(e=>e.path)).size).toBe(70);
 expect(await service.request({action:'list',path:''})).toMatchObject({locations:[{name:'Documents',path:files}]});
 access.revoke(grant.id);expect(await service.request({action:'search',path:'',query:'clip'})).toEqual({permissionRequired:true});
});
