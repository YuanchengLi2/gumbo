/** A sense of budget for one request: advisory reminders riding with tool results (like repeat-reminder.ts), never a
 * block. On October 20 a 15-second edit took 135 calls and a color grade was re-published 20 times in 15 minutes: each
 * pass worked, so nothing failed and nothing stopped it. The reminders come when the request has been published several
 * times, when work continues long after a successful publication, and when the calls pile up. A new message from the
 * user starts the count again. */
export type Budget={calls:number;publishes:number;sincePublish?:number};
const PUBLISH_MARKS=[3,5,8],AFTER_PUBLISH=8,CALL_MARKS=[40,70,100];
// Calls that are not work on the edit.
const UNTRACKED=new Set(['finish','update_tasks']);

/** The request's budget after this call, and the reminder to send with its result, if any. */
export function trackBudget(previous:Budget|undefined,tool:string,succeeded:boolean):{budget:Budget;reminder?:string}{
 const start=previous??{calls:0,publishes:0};if(UNTRACKED.has(tool))return{budget:start};
 const budget:Budget={calls:start.calls+1,publishes:start.publishes,sincePublish:start.sincePublish};
 const published=tool==='publish_project'&&succeeded;
 if(published){budget.publishes++;budget.sincePublish=0;}else if(budget.sincePublish!==undefined)budget.sincePublish++;
 const notes:string[]=[];
 if(published&&PUBLISH_MARKS.includes(budget.publishes))notes.push(`Budget: this request has now been published ${budget.publishes} times. Each extra pass costs the user time and credits. If this version does what was asked, call finish now; keep going only for a failed check or something actually wrong.`);
 if(budget.sincePublish===AFTER_PUBLISH)notes.push(`Budget: the edit was published ${AFTER_PUBLISH} calls ago and you are still refining it. Unless something you saw is actually wrong, finish now with what is published.`);
 if(CALL_MARKS.includes(budget.calls))notes.push(budget.calls===CALL_MARKS[0]
  ?`Budget: ${budget.calls} calls on this request; most edits need far fewer. Publish what works and finish unless something is actually broken.`
  :`Budget: ${budget.calls} calls on this request, well past what it needs. Publish the best version you have and finish now; name anything unfinished in the summary.`);
 return{budget,reminder:notes.length?notes.join('\n\n'):undefined};
}
