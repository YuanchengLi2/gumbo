/** Send becomes Stop in the same place, so the second click of a double click, or a click repeated in a hurry, lands on
 * Stop. A click that soon after the change is the send repeated, not a decision to stop; any later click stops at once.
 * Half a second is the system's double-click time (350 ms let the second click of a slow double click through). */
export const STOP_GRACE_MS=500;
export function stopGuard(now:()=>number=()=>performance.now()){let shownAt=-Infinity;return{
 /** Stop has just taken Send's place. */
 shown(){shownAt=now();},
 allows(){return now()-shownAt>=STOP_GRACE_MS;}};}
