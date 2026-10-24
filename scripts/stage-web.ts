/** Stages usegumbo.app for a deploy: the website (sign-in-site) with Gumbo's web app built into /app.
 * The folder is a git-free copy outside the repo, since Vercel will not build a deploy from this repo's git author:
 *   npx tsx scripts/stage-web.ts [out]      (default: <temp>/gumbo-site)
 *   cd <out> && npx vercel deploy --prod --yes
 * The app is built in production mode (no local stand-ins for Supabase and the gateway) with the public Supabase
 * address and anon key the sign-in page already uses. */
import {execSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,readFileSync,readdirSync,rmSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

const repo=resolve(import.meta.dirname,'..'),site=join(repo,'sign-in-site'),dist=join(repo,'apps/web/dist');
const out=resolve(process.argv[2]??join(tmpdir(),'gumbo-site'));
if(out.startsWith(repo))throw new Error('Stage outside the repo: Vercel reads the git author from any folder inside it.');

const signin=readFileSync(join(site,'signin/index.html'),'utf8');
const url=/const SUPABASE='([^']+)'/.exec(signin)?.[1],anonKey=/const ANON='([^']+)'/.exec(signin)?.[1];
if(!url||!anonKey)throw new Error('The sign-in page no longer names the Supabase address and anon key.');

const run=(command:string,env:Record<string,string>={})=>execSync(command,{cwd:repo,stdio:'inherit',env:{...process.env,...env}});
// The scene engine's runtime, which the app's build copies in, then the app.
run('npx tsx scripts/build-engine.ts');
run('pnpm --filter @dream/web exec vite build --mode production',{DREAM_SUPABASE_URL:url,DREAM_SUPABASE_ANON_KEY:anonKey});

const built=readFileSync(join(dist,'index.html'),'utf8');
if(/127\.0\.0\.1|localhost/.test(built))throw new Error('The built page still allows local servers.');
if(!existsSync(join(dist,'engine/host.html'))||!existsSync(join(dist,'sw.js')))throw new Error('The build is missing the scene page or the service worker.');

// A tab opened before a deploy still loads its build's own chunks and workers by their hashed names (the sandbox worker
// when Roux first runs a command or after a restart, the editor's lazy parts). A deploy that dropped them broke that
// tab: on October 24 every command failed after a deploy until the page was reloaded. So each deploy carries the
// hashed assets of the builds deployed in the last two weeks, kept here between deploys.
const kept=join(tmpdir(),'gumbo-site-assets'),KEEP_MS=14*86_400_000;mkdirSync(kept,{recursive:true});
if(existsSync(join(out,'app','assets')))cpSync(join(out,'app','assets'),kept,{recursive:true,preserveTimestamps:true,force:false});
for(const name of readdirSync(kept))if(Date.now()-statSync(join(kept,name)).mtimeMs>KEEP_MS)rmSync(join(kept,name),{force:true});
rmSync(out,{recursive:true,force:true});
cpSync(site,out,{recursive:true,filter:source=>!/[\\/](\.git|node_modules)([\\/]|$)/.test(source)});
cpSync(dist,join(out,'app'),{recursive:true});
const current=new Set(readdirSync(join(out,'app','assets'))),earlier=readdirSync(kept).filter(name=>!current.has(name));
for(const name of earlier)cpSync(join(kept,name),join(out,'app','assets',name),{preserveTimestamps:true});
cpSync(join(out,'app','assets'),kept,{recursive:true,preserveTimestamps:true,force:false});

// Vercel refuses single files over 100 MB; report the biggest so a growing model or wasm is noticed early.
const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);
const sizes=files(join(out,'app')).map(file=>({file:file.slice(out.length+1),size:statSync(file).size})).sort((a,b)=>b.size-a.size);
const mb=(n:number)=>(n/1048576).toFixed(1)+' MB';
if(sizes[0].size>100*1048576)throw new Error(`${sizes[0].file} is over Vercel's 100 MB file limit.`);
console.log(`\nStaged ${out} (keeping ${earlier.length} files of earlier builds for tabs still open)\n app: ${sizes.length} files, ${mb(sizes.reduce((sum,f)=>sum+f.size,0))}; largest ${sizes.slice(0,3).map(f=>`${f.file} ${mb(f.size)}`).join(', ')}`);
console.log(` deploy: cd "${out}" && npx vercel deploy --prod --yes`);
