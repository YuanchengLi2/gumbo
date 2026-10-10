import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {downloadVerified} from '../../apps/desktop/src/main/download';

it('resumes the remaining bytes, verifies the model and reuses it without network',async()=>{
 const bytes=Buffer.from('verified model fixture'),folder=mkdtempSync(join(tmpdir(),'dream-model-')),destination=join(folder,'model.bin');
 writeFileSync(destination+'.part',bytes.subarray(0,8));let requests=0,range:string|undefined;
 const server=createServer((req,res)=>{requests++;range=req.headers.range;res.writeHead(206,{'Content-Range':`bytes 8-${bytes.length-1}/${bytes.length}`});res.end(bytes.subarray(8));});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const address=server.address() as {port:number};const entry={id:'model',filename:'model.bin',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),url:`http://127.0.0.1:${address.port}/model`};
 try{await downloadVerified(entry,destination,new AbortController().signal,()=>{});expect(range).toBe('bytes=8-');expect(readFileSync(destination)).toEqual(bytes);expect(existsSync(destination+'.part')).toBe(false);await downloadVerified(entry,destination,new AbortController().signal,()=>{});expect(requests).toBe(1);}finally{server.close();}
});
