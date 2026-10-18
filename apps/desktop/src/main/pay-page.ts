import {BrowserWindow,shell} from 'electron';

/** Paying happens on Stripe's own page (Checkout, or the customer portal), shown in a window of its own over Gumbo: the
 * card goes to Stripe, never to the app. Opening it in the browser instead left it behind the maximized app, so it
 * looked as if nothing happened. The window closes itself when Stripe sends the payer back (the billing return page),
 * and says how it went: subscribed, credits, portal or cancelled. Links that leave Stripe open in the browser. */
export const stripePage=(url:string)=>{try{const u=new URL(url);return u.protocol==='https:'&&['checkout.stripe.com','billing.stripe.com'].includes(u.hostname);}catch{return false;}};
const RETURN='https://usegumbo.app/billing/';
const returned=(url:string)=>url.startsWith(RETURN)?(new URL(url).searchParams.get('status')??'portal'):undefined;
let current:BrowserWindow|undefined;

export async function openPayPage(url:string,parent:BrowserWindow,done:(status:string)=>void){
 if(!stripePage(url))throw new Error('The payment page could not be opened.');
 if(current&&!current.isDestroyed())current.destroy();
 const portal=new URL(url).hostname==='billing.stripe.com';
 const win=new BrowserWindow({parent,modal:true,width:portal?960:540,height:820,minWidth:420,minHeight:600,title:portal?'Manage billing · Gumbo':'Checkout · Gumbo',autoHideMenuBar:true,backgroundColor:'#ffffff',show:false,
  webPreferences:{partition:'persist:gumbo-pay',sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
 current=win;let finished=false;
 const finish=(status:string)=>{if(finished)return;finished=true;done(status);if(!win.isDestroyed())win.close();};
 const route=(event:{preventDefault():void},next:string)=>{
  const status=returned(next);if(status){event.preventDefault();finish(status);return;}
  // Checkout and the portal stay here (and the banks' and wallets' pages they hand over to); plain links leave.
  if(!/^https:\/\//.test(next)){event.preventDefault();return;}
 };
 win.webContents.on('will-navigate',route);win.webContents.on('will-redirect',route);
 win.webContents.setWindowOpenHandler(({url:next})=>{if(/^https:\/\//.test(next))void shell.openExternal(next);return{action:'deny'};});
 win.once('ready-to-show',()=>win.show());
 // Closed by hand: nothing was paid here (or it was, and Stripe's webhook still grants it), so the app refreshes anyway.
 win.on('closed',()=>{if(current===win)current=undefined;if(!finished){finished=true;done('closed');}});
 await win.loadURL(url);
 return{opened:true};
}
