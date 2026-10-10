import {createHash} from 'node:crypto';
/** Progress labels do not change an operation's identity or its retry history. */
export function toolIdentity(name:string,input:unknown){
 const data=input&&typeof input==='object'&&!Array.isArray(input)?Object.fromEntries(Object.entries(input).filter(([key])=>key!=='progress')):input;
 const canonical=JSON.stringify({name,input:data},(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
 return createHash('sha256').update(canonical).digest('hex');
}
