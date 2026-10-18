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

/** The page the browser shows once signed in (from this app's own sign-in callback): a clean welcome, styled like
 * usegumbo.app. The app has already come to the front, so the page only says so. */
const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export function signedInPage(email=''){
 const name=email.split('@')[0]||'';
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Welcome back · Gumbo</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='16' fill='%23FFFBEF'/><path d='M10 30h44c0 13-9.8 23-22 23S10 43 10 30z' fill='%23E2552A'/><path d='M28 35.5l9.5 5.5-9.5 5.5z' fill='%23FFFBEF'/><path d='M24 23c-2.6-3 2.6-5.2 0-8.6M32 23c-2.6-3 2.6-5.2 0-8.6M40 23c-2.6-3 2.6-5.2 0-8.6' fill='none' stroke='%231F1A17' stroke-width='3.2' stroke-linecap='round'/></svg>">
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400&family=Figtree:wght@400;600&display=swap" rel="stylesheet">
<style>:root{--ink:#1F1A17;--muted:#5F5650;--bg:#FFFBEF}@media (prefers-color-scheme:dark){:root{--ink:#FFF5E6;--muted:#C9BBAE;--bg:#14110F}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:32px 16px;font-family:Figtree,system-ui,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased;text-align:center}
svg{width:56px;height:56px;margin-bottom:22px}h1{margin:0 0 12px;font-family:'EB Garamond',Georgia,serif;font-size:52px;font-weight:400;letter-spacing:-.02em;line-height:1}
p{margin:0;font-size:16px;line-height:1.55;color:var(--muted)}</style></head>
<body><main><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 30h44c0 13-9.8 23-22 23S10 43 10 30z" fill="#E2552A"/><path d="M28 35.5l9.5 5.5-9.5 5.5z" fill="#FFF8EE"/><g fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M24 23c-2.6-3 2.6-5.2 0-8.6"/><path d="M32 23c-2.6-3 2.6-5.2 0-8.6"/><path d="M40 23c-2.6-3 2.6-5.2 0-8.6"/></g></svg>
<h1>Welcome back${name?`, ${escape(name)}`:''}</h1><p>You're signed in to Gumbo. You can close this tab.</p></main></body></html>`;
}
