/** A tool call's arguments as far as they have streamed: `{"url":"https://exa` reads as {url:'https://exa'}, so its row
 * can say where it is going before the call is complete. Unfinished strings are closed, an unfinished key or value is
 * dropped, and open objects and arrays are closed; anything that still cannot be read gives undefined. */
export function partialJson(text:string):unknown{
 const t=text.trim();if(!t)return undefined;
 try{return JSON.parse(t);}catch{}
 const stack:string[]=[];let inString=false,escaped=false,out='';
 for(const c of t){
  out+=c;
  if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
  if(c==='"')inString=true;else if(c==='{'||c==='[')stack.push(c==='{'?'}':']');else if(c==='}'||c===']')stack.pop();
 }
 if(escaped)out=out.slice(0,-1);
 if(inString)out+='"';
 // A dangling comma, colon or key with no value is cut back to the last complete member.
 for(let attempt=0;attempt<4;attempt++){
  const closed=out.replace(/[\s,]*$/,'').replace(/,\s*"[^"]*"\s*:?\s*$/,'').replace(/\{\s*"[^"]*"\s*:?\s*$/,'{').replace(/:\s*$/,': null')+stack.slice().reverse().join('');
  try{return JSON.parse(closed);}catch{}
  out=out.replace(/[^,{[]*$/,'');if(!out)break;
 }
 return undefined;
}
