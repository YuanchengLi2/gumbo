/** What changed between two project-state messages: changed top-level fields with their new values, and for lists of
 * records (media, decisions) only the records added or changed and the IDs removed. Removed fields are null. */
export function stateChanges(before:any,after:any){
 const out:Record<string,unknown>={},b=before?.state??{},a=after?.state??{};
 const key=(item:any)=>item.id??item.assetId,records=(value:unknown)=>Array.isArray(value)&&value.every(item=>item&&typeof item==='object'&&typeof key(item)==='string');
 for(const field of new Set([...Object.keys(b),...Object.keys(a)])){
  if(JSON.stringify(b[field])===JSON.stringify(a[field]))continue;
  if(records(b[field])&&records(a[field])){const old=new Map<string,string>(b[field].map((item:any)=>[key(item),JSON.stringify(item)])),next=new Set(a[field].map(key));out[field]={addedOrChanged:a[field].filter((item:any)=>old.get(key(item))!==JSON.stringify(item)),removed:[...old.keys()].filter(id=>!next.has(id))};}
  else out[field]=a[field]??null;
 }
 if(JSON.stringify(before?.completionEvidence)!==JSON.stringify(after?.completionEvidence))out.completionEvidence=after?.completionEvidence??null;
 return out;
}
