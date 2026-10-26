/** How hard background work may run on this computer right now. Work nobody is waiting for (embedding what memory
 * kept, hearing the sounds around speech, live caption guesses) runs freely when plugged in, gently on battery, and waits
 * for the charger on a low battery; what the user is waiting for (a search, a caption line) always runs. */
type Battery={charging:boolean;level:number};
let battery:Battery|undefined;
const known=(navigator as Navigator&{getBattery?:()=>Promise<Battery>}).getBattery?.().then(b=>{battery=b;}).catch(()=>{});
/** The power state for the worker (sync asks before pushing), once the battery is known. */
export async function powerNow(){await known;return power();}
export type Power='full'|'gentle'|'low';
export function power():Power{
 if(!battery||battery.charging)return 'full';
 return battery.level<=0.2?'low':'gentle';
}
/** A pause between batches of background work: as asked when plugged in, six times longer on battery, and on a low
 * battery until it is charging again or has more than a fifth (checked each minute). */
export async function rest(ms:number){
 if(power()==='gentle'){await new Promise(r=>setTimeout(r,ms*6));return;}
 while(power()==='low')await new Promise(r=>setTimeout(r,60_000));
 await new Promise(r=>setTimeout(r,ms));
}
