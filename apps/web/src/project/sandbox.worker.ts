/// <reference lib="webworker" />
import {serveSandbox,nodeLikeFS,type NodeLikeFS} from '@dream/web-sandbox';
import * as fs from './fs/sync-fs';

/** Roux's run_command for the open project (packages/web-sandbox): a shell with the Unix tools, Python (Pyodide),
 * ffmpeg, node and esbuild, in this worker. Its files are the project's folder in this browser's storage, through a
 * storage worker of its own (fs/storage.worker.ts). The worker's name is that folder, so a command sees the project and
 * nothing else stored here. */
serveSandbox(async()=>{
 await fs.connectFs(new Worker(new URL('./fs/storage.worker.ts',import.meta.url),{type:'module',name:'gumbo-sandbox-storage'}));
 return nodeLikeFS(fs as unknown as NodeLikeFS,self.name);
});
