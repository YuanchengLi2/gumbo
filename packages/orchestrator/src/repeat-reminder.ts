/** Advisory reminders for the exact same tool call made several times in a row (the pattern of DeepSeek Harness's
 * repeat-tool-reminder): viewing the same footage again, re-running the same check, publishing with nothing changed.
 * The reminder rides with the call's result at the third, fifth and eighth repeat; it never blocks or delays a call
 * (waiting on something can be a legitimate repeat), and a new message from the user starts the count again. Repeated
 * failures have their own limit in code-agent.ts; this catches the loops that succeed. */
export type Repeat={key:string;count:number};
const THRESHOLDS=[3,5,8];
// Calls that are not work on the edit: they neither count nor break a run of repeats.
const UNTRACKED=new Set(['finish','update_tasks']);

/** The run of identical calls after this one (key: its tool identity), and the reminder to send with its result, if any. */
export function trackRepeat(previous:Repeat|undefined,tool:string,key:string):{repeat?:Repeat;reminder?:string}{
 if(UNTRACKED.has(tool))return{repeat:previous};
 const repeat={key,count:previous?.key===key?previous.count+1:1};
 if(!THRESHOLDS.includes(repeat.count))return{repeat};
 return{repeat,reminder:repeat.count===THRESHOLDS[0]
  ?`Reminder: this is the same ${tool} call, with the same input, ${repeat.count} times in a row. Read the earlier results before calling it again: if nothing changed between the calls, the result does not change either.`
  :`Reminder: ${repeat.count} identical ${tool} calls in a row. Repeating it is not moving the edit forward. Use what the earlier results show, try a different approach, or finish (blocked, with the reason, if you are stuck).`};
}

/** A tool result's content with the reminder after it. */
export const withReminder=(content:any,reminder:string)=>typeof content==='string'?`${content}\n\n${reminder}`:Array.isArray(content)?[...content,{type:'text',text:reminder}]:content;
