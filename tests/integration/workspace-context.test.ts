import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {WorkspaceIndex} from '../../packages/project-db/src/workspace-index';
import {workspacePath} from '../../packages/project-db/src/workspace-store';
it('indexes changed authored boundaries and removes deleted/renamed chunks without indexing dependencies',()=>{const root=mkdtempSync(join(tmpdir(),'dream-index-')),db=new ProjectDB(root),ws=join(root,'Workspace');try{mkdirSync(join(ws,'src'),{recursive:true});mkdirSync(join(ws,'node_modules'));writeFileSync(join(ws,'src/scene.ts'),'export const elegantOpening = 1;');writeFileSync(join(ws,'node_modules/private.js'),'elegant dependency');const index=new WorkspaceIndex(db,ws);expect(index.search('elegant').hits).toHaveLength(1);renameSync(join(ws,'src/scene.ts'),join(ws,'src/opening.ts'));expect(index.search('elegant').hits[0].path).toBe('src/opening.ts');unlinkSync(join(ws,'src/opening.ts'));expect(index.search('elegant').hits).toHaveLength(0);expect(()=>workspacePath(ws,'../.dream/project.sqlite')).toThrow('outside');}finally{db.close();}});
