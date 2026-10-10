import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
/** libuv's AppContainer namespace fix for the pinned x64 distribution.
 * Keep the PE layout unchanged. uv__pipe_server passes a random uint64, uses
 * FILE_FLAG_FIRST_PIPE_INSTANCE and retries collisions; its process-ID suffix
 * is redundant. LOCAL scopes these pipes to the AppContainer, without granting
 * access to any host pipes. The extra printf argument is harmless in C varargs.
 * Reference: https://github.com/libuv/libuv/pull/5181 (unconditional LOCAL variant).
 */
export async function patchCodeNode(path:string){
 const bytes=await readFile(path),sha=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
 const original=Buffer.from('\\\\?\\pipe\\uv\\%llu-%lu\0'),replacement=Buffer.from('\\\\?\\pipe\\LOCAL\\%llx\0\0');
 if(original.length!==replacement.length)throw new Error('Node compatibility patch changed its binary layout.');
 const offset=bytes.indexOf(original);if(offset<0){if(bytes.indexOf(replacement)<0)throw new Error('The pinned Node binary does not match the compatibility patch.');return{kind:'libuv-appcontainer-pipe-template-v1',sha256:sha(bytes)};}
 if(bytes.indexOf(original,offset+1)!==-1)throw new Error('Node pipe template is ambiguous.');
 const originalSha256=sha(bytes);replacement.copy(bytes,offset);await writeFile(path,bytes);
 return{kind:'libuv-appcontainer-pipe-template-v1',originalSha256,sha256:sha(bytes),offset,upstream:'https://github.com/libuv/libuv/pull/5181'};
}
