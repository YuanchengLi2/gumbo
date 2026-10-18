import {app} from 'electron';
import {resolve} from 'node:path';

/** gumbo:// links open the app: the pages a browser shows after signing in or paying (the sign-in callback's page, and
 * usegumbo.app/billing/) ask to open it, so the browser offers "Open Gumbo?". A running app comes to the front (it holds
 * the single-instance lock, so the link reaches it as a second instance); a closed one starts. The link only brings Gumbo
 * forward and says which page sent it; it carries nothing the app acts on beyond refreshing the plan and credits. */
export const PROTOCOL='gumbo';
export function registerProtocol(){
 // A development build runs as electron.exe with the app's folder, so the link must start it the same way.
 // (Its folder is the app path, not argv[1], which can be a switch such as --remote-debugging-port.)
 if(process.defaultApp)app.setAsDefaultProtocolClient(PROTOCOL,process.execPath,[resolve(app.getAppPath())]);
 else app.setAsDefaultProtocolClient(PROTOCOL);
}
/** The gumbo:// link among a launch's arguments, if any. */
export const protocolLink=(argv:readonly string[])=>argv.find(arg=>arg.toLowerCase().startsWith(PROTOCOL+'://'));
/** What page the link names (gumbo://billing → billing), for the window to refresh what it shows. */
export const linkPage=(link:string)=>{try{return new URL(link).hostname||new URL(link).pathname.replace(/^\/+/,'').split('/')[0]||'';}catch{return '';}};

/** The page the browser shows once signed in (from this app's own sign-in callback), styled like usegumbo.app: welcome
 * back with the account, a button to open Gumbo (which the page also asks for at once, so the browser offers "Open
 * Gumbo?"), and a few things to try. */
const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export function signedInPage(email=''){
 const name=email.split('@')[0]||'',initial=(name[0]??'G').toUpperCase();
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Welcome back · Gumbo</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='16' fill='%23FFFBEF'/><path d='M10 30h44c0 13-9.8 23-22 23S10 43 10 30z' fill='%23E2552A'/><path d='M28 35.5l9.5 5.5-9.5 5.5z' fill='%23FFFBEF'/><path d='M24 23c-2.6-3 2.6-5.2 0-8.6M32 23c-2.6-3 2.6-5.2 0-8.6M40 23c-2.6-3 2.6-5.2 0-8.6' fill='none' stroke='%231F1A17' stroke-width='3.2' stroke-linecap='round'/></svg>">
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>:root{--ink:#1F1A17;--muted:#5F5650;--line:rgba(31,26,23,.14);--bg:#FFFBEF;--card:#FFFDF7;--soft:#FBE6D9;--paprika:#E2552A;--paprika2:#C9471F}
@media (prefers-color-scheme:dark){:root{--ink:#FFF5E6;--muted:#C9BBAE;--line:rgba(255,245,230,.16);--bg:#14110F;--card:#1D1916;--soft:#33231B}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:32px 16px;font-family:Figtree,system-ui,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
main{width:min(520px,100%);background:var(--card);border:1.5px solid var(--line);border-radius:28px;overflow:hidden;box-shadow:0 30px 80px -44px rgba(31,26,23,.4)}
.top{padding:34px 34px 28px}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:18px;letter-spacing:-.03em;margin-bottom:30px}.brand svg{width:26px;height:26px}
h1{margin:0 0 8px;font-family:'EB Garamond',Georgia,serif;font-size:46px;font-weight:400;letter-spacing:-.02em;line-height:1}
.lead{margin:0 0 22px;font-size:15.5px;line-height:1.5;color:var(--muted)}
.who{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;margin-bottom:22px}
.who i{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--paprika);color:#FFF8EE;font-style:normal;font-weight:600}
.who div{display:flex;flex-direction:column;min-width:0}.who b{font-size:14px;font-weight:600}.who span{font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.who em{margin-left:auto;font-style:normal;font-size:12px;font-weight:600;color:var(--paprika)}
a.open{display:flex;align-items:center;justify-content:center;height:52px;border-radius:14px;background:var(--paprika);color:#FFF8EE;font-size:16px;font-weight:600;text-decoration:none}a.open:hover{background:var(--paprika2)}
.ideas{padding:22px 34px 30px;border-top:1px solid var(--line);background:var(--bg)}
.ideas h2{margin:0 0 12px;font-size:12.5px;font-weight:600;letter-spacing:.02em;color:var(--muted);text-transform:uppercase}
.ideas ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.ideas li{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:12px;background:var(--card);border:1px solid var(--line)}
.ideas li span{width:28px;height:28px;flex:none;border-radius:8px;display:grid;place-items:center;background:var(--soft);font-size:15px}
.ideas li b{display:block;font-size:14px;font-weight:600}.ideas li small{font-size:12.5px;color:var(--muted)}
.close{margin:16px 0 0;text-align:center;font-size:12.5px;color:var(--muted)}</style></head>
<body><main><div class="top">
<div class="brand"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 30h44c0 13-9.8 23-22 23S10 43 10 30z" fill="#E2552A"/><path d="M28 35.5l9.5 5.5-9.5 5.5z" fill="#FFF8EE"/><g fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M24 23c-2.6-3 2.6-5.2 0-8.6"/><path d="M32 23c-2.6-3 2.6-5.2 0-8.6"/><path d="M40 23c-2.6-3 2.6-5.2 0-8.6"/></g></svg>Gumbo</div>
<h1>Welcome back${name?`, ${escape(name)}`:''}</h1><p class="lead">You're signed in. Your projects are waiting in Gumbo.</p>
${email?`<div class="who"><i>${escape(initial)}</i><div><b>${escape(name)}</b><span>${escape(email)}</span></div><em>Signed in</em></div>`:''}
<a class="open" href="gumbo://signed-in">Open Gumbo</a><p class="close">You can close this tab.</p></div>
<div class="ideas"><h2>Things to try</h2><ul>
<li><span>📱</span><div><b>Turn a long video into Shorts</b><small>"Make three 30-second Shorts from my talk, with captions."</small></div></li>
<li><span>✂️</span><div><b>Tighten the pacing</b><small>"Cut the silences and every um, keep every word."</small></div></li>
<li><span>🌏</span><div><b>Make a trip recap</b><small>"A cinematic recap of my best moments, with music."</small></div></li>
</ul></div></main>
<script>setTimeout(()=>{location.href='gumbo://signed-in';},500);</script></body></html>`;
}
