import * as fs from '../fs/sync-fs';
/** node:fs/promises in the browser: the synchronous calls (sync-fs.ts) in promises, which is what they cost here anyway. */
const wrap=<A extends unknown[],R>(fn:(...args:A)=>R)=>async(...args:A):Promise<R>=>fn(...args);
export const readFile=wrap(fs.readFileSync),writeFile=wrap(fs.writeFileSync),appendFile=wrap(fs.appendFileSync),mkdir=wrap(fs.mkdirSync),readdir=wrap(fs.readdirSync),stat=wrap((p:unknown)=>fs.statSync(p)!),lstat=wrap((p:unknown)=>fs.statSync(p)!),unlink=wrap(fs.unlinkSync),rm=wrap(fs.rmSync),rmdir=wrap(fs.rmdirSync),rename=wrap(fs.renameSync),copyFile=wrap(fs.copyFileSync),realpath=wrap(fs.realpathSync),access=wrap(fs.accessSync),mkdtemp=wrap(fs.mkdtempSync);
export default {readFile,writeFile,appendFile,mkdir,readdir,stat,lstat,unlink,rm,rmdir,rename,copyFile,realpath,access,mkdtemp};
