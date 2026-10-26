/** The key that seals Gumbo for Chrome's memory on the user's computer (it wraps the memory's own data key there): derived
 * from the account's id and a secret only this gateway holds (DREAM_MEMORY_SECRET), so the same account always gets the
 * same key, a copy of the browser profile is unreadable without signing in, and no memory ever comes here. Changing the
 * secret would lock every memory made before, so it is set once and never rotated. */
export async function memoryKey(secret:string,userId:string):Promise<string>{
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const mac=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('gumbo-memory-v1:'+userId));
 return btoa(String.fromCharCode(...new Uint8Array(mac)));
}
