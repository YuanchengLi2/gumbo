import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {deflateSync} from 'node:zlib';
import {AssetSchema,type Asset} from '../../packages/footage/src';
import {sceneBuildOptions} from '../../packages/scene-engine/src/compile-options';
import {chunksFor,THREE_HELPERS} from '../../packages/scene-engine/src/modules';
import {ENGINE_VERSION} from '../../packages/scene-engine/src/protocol';

/** An RGB PNG generated in memory, so fixtures need no binary files. */
export function png(width:number,height:number,pixel:(x:number,y:number)=>[number,number,number]){
 const rows=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const [r,g,b]=pixel(x,y),o=y*(width*3+1)+1+x*3;rows[o]=r;rows[o+1]=g;rows[o+2]=b;}
 const crc=(buf:Buffer)=>{let c=~0;for(const byte of buf){c^=byte;for(let k=0;k<8;k++)c=c>>>1^(c&1?0xEDB88320:0);}return ~c>>>0;};
 const chunk=(type:string,data:Buffer)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type),data]);const sum=Buffer.alloc(4);sum.writeUInt32BE(crc(body));return Buffer.concat([len,body,sum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}

/** Compiles a fixture scene from tests/fixtures/engine-scenes and lays it out as a published engine scene asset:
 * Media/Generated/<hash>/scene.js with resources.json, resources in Media/Engine/files/<sha256>. */
export async function publishFixtureScene(project:string,name:string,options:{id?:string;width?:number;height?:number;fps?:number;durationInFrames?:number;files?:Record<string,Buffer>;transparent?:boolean}={}):Promise<Asset>{
 const result=await build({...sceneBuildOptions(resolve(`tests/fixtures/engine-scenes/${name}.tsx`)),outfile:'scene.js'});
 const bundle=result.outputFiles!.find(f=>f.path.endsWith('scene.js'))!.text,map=result.outputFiles!.find(f=>f.path.endsWith('.map'))?.text;
 const imports=Object.values(result.metafile.inputs).flatMap(input=>input.imports.map(i=>i.path));
 const files:Record<string,string>={};for(const [path,bytes] of Object.entries(options.files??{})){const hash=createHash('sha256').update(bytes).digest('hex');mkdirSync(join(project,'Media/Engine/files'),{recursive:true});writeFileSync(join(project,'Media/Engine/files',hash),bytes);files[path]=hash;}
 const revisionId=createHash('sha256').update(bundle).update(JSON.stringify(files)).digest('hex'),folder=join(project,'Media/Generated',revisionId.slice(0,16));
 mkdirSync(folder,{recursive:true});writeFileSync(join(folder,'scene.js'),bundle);if(map)writeFileSync(join(folder,'scene.js.map'),map);writeFileSync(join(folder,'resources.json'),JSON.stringify({files}));
 const fps=options.fps??30,durationInFrames=options.durationInFrames??90;
 return AssetSchema.parse({id:options.id??name,filename:name+'.tsx',kind:'video',durationSec:durationInFrames/fps,fps,width:options.width??640,height:options.height??360,originalPath:join(folder,'scene.js'),fingerprint:revisionId,scene:{format:'engine',revisionId,durationInFrames,engine:{version:ENGINE_VERSION,chunks:chunksFor(imports,THREE_HELPERS.some(h=>bundle.includes(h))),transparent:options.transparent??false}}});
}
