/** Builds the extension into dist/ (load it unpacked from there): the service worker as an ES module, the content
 * scripts as small classic scripts (no framework in every frame), the React pages, and the static files.
 *   pnpm --filter @dream/extension build          once
 *   pnpm --filter @dream/extension dev            rebuild on every change */
import {context,build,type BuildOptions} from 'esbuild';
import {cpSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'dist'),watch=process.argv.includes('--watch');
const common:BuildOptions={bundle:true,target:'chrome120',sourcemap:'linked',logLevel:'info',outdir:out,define:{'process.env.NODE_ENV':'"production"'},jsx:'automatic',legalComments:'none'};
const pages=['popup','welcome','sidepanel','offscreen','card'].filter(name=>existsSync(join(root,'src',name,'main.tsx'))||existsSync(join(root,'src',name,'main.ts')));
const entry=(name:string)=>existsSync(join(root,'src',name,'main.tsx'))?join(root,'src',name,'main.tsx'):join(root,'src',name,'main.ts');
const builds:BuildOptions[]=[
 {...common,format:'esm',entryPoints:{background:join(root,'src/background/index.ts')}},
 {...common,format:'iife',entryPoints:{content:join(root,'src/content/index.ts'),signin:join(root,'src/content/signin.ts')}},
 {...common,format:'esm',minify:!watch,entryPoints:Object.fromEntries(pages.map(name=>[name,entry(name)])),loader:{'.woff2':'file','.svg':'file'}},
 ...(existsSync(join(root,'src/offscreen/workers'))?[{...common,format:'esm' as const,entryPoints:Object.fromEntries(readdirSync(join(root,'src/offscreen/workers')).filter(f=>f.endsWith('.ts')).map(f=>[f.replace(/\.ts$/,''),join(root,'src/offscreen/workers',f)]))}]:[]),
];
function statics(){
 mkdirSync(out,{recursive:true});
 const manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8'));manifest.version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
 writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,1));
 for(const name of pages){const html=join(root,'src',name,`${name}.html`);if(existsSync(html))cpSync(html,join(out,`${name}.html`));}
 if(existsSync(join(root,'public')))cpSync(join(root,'public'),out,{recursive:true});
}
if(!watch)rmSync(out,{recursive:true,force:true});
statics();
if(watch){for(const options of builds)await (await context(options)).watch();console.log('Watching; reload the extension in chrome://extensions after a change to the service worker.');}
else await Promise.all(builds.map(options=>build(options)));
