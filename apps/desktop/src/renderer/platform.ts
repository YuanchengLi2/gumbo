/** Gumbo on the web (apps/web) rather than the desktop app, as its window.dream says. Projects then live in the
 * browser's own storage: there is no folder to open or show, and exports saved there go to the computer's Downloads. */
export const onWeb=()=>(window as {dream?:{web?:boolean}}).dream?.web===true;
/** A folder as the export window names it: on the web, a folder the user chose by its name (kept as
 * /granted/<name>-<id>), and the project's own Exports as the Downloads it ends up in. */
export function folderLabel(folder:string){
 if(!onWeb())return folder;
 return /^\/granted\/(.+)-[0-9a-f]{4}$/.exec(folder)?.[1]??'Downloads';
}
