export type DocumentChange={path:string[];value?:unknown;remove?:true;collection?:{put:any[];remove:string[];order?:string[]}};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function documentDelta(before:any,after:any,path:string[]=[]):DocumentChange[]{
 if(equal(before,after))return[];
 if(Array.isArray(before)&&Array.isArray(after)&&[...before,...after].every(v=>v&&typeof v.id==='string')){
  const old=new Map(before.map(v=>[v.id,v])),next=new Map(after.map(v=>[v.id,v]));
  if(old.size===before.length&&next.size===after.length){const order=after.map(v=>v.id);return[{path,collection:{put:after.filter(v=>!equal(old.get(v.id),v)),remove:before.filter(v=>!next.has(v.id)).map(v=>v.id),...(!equal(before.map(v=>v.id),order)?{order}:{})}}];}
 }
 if(!before||!after||typeof before!=='object'||typeof after!=='object'||Array.isArray(before)||Array.isArray(after))return[{path,value:after}];
 const out:DocumentChange[]=[];for(const key of Object.keys(before))if(!Object.hasOwn(after,key))out.push({path:[...path,key],remove:true});for(const key of Object.keys(after))out.push(...documentDelta(before[key],after[key],[...path,key]));return out;
}
export function applyDocumentDelta<T>(input:T,delta:DocumentChange[]):T{
 let value:any=structuredClone(input);
 for(const change of delta){let parent=value;for(const part of change.path.slice(0,-1))parent=parent[part];const key=change.path.at(-1)!;
  if(change.collection){const previous=change.path.length?parent[key]:value,items=new Map(previous.map((item:any)=>[item.id,item]));change.collection.remove.forEach(id=>items.delete(id));change.collection.put.forEach(item=>items.set(item.id,item));const order:string[]=change.collection.order??previous.map((item:any)=>item.id).filter((id:string)=>items.has(id));if(order.length!==items.size||new Set(order).size!==order.length||order.some(id=>!items.has(id)))throw new Error('Invalid collection delta.');const result=order.map(id=>items.get(id));if(change.path.length)parent[key]=result;else value=result;}
  else if(!change.path.length)value=change.value;else if(change.remove)delete parent[key];else parent[key]=change.value;
 }return value;
}
