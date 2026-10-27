import type {PageCategory} from '../background/db';
/** What kind of page a visit is (an inbox, a thread, a doc, search results, a form, a dashboard, an article…), from its
 * address and title and a few signs the page gives in a moment (how many fields, how much text, a video, rows, a price,
 * a message box under messages). Memory ranks and groups by it, and Tab knows what people do on each kind. */
export type PageSigns={fields:number;textLength:number;editor:boolean;video:boolean;rows:number;price:boolean;cart:boolean;composer:boolean;messages:number;charts:number;searchBox:boolean};
const mailHosts=/(^|\.)(mail\.google\.com|outlook\.(live|office|office365)\.com|mail\.yahoo\.com|mail\.proton\.me|fastmail\.com|hey\.com)$/;
const docHosts=/(^|\.)(docs\.google\.com|notion\.so|coda\.io|quip\.com|paper\.dropbox\.com|onedrive\.live\.com|word\.office\.com)$/;
const chatHosts=/(^|\.)(slack\.com|discord\.com|teams\.microsoft\.com|web\.whatsapp\.com|messenger\.com|web\.telegram\.org|chatgpt\.com|claude\.ai|gemini\.google\.com)$/;
const videoHosts=/(^|\.)(youtube\.com|vimeo\.com|twitch\.tv|netflix\.com|loom\.com)$/;

export function categoryOf(url:string,title='',signs:Partial<PageSigns>={}):PageCategory{
 let u:URL;try{u=new URL(url);}catch{return 'other';}
 const host=u.hostname.replace(/^www\./,''),path=u.pathname.toLowerCase(),hash=u.hash.toLowerCase(),t=title.toLowerCase();
 if(/(^|\/)(checkout|cart|basket|payment|pay)(\/|$)/.test(path))return 'checkout';
 if(/(^|\/)(settings|preferences|account\/(edit|settings))(\/|$)/.test(path)||/#settings/.test(hash))return 'settings';
 if(mailHosts.test(host)){
  // Gmail and its kind: a list is #inbox, #label/x or #search/x; a message is a long id after it.
  if(/#[a-z-]+(\/[^/]+)*\/[a-z0-9]{16,}$/i.test(u.hash)||/\/(id|message|conversation)\//i.test(path))return 'thread';
  return 'inbox';
 }
 if(videoHosts.test(host)&&/(watch|video|videos\/\d|\/\d{5,})/.test(path+u.search)||signs.video)return 'video';
 if(docHosts.test(host)&&(host!=='docs.google.com'||/\/(document|spreadsheets|presentation|forms)\//.test(path))||signs.editor)return 'doc';
 if(chatHosts.test(host)||signs.composer&&(signs.messages??0)>=2)return 'chat';
 const searched=['q','query','search_query','search','k','keywords'].some(k=>u.searchParams.get(k));
 if(searched||/(^|\/)(search|results)(\/|$)/.test(path))return 'results';
 if(signs.price&&signs.cart||/(^|\/)(product|item|dp|p)\/[^/]+/.test(path)&&signs.price)return 'product';
 if((signs.fields??0)>=3)return 'form';
 if((signs.charts??0)>=2||/(^|\/)(dashboard|analytics|insights|overview|console|admin)(\/|$)/.test(path)||/dashboard/.test(t))return 'dashboard';
 if(signs.searchBox&&(signs.textLength??0)<600&&path.split('/').filter(Boolean).length<=1)return 'search';
 if((signs.rows??0)>=15&&(signs.textLength??0)<8000)return /inbox|messages/.test(t)?'inbox':'results';
 if((signs.textLength??0)>=2500)return 'article';
 return 'other';
}
