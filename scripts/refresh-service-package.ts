/** Incremental service-only packaging. Main/renderer changes still require Forge. */
import {build} from 'esbuild';
import {extractAll,createPackageWithOptions} from '@electron/asar';
import {mkdirSync,copyFileSync,renameSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const target=resolve(process.argv[2]??'artifacts/code-agent-package/Dream-win32-x64'),resources=join(target,'resources'),archive=join(resources,'app.asar'),stage=resolve('artifacts/service-package-'+Date.now());
mkdirSync(stage,{recursive:true});extractAll(archive,stage);
await build({entryPoints:['apps/project-service/src/main.ts'],outfile:join(stage,'.vite/build/service.js'),bundle:true,platform:'node',format:'cjs',target:'node24',tsconfig:'tsconfig.json',sourcemap:true,external:['electron','better-sqlite3','sqlite-vec','ffmpeg-static','ffprobe-static']});
const updated=join(resources,'app.updated.asar');await createPackageWithOptions(stage,updated,{unpackDir:'node_modules'});renameSync(updated,archive);
mkdirSync(join(resources,'notices','dotnet'),{recursive:true});for(const file of ['LICENSE.txt','ThirdPartyNotices.txt'])copyFileSync(join('apps/desktop/resources/notices/dotnet',file),join(resources,'notices/dotnet',file));
const report={package:target,scope:'project-service',appAsarSha256:createHash('sha256').update(readFileSync(archive)).digest('hex'),builtAt:new Date().toISOString()};writeFileSync('artifacts/service-package-refresh.json',JSON.stringify(report,null,2));console.log(report);
