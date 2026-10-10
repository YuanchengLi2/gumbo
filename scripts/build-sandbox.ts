import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve('artifacts/sandbox-sources');await mkdir(root,{recursive:true});
const reactExports=Object.keys(createRequire(import.meta.url)('react')).filter(key=>/^[A-Za-z][A-Za-z0-9]*$/.test(key)&&key!=='default').join(',');
for(const [name,code] of Object.entries({'react':`export {${reactExports}} from 'react';export {default} from 'react';`,'jsx-runtime':"export {jsx,jsxs,Fragment} from 'react/jsx-runtime';",'remotion':"export * from 'remotion';"}))await writeFile(resolve(root,`${name}.js`),code);
await build({entryPoints:{entry:'apps/desktop/src/sandbox/entry.tsx',react:resolve(root,'react.js'),'jsx-runtime':resolve(root,'jsx-runtime.js'),remotion:resolve(root,'remotion.js')},outdir:'apps/desktop/resources/staged/sandbox',bundle:true,splitting:true,format:'esm',platform:'browser',target:'chrome144',define:{'process.env.NODE_ENV':'"production"'},external:['../component.js'],minify:true});
console.log('Isolated visual runtime staged.');
