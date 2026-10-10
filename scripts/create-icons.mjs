import sharp from 'sharp';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const output=resolve('apps/desktop/resources');mkdirSync(output,{recursive:true});
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="36" y="36" width="952" height="952" rx="218" fill="#1b2027"/><path d="M334 294H465C636 294 710 369 710 512S636 730 465 730H334V294Z" fill="none" stroke="#f5f6f8" stroke-width="65" stroke-linejoin="round"/></svg>');
writeFileSync(resolve(output,'icon.svg'),svg);
const png=await sharp(svg).png().toBuffer();writeFileSync(resolve(output,'icon.png'),png);
const small=await sharp(svg).resize(256).png().toBuffer();
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(small.length,14);ico.writeUInt32LE(22,18);writeFileSync(resolve(output,'icon.ico'),Buffer.concat([ico,small]));
const chunks=[];
for(const [kind,size] of [['ic07',128],['ic08',256],['ic09',512],['ic10',1024]]){const data=await sharp(svg).resize(size).png().toBuffer(),header=Buffer.alloc(8);header.write(kind);header.writeUInt32BE(data.length+8,4);chunks.push(header,data);}
const header=Buffer.alloc(8);header.write('icns');header.writeUInt32BE(8+chunks.reduce((sum,b)=>sum+b.length,0),4);writeFileSync(resolve(output,'icon.icns'),Buffer.concat([header,...chunks]));
console.log('Original Dream desktop icons generated.');
