import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {projectFiles,saveToCloud,openFromCloud,HashCache,type CloudApi} from '../../apps/desktop/src/main/cloud';
import {handleCloud,type CloudPorts,type CloudFile} from '../../supabase/functions/dream-gateway/cloud';

/** Gumbo's cloud on this computer (apps/desktop/src/main/cloud.ts) against the gateway's logic with storage in memory:
 * what a save carries, saving only changes, opening on another computer, damaged downloads, and footage relinked. */
const temp=(name:string)=>mkdtempSync(join(tmpdir(),`gumbo-${name}-`));
const file=(path:string,text:string)=>{mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,text);};

function cloud(){
 const projects=new Map<string,{name:string;device:string;files:CloudFile[]}>(),objects=new Map<string,Buffer>(),puts:string[]=[];
 const ports:CloudPorts={projects:async()=>[...projects].map(([id,p])=>({project_id:id,name:p.name,size_bytes:p.files.reduce((n,f)=>n+f.size,0),files:p.files.length,updated_at:'2026-10-20T00:00:00Z',device:p.device})),files:async(_u,id)=>projects.get(id)?.files??[],save:async(_u,id,e)=>{if(e)projects.set(id,e);else projects.delete(id);}};
 const r2={accountId:'acc',accessKeyId:'k',secretAccessKey:'s',bucket:'gumbo'};
 const fetcher=(async(url:string,init:any={})=>{const key=decodeURIComponent(new URL(url).pathname);
  if(init.method==='PUT'){const chunks:Buffer[]=[];for await(const c of init.body as any)chunks.push(Buffer.from(c));objects.set(key,Buffer.concat(chunks));puts.push(key.split('/').slice(4).join('/'));return new Response(null,{status:200});}
  if(init.method==='DELETE'){objects.delete(key);return new Response(null,{status:204});}
  const body=objects.get(key);return body?new Response(new Uint8Array(body)):new Response(null,{status:404});}) as unknown as typeof fetch;
 const api:CloudApi=async(action,body)=>{const r=await handleCloud(action,body,'user1',{r2,limitGB:50,ports,fetcher});if(r.status!==200)throw new Error((r.body as any).error);return r.body;};
 return{api,fetcher,objects,puts};
}

it('saves a project with only what it needs, sends only changes, and opens it on another computer with its footage relinked',async()=>{
 const desk=temp('desk'),downloads=temp('downloads'),folder=join(desk,'Vietnam');mkdirSync(folder);
 // Footage imported from Downloads, with the project's own copy in Sources/, and a file imported into Media/.
 const original=join(downloads,'trip.mp4');file(original,'TRIP VIDEO');
 const db=new ProjectDB(folder,'Vietnam');
 try{db.saveAsset(AssetSchema.parse({id:'a_1',filename:'trip.mp4',kind:'video',originalPath:original,durationSec:10,width:1920,height:1080,fps:30,hasAudio:true,fingerprint:'f',status:'ready'}));}finally{db.close();}
 file(join(folder,'Sources','a_1','trip.mp4'),'TRIP VIDEO');file(join(folder,'Media','clip.mp4'),'CLIP');
 file(join(folder,'Workspace','project.json'),'{}');file(join(folder,'Workspace','src','title.tsx'),'export default 1');
 file(join(folder,'Workspace','node_modules','left-out.js'),'x');file(join(folder,'Workspace','.cache','left-out'),'x');file(join(folder,'Exports','final.mp4'),'EXPORT');
 expect(projectFiles(folder).map(f=>f.path).sort()).toEqual(['Media/clip.mp4','Project.dreamproj','Sources/a_1/trip.mp4','Workspace/project.json','Workspace/src/title.tsx']);

 const {api,fetcher,objects,puts}=cloud(),progress:string[]=[],hashes=new HashCache(join(desk,'hashes.json'));
 const project={id:'p_1',name:'Vietnam',folder};
 const first=await saveToCloud(project,api,p=>progress.push(`${p.direction}:${p.phase}`),{fetcher,hashes});
 expect(first).toMatchObject({saved:true,files:6,uploaded:6});expect(puts.sort()).toEqual(['.dream/project.sqlite','Media/clip.mp4','Project.dreamproj','Sources/a_1/trip.mp4','Workspace/project.json','Workspace/src/title.tsx']);
 expect(progress.at(-1)).toBe('save:done');expect(existsSync(join(desk,'hashes.json'))).toBe(true);
 // A second save after editing one file sends that file (and the database snapshot, if it changed), never the footage.
 puts.length=0;file(join(folder,'Workspace','src','title.tsx'),'export default 2');
 await saveToCloud(project,api,()=>{},{fetcher,hashes});
 expect(puts.filter(p=>p!=='.dream/project.sqlite')).toEqual(['Workspace/src/title.tsx']);

 // On another computer: Downloads has no trip.mp4, so the footage is relinked to the project's copy.
 rmSync(original);
 const laptop=join(temp('laptop'),'Vietnam'),opened=await openFromCloud('p_1',laptop,api,p=>progress.push(`${p.direction}:${p.phase}`),{fetcher});
 expect(opened).toMatchObject({name:'Vietnam',downloaded:6,unchanged:0});expect(progress.at(-1)).toBe('open:done');
 expect(readFileSync(join(laptop,'Workspace','src','title.tsx'),'utf8')).toBe('export default 2');expect(existsSync(join(laptop,'Exports'))).toBe(false);
 const there=new ProjectDB(laptop,'Vietnam');
 try{expect(there.relinkFromSources()).toBe(1);expect(there.footage().assets[0].originalPath).toBe(join(laptop,'Sources','a_1','trip.mp4'));}finally{there.close();}
 // Opening again only fetches what differs; a damaged download is refused and nothing is replaced.
 expect((await openFromCloud('p_1',laptop,api,()=>{},{fetcher})).downloaded).toBe(1);
 for(const [key,value] of objects)if(key.endsWith('Media/clip.mp4'))objects.set(key,Buffer.concat([value,Buffer.from('!')]));
 rmSync(join(laptop,'Media','clip.mp4'));
 await expect(openFromCloud('p_1',laptop,api,()=>{},{fetcher})).rejects.toThrow('arrived damaged');
 expect(existsSync(join(laptop,'Media','clip.mp4'))).toBe(false);expect(existsSync(join(laptop,'Media','clip.mp4.partial'))).toBe(false);
});
