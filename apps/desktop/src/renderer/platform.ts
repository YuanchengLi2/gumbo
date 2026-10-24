/** Gumbo on the web (apps/web) rather than the desktop app, as its window.dream says. Projects then live in the
 * browser's own storage: there is no folder to open or show, and exports saved there go to the computer's Downloads. */
export const onWeb=()=>(window as {dream?:{web?:boolean}}).dream?.web===true;
/** Whether folders can be chosen: always on the desktop; on the web, not on phones and tablets (no folder picker). */
export const canPickFolders=()=>!onWeb()||typeof (window as {showDirectoryPicker?:unknown}).showDirectoryPicker==='function';
/** A folder as the export window names it: on the web, a folder the user chose by its name (kept as
 * /granted/<name>-<id>), and the project's own Exports as the Downloads it ends up in. */
/** The folders the user chose for Gumbo on the web (/granted/…). A browser can't open the whole computer, so on the
 * web these stand for it: any of them means computer access is on. */
export const webFolders=<G extends {scope:string;path?:string}>(grants:G[])=>onWeb()?grants.filter(g=>g.scope==='folder'&&!!g.path?.startsWith('/granted/')):[];
export const computerGrant=<G extends {scope:string;path?:string}>(grants:G[])=>grants.find(g=>g.scope==='computer')??webFolders(grants)[0];
export function folderLabel(folder:string){
 if(!onWeb())return folder;
 return /^\/granted\/(.+)-[0-9a-f]{4}$/.exec(folder)?.[1]??'Downloads';
}
