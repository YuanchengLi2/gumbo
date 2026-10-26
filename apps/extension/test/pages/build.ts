/** Bundles the editor test pages' scripts (test/pages/src) into test/pages/build for the end-to-end tests, with one page
 * per editor (build/<name>.html). Run by the end-to-end setup; by hand: npx tsx apps/extension/test/pages/build.ts */
import {build} from 'esbuild';
import {readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,basename,extname} from 'node:path';
const here=import.meta.dirname;
export async function buildPages(){
 const sources=readdirSync(resolve(here,'src'));mkdirSync(resolve(here,'build'),{recursive:true});
 for(const file of sources){
  const name=basename(file,extname(file));
  writeFileSync(resolve(here,'build',`${name}.html`),`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name}</title><link rel="stylesheet" href="../style.css"><link rel="stylesheet" href="${name}.css"></head><body>\n<h1>${name}</h1><div id="editor" class="editor"></div><script src="${name}.js"></script>\n</body></html>\n`);
 }
 const options={bundle:true,outdir:resolve(here,'build'),format:'iife' as const,target:'chrome120',jsx:'automatic' as const,logLevel:'warning' as const,
  loader:{'.ttf':'file','.woff':'file','.woff2':'file','.svg':'file','.png':'file'} as const,define:{'process.env.NODE_ENV':'"production"',global:'window'}};
 // Draft.js needs React 18 (it uses findDOMNode, which React 19 removed), as the sites that still use it do.
 const draft=sources.filter(f=>f.startsWith('draft.'));
 await Promise.all([
  build({...options,entryPoints:sources.filter(f=>!draft.includes(f)).map(f=>resolve(here,'src',f))}),
  build({...options,entryPoints:draft.map(f=>resolve(here,'src',f)),alias:{react:'react18','react-dom':'react-dom18'}}),
 ]);
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(here,'build.ts'))await buildPages();
