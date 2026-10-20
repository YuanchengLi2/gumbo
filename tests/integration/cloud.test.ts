import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {presign,validPath,handleCloud,type CloudPorts,type CloudFile,type R2} from '../../supabase/functions/dream-gateway/cloud';
import {supabaseDb} from '../fixtures/supabase-db';

/** Gumbo's cloud (supabase/functions/dream-gateway/cloud.ts, migration 202610200002): signed links to R2, the plan's space,
 * saving only what changed, and opening a saved project elsewhere. */
it("signs links exactly as S3 Signature Version 4 does (AWS's published example)",async()=>{
 const url=await presign('GET','test.txt',{accountId:'x',accessKeyId:'AKIAIOSFODNN7EXAMPLE',secretAccessKey:'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',bucket:'examplebucket',host:'examplebucket.s3.amazonaws.com',region:'us-east-1',style:'virtual'},86400,new Date('2013-05-24T00:00:00Z'));
 expect(url).toBe('https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
 const r2=await presign('PUT','u/p/Media/a b.mp4',{accountId:'acc',accessKeyId:'k',secretAccessKey:'s',bucket:'gumbo'},3600,new Date('2026-10-20T00:00:00Z'));
 expect(r2.startsWith('https://acc.r2.cloudflarestorage.com/gumbo/u/p/Media/a%20b.mp4?')).toBe(true);expect(r2).toContain('%2Fauto%2Fs3%2Faws4_request');
});

it('only takes paths inside the saved parts of a project',()=>{
 for(const ok of ['Project.dreamproj','.dream/project.sqlite','Workspace/src/title.tsx','Sources/a_1/trip.mp4','Media/x.mov'])expect(validPath(ok)).toBe(true);
 for(const bad of ['../x','Workspace/../../x','C:/Windows/win.ini','/etc/passwd','Exports/final.mp4','.dream/proxies/a.mp4','Workspace\\x',''])expect(validPath(bad)).toBe(false);
});

const r2:R2={accountId:'acc',accessKeyId:'k',secretAccessKey:'s',bucket:'gumbo'};
function memory(){
 const projects=new Map<string,{name:string;device:string;files:CloudFile[];at:string}>();
 const ports:CloudPorts={projects:async()=>[...projects].map(([id,p])=>({project_id:id,name:p.name,size_bytes:p.files.reduce((n,f)=>n+f.size,0),files:p.files.length,updated_at:p.at,device:p.device})),
  files:async(_u,id)=>projects.get(id)?.files??[],save:async(_u,id,entry)=>{if(entry)projects.set(id,{...entry,at:'2026-10-20T00:00:00Z'});else projects.delete(id);}};
 return{projects,ports};
}
const sha=(c:string)=>c.repeat(64);

it("saves only changed files, keeps to the plan's space, removes what left the project, and opens it elsewhere",async()=>{
 const {projects,ports}=memory(),deleted:string[]=[];
 const fetcher=(async(url:string,init:any)=>{if(init?.method==='DELETE')deleted.push(decodeURIComponent(new URL(url).pathname));return new Response(null,{status:204});}) as unknown as typeof fetch;
 const call=(action:string,body:any,limitGB=50)=>handleCloud(action,body,'user1',{r2,limitGB,ports,fetcher});
 const files=[{path:'.dream/project.sqlite',size:80e6,sha256:sha('a')},{path:'Media/trip.mp4',size:2e9,sha256:sha('b')},{path:'Workspace/project.json',size:1e5,sha256:sha('c')}];
 // Free has no cloud space.
 expect(await call('cloud-upload',{projectId:'p_1',files},0)).toMatchObject({status:403,body:{code:'cloud_full',error:'Cloud storage comes with the Pro plan and above.'}});
 const first=await call('cloud-upload',{projectId:'p_1',files}) as any;
 expect(first.body.uploads.map((u:any)=>u.path)).toEqual(files.map(f=>f.path));expect(first.body.uploads[1].url).toContain('/gumbo/user1/p_1/Media/trip.mp4?');
 expect((await call('cloud-commit',{projectId:'p_1',name:'Vietnam',device:'Desk',files}) as any).body).toMatchObject({saved:true,files:3});
 // A second save sends only the edited file, and drops the one that left the project.
 const second=[{...files[0],sha256:sha('d')},files[1]];
 expect((await call('cloud-upload',{projectId:'p_1',files:second}) as any).body).toMatchObject({uploads:[{path:'.dream/project.sqlite'}],unchanged:1});
 await call('cloud-commit',{projectId:'p_1',name:'Vietnam',device:'Desk',files:second});
 expect(deleted).toEqual(['/gumbo/user1/p_1/Workspace/project.json']);
 // Space counts every saved project, less the one being replaced.
 expect((await call('cloud-upload',{projectId:'p_2',files:[{path:'Media/big.mp4',size:49e9,sha256:sha('e')}]}) as any).status).toBe(403);
 expect((await call('cloud-upload',{projectId:'p_1',files:[{path:'Media/big.mp4',size:49e9,sha256:sha('e')}]}) as any).status).toBe(200);
 const list=await call('cloud-list',{}) as any;
 expect(list.body).toMatchObject({projects:[{id:'p_1',name:'Vietnam',files:2,device:'Desk'}],usedBytes:2.08e9,limitBytes:50e9});
 const open=await call('cloud-download',{projectId:'p_1'}) as any;
 expect(open.body.files.map((f:any)=>f.path)).toEqual(['.dream/project.sqlite','Media/trip.mp4']);expect(open.body.files[1].url).toContain('X-Amz-Signature=');
 expect((await call('cloud-download',{projectId:'p_9'})).status).toBe(404);
 expect((await call('cloud-upload',{projectId:'p_1',files:[{path:'../evil',size:1,sha256:sha('f')}]})).status).toBe(400);
 await call('cloud-delete',{projectId:'p_1'});expect(projects.size).toBe(0);expect(deleted).toContain('/gumbo/user1/p_1/Media/trip.mp4');
 expect(await handleCloud('cloud-list',{},'user1',{limitGB:50,ports})).toEqual({status:200,body:{notSetUp:true,projects:[]}});
});

it("replaces a saved project's file list in one transaction in the database",async()=>{
 const db=await supabaseDb(),user=randomUUID();
 await db.query('insert into auth.users(id,email) values($1,$2)',[user,'a@example.com']);await db.query('insert into public.dream_accounts(id,email) values($1,$2)',[user,'a@example.com']);
 const save=(entry:unknown)=>db.query('select public.dream_cloud_save($1,$2,$3)',[user,'p_1',entry===null?null:JSON.stringify(entry)]);
 await save({name:'Vietnam',device:'Desk',files:[{path:'Media/a.mp4',size:10,sha256:sha('a')},{path:'Media/b.mp4',size:5,sha256:sha('b')}]});
 await save({name:'Vietnam',device:'Laptop',files:[{path:'Media/a.mp4',size:12,sha256:sha('c')}]});
 expect((await db.query('select name,size_bytes::int as size_bytes,files,device from public.dream_cloud_projects')).rows).toEqual([{name:'Vietnam',size_bytes:12,files:1,device:'Laptop'}]);
 expect((await db.query('select path,size::int as size from public.dream_cloud_files')).rows).toEqual([{path:'Media/a.mp4',size:12}]);
 await save(null);expect((await db.query('select count(*)::int as n from public.dream_cloud_files')).rows).toEqual([{n:0}]);
});
