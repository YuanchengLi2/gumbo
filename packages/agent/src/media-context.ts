import type {Asset} from '@dream/footage';

const captured=(asset:Asset)=>(asset as any).capturedAt as string|undefined;

/** Sources in capture order when known (what was shot first comes first), otherwise in import order. */
export function captureOrder(assets:Asset[]){return assets.map((asset,index)=>({asset,index})).sort((a,b)=>{const x=captured(a.asset),y=captured(b.asset);return x&&y?x.localeCompare(y)||a.index-b.index:x?-1:y?1:a.index-b.index;}).map(entry=>entry.asset);}
