import {execFileSync} from 'node:child_process';
import {existsSync,readdirSync} from 'node:fs';
import {delimiter,join} from 'node:path';

/** Signs Gumbo's Windows executables with Artifact Signing (Azure): the gumbo-signing account's "gumbo" Public Trust
 * profile (artifact-signing.json), so Windows shows a verified publisher instead of "Unknown publisher". Only release builds
 * sign (DREAM_WINDOWS_SIGN=1): each signature counts against the account's monthly quota, and signing needs an `az login`
 * to the account's tenant. scripts/setup-windows-signing.ps1 installs the tools into DREAM_SIGN_TOOLS
 * (default %LOCALAPPDATA%\GumboSigning) and signs in. */
export const signingWindows=()=>process.platform==='win32'&&process.env.DREAM_WINDOWS_SIGN==='1';
export const signingTools=()=>process.env.DREAM_SIGN_TOOLS??join(process.env.LOCALAPPDATA??'','GumboSigning');

function signtool(){
 const kits=join(process.env['ProgramFiles(x86)']??'C:\\Program Files (x86)','Windows Kits','10','bin');
 const versions=existsSync(kits)?readdirSync(kits).filter(name=>existsSync(join(kits,name,'x64','signtool.exe'))).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})):[];
 if(!versions.length)throw new Error('signtool.exe not found: install the Windows SDK.');
 return join(kits,versions.at(-1)!,'x64','signtool.exe');
}

export function signWindowsFile(file:string){
 const tools=signingTools(),dlib=join(tools,'client','bin','x64','Azure.CodeSigning.Dlib.dll');
 if(!existsSync(dlib))throw new Error(`The Artifact Signing client is missing (${dlib}): run scripts/setup-windows-signing.ps1.`);
 // The client runs on .NET 8 and signs in through the Azure CLI, both installed per user next to it.
 const env={...process.env,DOTNET_ROOT:join(tools,'dotnet'),PATH:[join(tools,'az','bin'),process.env.PATH].join(delimiter)};
 execFileSync(signtool(),['sign','/v','/fd','SHA256','/tr','http://timestamp.acs.microsoft.com','/td','SHA256','/dlib',dlib,'/dmdf',join(__dirname,'artifact-signing.json'),file],{stdio:'inherit',env});
}
