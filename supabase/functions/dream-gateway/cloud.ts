/** Gumbo's cloud: a project saved from one computer and opened on another. Files go straight between the app and
 * Cloudflare R2 through short-lived signed links (S3 Signature Version 4 query signing), so video never passes through
 * this function; the database keeps which files each project has (dream_cloud_files) and its size against the plan's
 * cloudGB (billing.ts PLANS limits). R2 is set up with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and
 * R2_BUCKET; without them every route answers { notSetUp: true }. Objects live under <account>/<project>/<path>. */
/** host, region and style are for other S3 services (and AWS's published example, which the tests check against). */
export type R2={accountId:string;accessKeyId:string;secretAccessKey:string;bucket:string;host?:string;region?:string;style?:'path'|'virtual'};
export type CloudFile={path:string;size:number;sha256:string};
export type CloudPorts={
 projects(user:string):Promise<{project_id:string;name:string;size_bytes:number;files:number;updated_at:string;device:string|null}[]>;
 files(user:string,project:string):Promise<CloudFile[]>;
 /** Replaces the project's file list and totals (a save), or removes them (null). */
 save(user:string,project:string,entry:{name:string;device:string;files:CloudFile[]}|null):Promise<void>;
};
const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
const sha256=async(text:string)=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(text)));
async function hmac(key:ArrayBuffer|Uint8Array,text:string){const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return crypto.subtle.sign('HMAC',k,encoder.encode(text));}
// RFC 3986 encoding, as Signature Version 4 wants it (encodeURIComponent leaves !'()* alone).
const rfc3986=(s:string)=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());

