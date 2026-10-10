import {existsSync,renameSync,unlinkSync,statSync} from 'node:fs';
import {dirname,basename,extname,join} from 'node:path';
import {randomUUID} from 'node:crypto';

/** A completed artifact is published only after its producer and validator finish. */
export async function atomicArtifact(destination:string,produce:(temporary:string)=>Promise<void>,validate?:(temporary:string)=>Promise<void>):Promise<void>{
  const temporary=join(dirname(destination),`.${basename(destination,extname(destination))}.${randomUUID()}.partial${extname(destination)}`);
  try {
    await produce(temporary);
    if(!existsSync(temporary)||statSync(temporary).size===0)throw new Error('Processing produced an empty artifact.');
    await validate?.(temporary);
    renameSync(temporary,destination);
  }finally{if(existsSync(temporary))unlinkSync(temporary);}
}
