/// <reference types="chrome" />
/** Where Gumbo for Chrome talks to: the Gumbo Supabase project (sign-in and the gateway) and the sign-in page. The anon
 * key is public (made for web pages; it can only start a sign-in). */
export const SUPABASE_URL='https://qewguvfkkwvdoqptiljd.supabase.co';
export const SUPABASE_ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFld2d1dmZra3d2ZG9xcHRpbGpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyNTY0NTEsImV4cCI6MjEwNjgzMjQ1MX0.clOcsG8wKKXvQb2Ozl3zFsx6p2pXRlCLBgc3KGGvAtU';
export const SIGN_IN_PAGE='https://usegumbo.app/signin/';
/** The sign-in page only returns to Gumbo's own pages; the extension's content script takes the code from there. */
export const RETURN_PAGE='https://usegumbo.app/app/?ext=1';

export type Endpoints={supabase:string;gateway:string;anon:string};
/** A stand-in for development and tests (`dev.supabase` in storage) is honoured only on this computer, so nothing can
 * point the extension, and the session it sends, at another server. */
export async function endpoints():Promise<Endpoints>{
 const {dev}=await chrome.storage.local.get('dev') as {dev?:{supabase?:string}};
 const local=dev?.supabase&&isLocal(dev.supabase)?dev.supabase.replace(/\/$/,''):undefined,supabase=local??SUPABASE_URL;
 return{supabase,gateway:`${supabase}/functions/v1/dream-gateway`,anon:SUPABASE_ANON};
}
export function isLocal(url:string){try{const host=new URL(url).hostname;return host==='localhost'||host==='127.0.0.1'||host==='[::1]';}catch{return false;}}
