/** Builds the scene engine runtime: one minified IIFE per chunk, the bundled fonts and a manifest with hashes.
 * Output: apps/desktop/resources/staged/engine/<version>/ (shipped with the app as an extra resource). */
import {build,type Plugin} from 'esbuild';
import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {ENGINE_VERSION} from '../packages/scene-engine/src/protocol';
import {CHUNKS,MODULES} from '../packages/scene-engine/src/modules';
import {dreamModulesPlugin} from '../packages/scene-engine/src/esbuild-plugin';

import {engineReferenceModule} from './build-engine-reference';
writeFileSync(resolve('packages/scene-engine/src/reference.generated.ts'),engineReferenceModule(readFileSync(resolve('packages/scene-engine/reference/api.md'),'utf8')));
const root=resolve('packages/scene-engine'),out=resolve(process.argv[2]??`apps/desktop/resources/staged/engine/${ENGINE_VERSION}`);
const require=createRequire(join(root,'package.json'));
rmSync(out,{recursive:true,force:true});mkdirSync(join(out,'fonts'),{recursive:true});

// Modules the core chunk owns. Other chunks require them at runtime instead of bundling a second copy.
const coreOwned=new Set(['react','react/jsx-runtime','react-dom','@dream/engine']);
const shared=(chunk:string):Plugin[]=>chunk==='core'?[]:[
 dreamModulesPlugin({provided:name=>name==='remotion'?'__remotion':coreOwned.has(name)?name:undefined}),
 // Engine internals (pending work, configuration) are shared module state and must also come from core.
 {name:'engine-internals',setup(b){b.onResolve({filter:/^\.\.?\/(?:\.\.\/)?(pending|config)$/},args=>({path:'__engine/'+args.path.split('/').pop(),namespace:'dream-module'}));}},
];

const files:Record<string,{sha256:string;size:number}>={};
const record=(name:string)=>{const bytes=readFileSync(join(out,name));files[name]={sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};};
for(const chunk of CHUNKS){
 await build({entryPoints:[join(root,`src/runtime/chunks/${chunk}.ts`)],outfile:join(out,`${chunk}.js`),bundle:true,format:'iife',platform:'browser',target:'chrome130',minify:true,legalComments:'eof',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:shared(chunk),logLevel:'warning'});
 record(`${chunk}.js`);
}

// Fonts: latin subsets of the bundled OFL families, weights 400 and 700 where published. Inter also ships a .woff,
// which 3D text (troika) can read.
const families:[string,string,number[]][]=[['inter','Inter',[400,700,900]],['roboto','Roboto',[400,700]],['montserrat','Montserrat',[400,700,900]],['poppins','Poppins',[400,700]],['oswald','Oswald',[400,700]],['bebas-neue','Bebas Neue',[400]],['playfair-display','Playfair Display',[400,700]],['lora','Lora',[400,700]],['space-grotesk','Space Grotesk',[400,700]],['jetbrains-mono','JetBrains Mono',[400,700]],['press-start-2p','Press Start 2P',[400]]];
let css='';
for(const [id,family,weights] of families){
 const folder=join(dirname(require.resolve(`@fontsource/${id}/package.json`)),'files');
 for(const weight of weights)for(const style of ['normal','italic']){
  const base=`${id}-latin-${weight}-${style}`;if(!existsSync(join(folder,base+'.woff2')))continue;
  copyFileSync(join(folder,base+'.woff2'),join(out,'fonts',base+'.woff2'));record(`fonts/${base}.woff2`);
  if(id==='inter'&&weight===400&&style==='normal'){copyFileSync(join(folder,base+'.woff'),join(out,'fonts',base+'.woff'));record(`fonts/${base}.woff`);}
  css+=`@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:block;src:url(fonts/${base}.woff2) format('woff2')}\n`;
 }
}
writeFileSync(join(out,'fonts.css'),css);record('fonts.css');
writeFileSync(join(out,'manifest.json'),JSON.stringify({version:ENGINE_VERSION,builtAt:new Date().toISOString(),modules:MODULES,files},null,2));
const total=Object.values(files).reduce((n,f)=>n+f.size,0);
console.log(`Scene engine ${ENGINE_VERSION}: ${Object.keys(files).length} files, ${(total/1024/1024).toFixed(2)} MB → ${out}`);
for(const chunk of CHUNKS)console.log(`  ${chunk}.js ${(files[chunk+'.js'].size/1024).toFixed(0)} KB`);
