/** Prints the edit map the agent gets for a project (packages/orchestrator/src/timeline-outline.ts), from a copy of its
 * database, so a project that is open in Gumbo is never touched.
 *
 *   pnpm exec tsx scripts/edit-map-preview.ts "C:/Users/you/Documents/Dream/Projects/<id>"
 */
import {mkdtempSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
import {timelineOutline,editMap,outlineCut} from '../packages/orchestrator/src/timeline-outline';

const folder=process.argv[2];if(!folder){console.error('Give a project folder.');process.exit(1);}
const copy=mkdtempSync(join(tmpdir(),'gumbo-edit-map-'));mkdirSync(join(copy,'.dream'));
for(const file of ['project.sqlite','project.sqlite-wal','project.sqlite-shm'])if(existsSync(join(folder,'.dream',file)))copyFileSync(join(folder,'.dream',file),join(copy,'.dream',file));
const db=new ProjectDB(copy,'Preview');
try{
 const t=db.timeline(),footage=db.footage(),outline=timelineOutline(t,footage,40),map=editMap(t,footage);
 console.log(JSON.stringify({outlineCut:outlineCut(t,footage),outlineLines:outline.lines.length,editMapChars:JSON.stringify(map).length},null,1));
 console.log(JSON.stringify(map,null,1));
}finally{db.close();}
