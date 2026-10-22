import {accountNow,refreshAccount} from './account';

/** Helping improve Gumbo's AI: asked in the onboarding, changed in Settings > Privacy (settings.json's improve). Every
 * edit's log is sent on its own to find and fix problems (the main process's edit-logs.ts), marked with this choice: for
 * the owner's account and anyone who said yes, those logs are also the examples a fine-tuned Roux learns from. A rating
 * goes with the edit's log when this computer shares edits. Never footage. */

/** Whether this computer shares edits: the owner's account always, anyone else only after saying yes. */
export async function sharesEdits(){
 const account=accountNow()??await refreshAccount().catch(()=>undefined);if(!account?.signedIn)return false;if(account.admin)return true;
 const settings=await window.dream.settings().catch(()=>null) as {improve?:boolean}|null;return !!settings?.improve;
}
const upload=(turnId:string,note:string,rating:'up'|'down')=>window.dream.command({type:'account',action:'report',turnId,kind:'feedback',note,rating}).catch(()=>{});

/** A rating: kept with the project, and sent with the edit's log when this computer shares edits. */
export async function rateEdit(turnId:string,rating:'up'|'down'|null){
 await window.dream.command({type:'turn_feedback',turnId,rating}).catch(()=>{});
 if(rating&&await sharesEdits())await upload(turnId,rating==='up'?'Rated good.':'Rated bad.',rating);
}
