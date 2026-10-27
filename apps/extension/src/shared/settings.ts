/// <reference types="chrome" />
/** The user's settings, in chrome.storage.local so every frame's content script sees a change at once. */
export type Surface='tab'|'inline'|'action'|'notes'|'agent';
export type Settings={
 enabled:boolean;
 /** Gumbo is paused until this time (ms); 0 when not paused. */
 pausedUntil:number;
 /** Sites (hostnames) where the user turned Gumbo off. */
 siteOff:string[];
 /** Sites where Ctrl+K stays the site's own and Gumbo opens on Alt+K. */
 altK:string[];
 models:Record<Surface,string>;
 /** Which set of default models the stored ones were made against (see firstDefaults). */
 modelsVersion?:number;
 /** Facts the user gave about themselves, which Tab may use: name, sign-off, email, anything else. */
 facts:{name?:string;signOff?:string;email?:string;other?:string};
 /** Whether what plays in a tab (videos, talks, the other side of a call) is heard and remembered. */
 listen:boolean;
 /** Sites where Gumbo never listens. */
 listenOff:string[];
 /** Whether the user's microphone joins during a call (once Chrome allowed it). */
 mic:boolean;
 /** Tab's moves on pages drawn as pixels go as real clicks and keys (through Chrome's debugging interface, which shows
  * a bar while it acts), for apps that ignore the simulated ones. Off until the user turns it on. */
 realInput?:boolean;
};
export const defaultSettings:Settings={enabled:true,pausedUntil:0,siteOff:[],altK:[],
 models:{tab:'claude-haiku-5-5',inline:'claude-haiku-5-5',action:'claude-haiku-5-5',notes:'claude-haiku-5-5',agent:'deepseek-flash'},modelsVersion:2,facts:{},listen:true,listenOff:[],mic:false};
/** The defaults before version 2 (October 26): a model still set to one of them was never picked, so it follows the new
 * default; a model the user chose stays. */
const firstDefaults:Record<Surface,string>={tab:'claude-haiku-5-5',inline:'claude-haiku-5-5',action:'claude-haiku-5-5',notes:'claude-haiku-5-5',agent:'deepseek-flash'};

export async function loadSettings():Promise<Settings>{
 const {settings}=await chrome.storage.local.get('settings') as {settings?:Partial<Settings>};
 const stored=settings?.models??{},current=(settings?.modelsVersion??1)>=2;
 const chosen=current?stored:Object.fromEntries(Object.entries(stored).filter(([surface,id])=>firstDefaults[surface as Surface]!==id));
 return{...defaultSettings,...settings,models:{...defaultSettings.models,...chosen},modelsVersion:2,facts:{...settings?.facts}};
}
/** Saved on this computer, and in Chrome sync, so a reinstall (or another computer signed in to Chrome) has them back. */
export async function saveSettings(change:Partial<Settings>){const now=await loadSettings(),next={...now,...change};await chrome.storage.local.set({settings:next});await chrome.storage.sync?.set({settings:next}).catch(()=>{});}
/** On install: the settings from Chrome sync, when this computer has none yet. */
export async function restoreSettings(){
 const local=(await chrome.storage.local.get('settings')).settings,synced=((await chrome.storage.sync?.get('settings').catch(()=>({})))as {settings?:unknown}|undefined)?.settings;
 if(!local&&synced)await chrome.storage.local.set({settings:synced});
 return !!(!local&&synced);
}
export function onSettings(listener:(settings:Settings)=>void){
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.settings)void loadSettings().then(listener);});
}

/** Sites where Gumbo never reads, captures or suggests: banking and health portals, by name and by common words in
 * their hostnames. The user's own list adds to it. */
const blockedHosts=['chase.com','bankofamerica.com','wellsfargo.com','citi.com','capitalone.com','americanexpress.com','usbank.com','pnc.com','schwab.com','fidelity.com','vanguard.com','paypal.com','venmo.com','robinhood.com','coinbase.com','discover.com','ally.com','sofi.com','chime.com','tdbank.com','hsbc.com','barclays.co.uk','kp.org','mychart.com','healthcare.gov','zocdoc.com','labcorp.com','questdiagnostics.com','1password.com','bitwarden.com','lastpass.com','accounts.google.com','login.microsoftonline.com'];
const blockedWords=/(^|[.-])(bank|banking|creditunion|mychart|patientportal)([.-]|$)/;
export function blockedSite(host:string){host=host.toLowerCase().replace(/^www\./,'');return blockedHosts.some(b=>host===b||host.endsWith('.'+b))||blockedWords.test(host);}
/** Whether Gumbo may listen on this site right now. */
export function listensOn(settings:Settings,host:string,now=Date.now()){host=host.toLowerCase().replace(/^www\./,'');return settings.listen&&!settings.listenOff.includes(host)&&activeOn(settings,host,now);}
/** Whether Gumbo may work on this site right now. */
export function activeOn(settings:Settings,host:string,now=Date.now()){
 host=host.toLowerCase().replace(/^www\./,'');
 return settings.enabled&&settings.pausedUntil<=now&&!settings.siteOff.includes(host)&&!blockedSite(host);
}
export const siteOf=(url:string)=>{try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}};
