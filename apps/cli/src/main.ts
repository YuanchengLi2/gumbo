import {ProjectDB} from '@dream/project-db';
import {resolve,OpSchema} from '@dream/timeline';
import {readFileSync,existsSync,unlinkSync} from 'node:fs';
import {resolve as absolute,join} from 'node:path';
import {acquireProjectLock} from '../../project-service/src/locks';

const [action,folder,argument]=process.argv.slice(2);
if(!folder||!['inspect','apply','undo','redo','restore','backup'].includes(action))throw new Error('Usage: pnpm cli <inspect|apply|undo|redo|restore|backup> <project folder> [argument]');
const projectFolder=absolute(folder);
if(!existsSync(join(projectFolder,'Project.dreamproj')))throw new Error('Select an existing Dream project folder.');
// CLI database access follows the same single-writer ownership as the desktop service.
const lock=acquireProjectLock(projectFolder);let db:ProjectDB|undefined;
try{
 db=new ProjectDB(projectFolder);
 if(action==='inspect'){const s=db.state();console.log(JSON.stringify({project:s.meta,version:s.versionId,durationSec:resolve(s.timeline,s.footage).durationSec,assets:s.footage.assets.length,jobs:s.jobs,versions:s.versions.length},null,2));}
 else if(action==='apply'){
  if(!argument)throw new Error('Pass the path to an operation batch JSON file.');
  const batch=JSON.parse(readFileSync(argument,'utf8'));
  if(typeof batch.requestId!=='string'||!batch.requestId||typeof batch.expectedVersionId!=='string'||typeof batch.label!=='string'||!Array.isArray(batch.ops))throw new Error('An operation batch needs requestId, expectedVersionId, label, and ops.');
  console.log(db.apply(batch.ops.map((op:unknown)=>OpSchema.parse(op)),batch.label,batch.requestId,batch.expectedVersionId,batch.turnId));
 }
 else if(action==='undo')db.undo();
 else if(action==='redo')db.undo(true);
 else if(action==='restore'){if(!argument)throw new Error('Pass a version ID.');db.restore(argument);}
 else if(action==='backup'){if(!argument)throw new Error('Pass a backup destination.');await db.backup(argument);}
}finally{db?.close();unlinkSync(lock);}
