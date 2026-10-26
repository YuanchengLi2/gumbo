/** A moment in a video, as a link: YouTube's own t=, elsewhere #gumbo-t=, which Gumbo's content script turns into a seek
 * when the page opens. A page that routes by its hash keeps its link as it is (no moment rather than a broken page). */
export function momentUrl(url:string,seconds:number):string{
 try{
  const u=new URL(url),s=Math.max(0,Math.floor(seconds));
  if(/(^|\.)youtube\.com$/.test(u.hostname)&&u.pathname==='/watch'||u.hostname==='youtu.be'){u.searchParams.set('t',`${s}s`);return u.href;}
  if(u.hash&&!/^#gumbo-t=\d+$/.test(u.hash))return url;
  u.hash=`gumbo-t=${s}`;return u.href;
 }catch{return url;}
}
/** The moment a link asks for, if any. */
export const momentOf=(hash:string)=>{const m=/^#gumbo-t=(\d+)$/.exec(hash);return m?Number(m[1]):undefined;};
/** 75 → "1:15", 3725 → "1:02:05". */
export function clock(seconds:number){const s=Math.max(0,Math.floor(seconds)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),r=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${r}`:`${m}:${r}`;}
