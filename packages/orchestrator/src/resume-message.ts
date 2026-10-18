/** What the agent is told when a stopped request carries on with something the user wrote. A plain go-ahead ("continue",
 * "next", "keep going") is passed as it is. Anything else used to be passed as it was too, and the agent read every message
 * after a stop as a go-ahead: "whats taking so long" got no answer, the run just went on. Now it must answer first, in a
 * note the user sees (a question answered plainly, a change said back), and then carry on the way the message points. */
const GO_AHEAD=/^(?:ok(?:ay)?|k|yes|yeah|yep|sure|go|go on|go ahead|continue|cont|carry on|keep going|keep at it|next|proceed|resume|do it|please continue|continue please|continue work(?:ing)?)[.!? ]*$/i;
export const isGoAhead=(text:string)=>GO_AHEAD.test(text.trim());
export function resumeMessage(text:string){
 if(isGoAhead(text))return text;
 return `You were stopped, and then the user wrote: "${text.trim()}"\n`+
  'Before anything else, reply to it in one short note the user will see: answer a question plainly (for example what you were in the middle of and why it is taking long), or say what you will change because of it. '+
  'Then carry on with the stopped work in the direction it gives. If it tells you to stop, drop or change something, do that instead of carrying on as before. If it only asks a question and gives no go-ahead, answer it and carry on.';
}
