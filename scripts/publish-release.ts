/** Publishes the Windows build from `pnpm make` as a GitHub release of YuanchengLi2/gumbo-releases, the public repo the
 * installed app updates from (apps/desktop/src/main/updates.ts reads .../releases/latest/download). It uploads Squirrel's
 * RELEASES list, the full package (and a delta when the build made one) and the installer as Gumbo-Setup.exe, so the
 * download link https://github.com/YuanchengLi2/gumbo-releases/releases/latest/download/Gumbo-Setup.exe always serves the
 * newest version. Without --yes it only checks the build and says what it would publish.
 *
 *   pnpm exec tsx scripts/publish-release.ts [--notes "What changed"] [--yes]
 *
 * Every release needs a higher version in apps/desktop/package.json than the one before: installed apps only take newer.
 * Build it with DREAM_WINDOWS_SIGN=1 (signed as the gumbo-signing account's certificate; --unsigned skips the check) and
 * DREAM_RELEASE_FROM=https://github.com/YuanchengLi2/gumbo-releases/releases/latest/download so it also
 * carries a delta package: an installed app then downloads only what changed (a few MB) instead of the whole app.
 * RELEASES is published with each package's full address (its own release's download link), so an app several versions
 * behind still finds every delta it needs although latest/download serves only the newest release's files.
 */
import {readFileSync,existsSync,readdirSync,copyFileSync,mkdtempSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';

const repo='YuanchengLi2/gumbo-releases',feed=`https://github.com/${repo}/releases/latest/download`;
const args=process.argv.slice(2),publish=args.includes('--yes'),notesAt=args.indexOf('--notes'),notes=notesAt>=0?args[notesAt+1]??'':'';
const version=JSON.parse(readFileSync('apps/desktop/package.json','utf8')).version as string;
const made='apps/desktop/out/make/squirrel.windows/x64',packaged='apps/desktop/out/Dream-win32-x64/resources/staged/cloud.json';
const fail=(message:string)=>{console.error(message);process.exit(1);};
/** Each RELEASES line (sha1, file, size) with the file's address in the release of its version. */
export const absoluteReleases=(text:string)=>text.split(/\r?\n/).filter(Boolean).map(line=>{const [sha,file,size]=line.trim().split(/\s+/);const version=/^Dream-(\d+\.\d+\.\d+)-(full|delta)\.nupkg$/.exec(file)?.[1];return`${sha} ${version?`https://github.com/${repo}/releases/download/v${version}/${file}`:file} ${size}`;}).join('\n')+'\n';

// The build must be this version, and must know where to update from, or the people who install it are stuck on it.
const setup=join(made,`Dream-${version} Setup.exe`),full=join(made,`Dream-${version}-full.nupkg`),list=join(made,'RELEASES');
for(const file of [setup,full,list])if(!existsSync(file))fail(`Missing ${file}. Run pnpm make for version ${version} first.`);
if(!readFileSync(list,'utf8').includes(`Dream-${version}-full.nupkg`))fail(`RELEASES does not list version ${version}.`);
const cloud=existsSync(packaged)?JSON.parse(readFileSync(packaged,'utf8')):{};
if(cloud.updates!==feed)fail(`The packaged app updates from ${cloud.updates??'nowhere'}, not ${feed}. Set DREAM_UPDATE_URL=${feed} in .env.local, run scripts/prepare-package.ts, and build again.`);
// Unsigned, Windows warns everyone who downloads it ("Unknown publisher"): build with DREAM_WINDOWS_SIGN=1 (sign-windows.ts).
for(const file of [setup,'apps/desktop/out/Dream-win32-x64/Dream.exe']){
 const status=execFileSync('powershell',['-NoProfile','-Command',`(Get-AuthenticodeSignature -LiteralPath '${file}').Status`],{encoding:'utf8'}).trim();
 if(status!=='Valid'&&!args.includes('--unsigned'))fail(`${file} is not signed (${status}). Build with DREAM_WINDOWS_SIGN=1, or pass --unsigned.`);
}
const deltas=readdirSync(made).filter(name=>name===`Dream-${version}-delta.nupkg`).map(name=>join(made,name));

const staging=mkdtempSync(join(tmpdir(),'gumbo-release-')),installer=join(staging,'Gumbo-Setup.exe');copyFileSync(setup,installer);
const released=join(staging,'RELEASES');writeFileSync(released,absoluteReleases(readFileSync(list,'utf8')));
const files=[released,full,...deltas,installer];
console.log(`Gumbo ${version} -> ${repo} (tag v${version})`);
for(const file of files)console.log(`  ${file.split(/[\\/]/).pop()}  ${(statSync(file).size/1e6).toFixed(0)} MB`);
if(!publish){console.log('Checked. Run again with --yes to publish.');process.exit(0);}
execFileSync('gh',['release','create',`v${version}`,'--repo',repo,'--title',`Gumbo ${version}`,'--notes',notes||`Gumbo ${version}`,...files],{stdio:'inherit'});
console.log(`Published. Installer: ${feed}/Gumbo-Setup.exe`);
