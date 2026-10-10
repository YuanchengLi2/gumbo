import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {downloadVerified,type Download} from '../apps/desktop/src/main/download';

const manifest=JSON.parse(readFileSync('apps/desktop/resources/models-manifest.json','utf8'));
const id=process.argv[2]??'whisper-large-v3-turbo';
const entry:Download=manifest.models.find((item:Download)=>item.id===id);
if(!entry)throw new Error('Unknown approved model ID.');
const controller=new AbortController();process.once('SIGINT',()=>controller.abort());
let last=-1;
const path=await downloadVerified(entry,join(resolve('artifacts/models'),entry.filename),controller.signal,(status,bytes)=>{const percent=Math.floor(bytes/entry.bytes*100);if(status!=='downloading'||percent>=last+10){console.log(`${id}: ${status} ${percent}%`);last=percent;}});
console.log(`Verified model: ${path}`);
