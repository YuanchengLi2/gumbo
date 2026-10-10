import {createHash} from 'node:crypto';
import {OpSchema,type Op} from '@dream/timeline';

function ordered(value:any):any {
 if(Array.isArray(value))return value.map(ordered);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,ordered(value[key])]));
 return value;
}
export function requestIdentity(ops:Op[],label:string,expected:string,turnId?:string|null,options?:{snapToSpeech?:boolean}){
 return createHash('sha256').update(JSON.stringify(ordered({ops:ops.map(op=>OpSchema.parse(op)),label,expected,turnId:turnId??null,...(options?.snapToSpeech===false?{snapToSpeech:false}:{})}))).digest('hex');
}
