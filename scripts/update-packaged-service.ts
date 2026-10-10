import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {aliases} from '../apps/desktop/vite.shared';

// Update one compiled file while retaining the verified runtime and unpacked
// dependencies. Preserve a recoverable archive and verify all unchanged bytes.
const root=resolve('apps/desktop/out/context-fix/Dream-win32-x64'),archive=join(root,'resources/app.asar'),out=resolve('artifacts/agent-audit-package/service.js');
mkdirSync(dirname(out),{recursive:true});
await build({entryPoints:[resolve('apps/project-service/src/main.ts')],outfile:out,bundle:true,platform:'node',format:'cjs',target:'node24',minify:true,alias:aliases,external:['electron','better-sqlite3','sqlite-vec','ffmpeg-static','ffprobe-static']});
const require=createRequire(resolve('apps/desktop/package.json')),asar=require('@electron/asar'),asarLib=dirname(require.resolve('@electron/asar'));
const {Pickle}=await import(pathToFileURL(join(asarLib,'pickle.js')).href),{getFileIntegrityFromBuffer}=await import(pathToFileURL(join(asarLib,'integrity.js')).href);
const original=readFileSync(archive),raw=asar.getRawHeader(archive),body=original.subarray(8+raw.headerSize),replacement=readFileSync(out),header=structuredClone(raw.header);
const entry=header.files['.vite'].files.build.files['service.js'];
if(!entry||entry.unpacked)throw new Error('Expected a packed project service.');
entry.offset=String(body.length);entry.size=replacement.length;entry.integrity=getFileIntegrityFromBuffer(replacement);
const headerPickle=Pickle.createEmpty();headerPickle.writeString(JSON.stringify(header));const headerBytes=headerPickle.toBuffer(),sizePickle=Pickle.createEmpty();sizePickle.writeUInt32(headerBytes.length);
const pending=join(root,'resources/app.audit-service.asar');writeFileSync(pending,Buffer.concat([sizePickle.toBuffer(),headerBytes,body,replacement]));
const hash=(value:Buffer)=>createHash('sha256').update(value).digest('hex');let unchanged=0;
for(const path of asar.listPackage(archive).map((p:string)=>p.replace(/^\\/,''))){const before=asar.statFile(archive,path),after=asar.statFile(pending,path);if(path==='.vite\\build\\service.js')continue;if(before.files){if(JSON.stringify(Object.keys(before.files))!==JSON.stringify(Object.keys(after.files??{})))throw new Error('Package directory entries differ: '+path);continue;}if(before.unpacked||before.link){if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Unchanged package metadata differs: '+path);continue;}if(hash(asar.extractFile(archive,path))!==hash(asar.extractFile(pending,path)))throw new Error('Unchanged package file differs: '+path);unchanged++;}
if(hash(asar.extractFile(pending,'.vite\\build\\service.js'))!==hash(replacement))throw new Error('Updated service does not match its source build.');
const backup=join(root,'resources/app.before-completion-fix.asar');if(existsSync(backup))throw new Error('Preserve the existing update backup before updating again.');
renameSync(archive,backup);try{renameSync(pending,archive);}catch(error){renameSync(backup,archive);throw error;}
console.log(JSON.stringify({updated:true,unchangedPackedFilesVerified:unchanged,serviceHash:hash(replacement),backup}));
