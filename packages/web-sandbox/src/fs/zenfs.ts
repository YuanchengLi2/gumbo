import {nodeLikeFS,type NodeLikeFS} from './node-like';
import type {SandboxFS} from './types';

/** The web app's file system for the sandbox: ZenFS's `fs` after `configure()` in the sandbox worker (OPFS mounted where
 * the projects live). `folder` is the ZenFS folder the sandbox sees as "/", e.g. "/projects/<id>"; leave it out to share
 * ZenFS's whole tree. Taken as a parameter, not imported, so the app's own ZenFS instance and version are the ones used.
 *
 *   import {configure,fs} from '@zenfs/core'; import {WebAccess} from '@zenfs/dom';
 *   await configure({mounts:{'/projects':{backend:WebAccess,handle:await navigator.storage.getDirectory()}}});
 *   serveSandbox(fromZenFS(fs,'/projects/'+id),{workspace:'/Workspace'});
 */
export function fromZenFS(fs:unknown,folder=''):SandboxFS{
 const candidate=fs as Partial<NodeLikeFS>;
 for(const name of ['statSync','readdirSync','openSync','readSync','writeSync'] as const)if(typeof candidate?.[name]!=='function')throw new Error(`fromZenFS needs ZenFS's fs object (it has no ${name}).`);
 return nodeLikeFS(fs as NodeLikeFS,folder);
}
