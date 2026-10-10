import {session,type BrowserWindow} from 'electron';
import {randomUUID} from 'node:crypto';

/** A separate nonpersistent Chromium storage/network context for every render. */
export function visualSession(origin:string){
 const isolated=session.fromPartition(`dream-visual-${randomUUID()}`,{cache:false});
 isolated.setPermissionCheckHandler(()=>false);isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 isolated.webRequest.onBeforeRequest((details,callback)=>{let allowed=false;try{allowed=new URL(details.url).origin===origin;}catch{}callback({cancel:!allowed});});
 isolated.on('will-download',event=>event.preventDefault());
 return isolated;
}
export function isolateWindow(window:BrowserWindow){
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',event=>event.preventDefault());
 window.webContents.on('will-attach-webview',event=>event.preventDefault());
}
export const visualCSP="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
