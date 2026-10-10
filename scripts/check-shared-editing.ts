import {bundleScene} from '../apps/project-service/src/bundle-scene';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {CodeRuntime} from '../apps/desktop/src/main/code-runtime';
const staged=resolve('apps/desktop/resources/staged'),runtime=new CodeRuntime({creation:join(staged,'creation'),ffmpeg:'',ffprobe:'',browser:''});
try{for(let n=0;n<2;n++){
 const root=join(mkdtempSync(join(tmpdir(),'dream-shared-editing-')),'Workspace');mkdirSync(join(root,'src'),{recursive:true});
 writeFileSync(join(root,'package.json'),JSON.stringify({type:'module'}));
 writeFileSync(join(root,'src/check.mjs'),`import React from 'react';import * as THREE from 'three';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const sharp=require('sharp');if(!React.version||!THREE.REVISION||!sharp.versions)throw Error('Shared library resolution failed');console.log('Shared Node libraries ready');`);
 const result=await runtime.run({id:'shared'+n,projectId:'check',workspace:root,command:'node src/check.mjs && python -c "import numpy; from PIL import Image; import scipy; import soundfile; print(\'Shared Python libraries ready\',numpy.arange(3).sum())"',cwd:'.',timeoutMs:120000},new AbortController().signal,()=>{});
 if(result.status!=='complete'||existsSync(join(root,'node_modules'))||existsSync(join(root,'.python-packages')))throw Error(JSON.stringify(result));
 writeFileSync(join(root,'src/scene.js'),'import React from "react";window.React=React;');await bundleScene(root,join(staged,'libraries'),{entry:'src/scene.js',output:'output/scene.js'},new AbortController().signal);
 console.log(JSON.stringify({project:n+1,status:result.status,output:result.output,localInstalls:false}));
}}finally{runtime.stop();}
