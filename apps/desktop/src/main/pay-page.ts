import {shell} from 'electron';

/** Opens a Stripe page (Checkout, or the customer portal) in the browser, where paying happens; the app never sees a card.
 * Only Stripe's own pages are opened, whatever the gateway answers. Returns whether it opened. */
export const stripePage=(url:string)=>{try{const u=new URL(url);return u.protocol==='https:'&&['checkout.stripe.com','billing.stripe.com'].includes(u.hostname);}catch{return false;}};
export async function openPayPage(url:string){
 if(!stripePage(url))throw new Error('The payment page could not be opened.');
 await shell.openExternal(url);return{opened:true};
}
