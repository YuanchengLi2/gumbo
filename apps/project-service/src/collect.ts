import {ProjectDB} from '@dream/project-db';
import {authoredFiles,workspacePath} from '../../../packages/project-db/src/workspace-store';
import {hydrateAsset} from '../../../packages/project-db/src/paths';
import {AssetSchema} from '@dream/footage';
import {randomUUID} from 'node:crypto';
import {mkdir,readdir,copyFile,rename,rm,rmdir,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,relative,isAbsolute,join,dirname,basename} from 'node:path';

function inside(parent:string,path:string){const rel=relative(parent,path);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..\\')&&!rel.startsWith('../');}
export async function collectProject(source:ProjectDB,folder:string){
 const destination=resolve(folder),sourceRoot=resolve(source.folder);
 if(inside(sourceRoot,destination)||inside(destination,sourceRoot))throw new Error('Choose an empty folder outside the current project.');
 if(existsSync(destination)&&(await readdir(destination)).length)throw new Error('Collect requires an empty destination folder.');
 const staging=join(dirname(destination),`.dream-collect-${randomUUID()}`);
 let collected:ProjectDB|undefined;
 try{
  await mkdir(join(staging,'.dream'),{recursive:true});
  await source.backup(join(staging,'.dream','project.sqlite'));
  for(const row of source.db.prepare("SELECT json FROM library WHERE kind='visual_revision'").all() as {json:string}[]){const revision=JSON.parse(row.json);for(const hash of Object.values(revision.definition?.source?.modules??{}))source.blobs.get(String(hash));}
  await copyFile(join(sourceRoot,'Project.dreamproj'),join(staging,'Project.dreamproj'));
  for(const file of authoredFiles(join(sourceRoot,'Workspace'))){const target=workspacePath(join(staging,'Workspace'),file);await mkdir(dirname(target),{recursive:true});await copyFile(workspacePath(join(sourceRoot,'Workspace'),file),target);}
  collected=new ProjectDB(staging);
  // Resolve the immutable backup's references against the source project, not
  // the live database, which may acquire more imports while copying proceeds.
  const assets=(collected.db.prepare('SELECT json FROM assets').all() as {json:string}[]).map(row=>hydrateAsset(AssetSchema.parse(JSON.parse(row.json)),sourceRoot));
  const pathMap=new Map<string,string>();
  for(const asset of assets){
   if(!existsSync(asset.originalPath))throw new Error(`Relink ${asset.filename} before collecting.`);
   if(asset.sequence){const target=join(staging,'Media/Generated',asset.sequence.revisionId);await mkdir(target,{recursive:true});for(let n=0;n<asset.sequence.frameCount;n++){const filename=`${String(n).padStart(6,'0')}.png`,input=join(asset.sequence.directory,filename),output=join(target,filename);await copyFile(input,output);if((await stat(input)).size!==(await stat(output)).size)throw new Error(`Sequence copy failed for ${asset.filename}.`);}const manifest=join(asset.sequence.directory,'manifest.json');if(existsSync(manifest))await copyFile(manifest,join(target,'manifest.json'));asset.sequence={...asset.sequence,directory:target};asset.originalPath=join(target,'000000.png');asset.thumbnailPath=asset.originalPath;collected.saveAsset(asset);continue;}
   for(const field of ['originalPath','proxyPath','previewPath','thumbnailPath','audioPath'] as const){
    const path=asset[field];if(!path||!existsSync(path))continue;
    const target=join(staging,field==='originalPath'?'Media/Originals':field==='proxyPath'||field==='previewPath'?'Media/Proxies':'Media/Analysis',asset.id,basename(path));
    await mkdir(dirname(target),{recursive:true});await copyFile(path,target);
    if((await stat(path)).size!==(await stat(target)).size)throw new Error(`Copy verification failed for ${asset.filename}.`);
    pathMap.set(path,target);asset[field]=target;
   }
   collected.saveAsset(asset);
  }
  const shots=collected.footage().shots.map(shot=>({...shot,framePaths:shot.framePaths.flatMap(path=>pathMap.has(path)?[`project:${relative(staging,pathMap.get(path)!).replaceAll('\\','/')}`]:[])}));
  collected.saveRecords('shots',shots);collected.close();collected=undefined;
  if(existsSync(destination))await rmdir(destination);
  await rename(staging,destination);return {folder:destination};
 }finally{
  collected?.close();
  // This path is freshly generated within the chosen destination's parent.
  if(inside(dirname(destination),staging)&&basename(staging).startsWith('.dream-collect-'))await rm(staging,{recursive:true,force:true});
 }
}
