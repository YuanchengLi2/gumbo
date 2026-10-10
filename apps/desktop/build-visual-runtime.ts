import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
export async function stageVisualRuntime(){const creation=resolve(__dirname,'resources/staged/creation');if(process.platform==='win32'){const manifest=join(creation,'manifest.json'),qualification=join(creation,'qualification.json');if(!existsSync(manifest)||!existsSync(qualification))throw new Error('Stage and qualify the creation runtime before packaging.');const proof=JSON.parse(readFileSync(qualification,'utf8'));if(!proof.passed||proof.manifestHash!==createHash('sha256').update(readFileSync(manifest)).digest('hex'))throw new Error('Creation runtime qualification is stale.');}const root=resolve(__dirname,'../..'),require=createRequire(join(__dirname,'package.json'));for(const script of ['stage-shared-libraries.ts','build-sandbox.ts','build-engine.ts','build-remotion.ts'])await promisify(execFile)(process.execPath,[require.resolve('tsx/cli'),join(root,'scripts',script)],{cwd:root,windowsHide:true,timeout:120000});}