/** A signed address for one object, valid for expiresSec. */
export async function presign(method:'GET'|'PUT'|'DELETE',key:string,r2:R2,expiresSec=3600,now=new Date()){
 const host=r2.host??`${r2.accountId}.r2.cloudflarestorage.com`,region=r2.region??'auto';
 const stamp=now.toISOString().replace(/[-:]|\.\d{3}/g,''),day=stamp.slice(0,8),scope=`${day}/${region}/s3/aws4_request`;
 const path='/'+[...(r2.style==='virtual'?[]:[r2.bucket]),...key.split('/')].map(rfc3986).join('/');
 const query:[string,string][]=[['X-Amz-Algorithm','AWS4-HMAC-SHA256'],['X-Amz-Credential',`${r2.accessKeyId}/${scope}`],['X-Amz-Date',stamp],['X-Amz-Expires',String(expiresSec)],['X-Amz-SignedHeaders','host']];
 const canonicalQuery=query.map(([k,v])=>[rfc3986(k),rfc3986(v)]).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('&');
 const canonical=[method,path,canonicalQuery,`host:${host}`,'','host','UNSIGNED-PAYLOAD'].join('\n');
 const toSign=['AWS4-HMAC-SHA256',stamp,scope,await sha256(canonical)].join('\n');
 let key_:ArrayBuffer=await hmac(encoder.encode('AWS4'+r2.secretAccessKey),day);
 for(const part of [region,'s3','aws4_request'])key_=await hmac(key_,part);
 const signature=hex(await hmac(key_,toSign));
 return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** A project file's path: relative, forward slashes, inside the parts of a project that are saved. */
export const SAVED_PARTS=['Project.dreamproj','.dream/project.sqlite','Workspace/','Sources/','Media/'];
export function validPath(path:unknown):path is string{
 if(typeof path!=='string'||!path||path.length>400||path.includes('\\')||path.includes('\0')||path.startsWith('/')||/(^|\/)\.\.(\/|$)/.test(path)||/^[A-Za-z]:/.test(path))return false;
 return SAVED_PARTS.some(p=>p.endsWith('/')?path.startsWith(p):path===p);
}
const validFiles=(files:unknown):files is CloudFile[]=>Array.isArray(files)&&files.length<=20000&&files.every(f=>validPath(f?.path)&&Number.isSafeInteger(f?.size)&&f.size>=0&&/^[0-9a-f]{64}$/.test(f?.sha256??''));
const validProject=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(id);
const objectKey=(user:string,project:string,path:string)=>`${user}/${project}/${path}`;

export async function handleCloud(action:string,body:any,user:string,options:{r2?:R2;limitGB:number;ports:CloudPorts;fetcher?:typeof fetch;now?:Date}):Promise<{status:number;body:unknown}>{
 const {r2,ports,limitGB}=options,limitBytes=Math.round(limitGB*1e9);
 if(!r2)return{status:200,body:{notSetUp:true,projects:[]}};
 const projects=await ports.projects(user),usedBytes=projects.reduce((n,p)=>n+Number(p.size_bytes),0);
 if(action==='cloud-list')return{status:200,body:{projects:projects.map(p=>({id:p.project_id,name:p.name,sizeBytes:Number(p.size_bytes),files:p.files,updatedAt:p.updated_at,device:p.device})),usedBytes,limitBytes}};
 if(!validProject(body?.projectId))return{status:400,body:{error:'Give the project id.'}};
 const project=body.projectId;
 if(action==='cloud-upload'||action==='cloud-commit'){
  if(!validFiles(body.files))return{status:400,body:{error:'The file list is not valid.'}};
  const files:CloudFile[]=body.files,size=files.reduce((n,f)=>n+f.size,0),others=usedBytes-Number(projects.find(p=>p.project_id===project)?.size_bytes??0);
  if(others+size>limitBytes)return{status:403,body:{code:'cloud_full',error:limitBytes?`This project needs ${(size/1e9).toFixed(1)} GB and your plan's cloud has ${(Math.max(0,limitBytes-others)/1e9).toFixed(1)} GB free.`:'Cloud storage comes with the Pro plan and above.',usedBytes,limitBytes}};
  const stored=new Map((await ports.files(user,project)).map(f=>[f.path,f.sha256]));
  if(action==='cloud-upload'){
   // Only what changed since the last save goes up.
   const changed=files.filter(f=>stored.get(f.path)!==f.sha256);
   return{status:200,body:{uploads:await Promise.all(changed.map(async f=>({path:f.path,url:await presign('PUT',objectKey(user,project,f.path),r2,6*3600,options.now)}))),unchanged:files.length-changed.length}};
  }
  // A save's files replace the last save's; files no longer in the project are removed from storage.
  const gone=[...stored.keys()].filter(path=>!files.some(f=>f.path===path));
  await removeObjects(user,project,gone,r2,options.fetcher??fetch,options.now);
  await ports.save(user,project,{name:String(body.name??'Untitled project').slice(0,120),device:String(body.device??'').slice(0,80),files});
  return{status:200,body:{saved:true,sizeBytes:size,files:files.length,usedBytes:others+size,limitBytes}};
 }
 if(action==='cloud-download'){
  const files=await ports.files(user,project);if(!files.length)return{status:404,body:{error:'That project is not in your cloud.'}};
  return{status:200,body:{name:projects.find(p=>p.project_id===project)?.name,files:await Promise.all(files.map(async f=>({...f,url:await presign('GET',objectKey(user,project,f.path),r2,6*3600,options.now)})))}};
 }
 if(action==='cloud-delete'){
  const files=await ports.files(user,project);await removeObjects(user,project,files.map(f=>f.path),r2,options.fetcher??fetch,options.now);await ports.save(user,project,null);
  return{status:200,body:{deleted:true}};
 }
 return{status:404,body:{error:'Unknown cloud action.'}};
}
async function removeObjects(user:string,project:string,paths:string[],r2:R2,fetcher:typeof fetch,now?:Date){
 for(let n=0;n<paths.length;n+=8)await Promise.all(paths.slice(n,n+8).map(async path=>{const response=await fetcher(await presign('DELETE',objectKey(user,project,path),r2,600,now),{method:'DELETE'});if(!response.ok&&response.status!==404)throw new Error(`Storage answered ${response.status} removing ${path}.`);}));
}

export function r2Config(env:(name:string)=>string|undefined):R2|undefined{
 const accountId=env('R2_ACCOUNT_ID'),accessKeyId=env('R2_ACCESS_KEY_ID'),secretAccessKey=env('R2_SECRET_ACCESS_KEY'),bucket=env('R2_BUCKET');
 return accountId&&accessKeyId&&secretAccessKey&&bucket?{accountId,accessKeyId,secretAccessKey,bucket}:undefined;
}
export function supabaseCloudPorts(db:any):CloudPorts{
 const check=({data,error}:{data:any;error:any})=>{if(error)throw new Error(error.message);return data;};
 return{
  projects:async user=>check(await db.from('dream_cloud_projects').select('project_id,name,size_bytes,files,updated_at,device').eq('account_id',user).order('updated_at',{ascending:false}))??[],
  files:async(user,project)=>(check(await db.from('dream_cloud_files').select('path,size,sha256').eq('account_id',user).eq('project_id',project))??[]).map((f:any)=>({path:f.path,size:Number(f.size),sha256:f.sha256})),
  save:async(user,project,entry)=>{check(await db.rpc('dream_cloud_save',{p_account:user,p_project:project,p_entry:entry}));},
 };
}
