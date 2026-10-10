import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
import {Director} from '../../packages/orchestrator/src/legacy-director';
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

it('a planner requests computer access and resumes the saved read after approval',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-plan-files-')),'Plan files');let allowed=false,reads=0,calls=0;
 const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,async request=>{if(!allowed)return{permissionRequired:true};expect(request.action).toBe('read');reads++;return{text:'Use a calm opening and blue titles.'};});
 director.inference=async(_model,_system,messages,tools)=>{
  calls++;expect(tools?.some((tool:any)=>tool.name==='computer_files')).toBe(true);
  return calls===1?{content:[{type:'tool_use',id:'brief',name:'computer_files',input:{action:'read',path:'C:/Documents/brief.txt'}}],stop_reason:'tool_use',usage:{}}:{content:[{type:'tool_use',id:'plan',name:'submit_plan',input:{schemaVersion:1,title:'A calm opening',goal:'Follow the computer brief',steps:[{id:'titles',title:'Blue titles',instruction:'Use blue titles in the opening.',acceptance:'The titles are blue.',review:false}],assumptions:[]}}],stop_reason:'tool_use',usage:{}};
 };
 try{await director.message('Plan from the brief on my computer',[],'plan');expect(db.state().aiStatus).toBe('awaiting_file_permission');expect(reads).toBe(0);allowed=true;await director.resume();expect(db.state().aiStatus).toBe('awaiting_approval');expect(reads).toBe(1);expect(calls).toBe(2);expect(db.timeline().spine).toEqual([]);}finally{db.close();}
});
