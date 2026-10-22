import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import type {ForgeMakeResult} from '@electron-forge/shared-types';
import {signingWindows,signWindowsFile} from './sign-windows';

/** Squirrel's legacy resource writer may exit successfully with an empty bootstrap for large payloads. */
export async function finalizeInstallers(results:ForgeMakeResult[]){
 if(process.platform!=='win32')return results;
 for(const result of results){
  const archive=result.artifacts.find(path=>path.endsWith('-full.nupkg'));
  const setup=result.artifacts.find(path=>/Setup\.exe$/i.test(path));
  if(!archive||!setup)continue;
  const shell=join(process.env.SystemRoot??'C:\\Windows',process.arch==='ia32'?'Sysnative':'System32','WindowsPowerShell/v1.0/powershell.exe');
  await promisify(execFile)(shell,['-NoProfile','-ExecutionPolicy','Bypass','-File',join(__dirname,'../../scripts/finalize-windows-installer.ps1'),'-BootstrapPath',setup,'-PackagePath',archive,'-OutputPath',setup],{windowsHide:true,maxBuffer:1024*1024});
  // Signed last: embedding the payload rewrites the file, which would void an earlier signature.
  if(signingWindows())signWindowsFile(setup);
 }
 return results;
}
