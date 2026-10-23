/** Web pages for the agent's fetch_url when Gumbo runs in a browser: a page cannot read other sites (they do not allow
 * it), so the gateway reads them, and the app turns them into text as the desktop does (project-service web-fetch.ts).
 * Only public http(s) addresses are read: a name that resolves to a loopback, private or link-local address (a cloud's
 * metadata service among them) is refused, at the start and at every redirect, which is followed here so each hop is
 * checked. Text only, at most 2 MB, within 30 seconds. */
export type FetchUrlPorts={resolve:(host:string)=>Promise<string[]>;fetch:typeof fetch};
const MAX_BYTES=2_000_000,MAX_REDIRECTS=5;
const ipv4=/^\d{1,3}(\.\d{1,3}){3}$/;
export function privateAddress(address:string):boolean{
 if(ipv4.test(address)){const [a,b]=address.split('.').map(Number);return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||a>=224;}
 const v6=address.toLowerCase();return v6==='::1'||v6==='::'||v6.startsWith('fc')||v6.startsWith('fd')||v6.startsWith('fe80')||v6.startsWith('::ffff:')&&privateAddress(v6.slice(7));
}
async function refused(url:URL,ports:FetchUrlPorts){
 if(!['http:','https:'].includes(url.protocol))return 'Only http and https addresses can be read.';
 const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
 if(host==='localhost'||/\.(localhost|local|internal)$/.test(host))return 'Addresses on a local network are not read.';
 const addresses=ipv4.test(host)||host.includes(':')?[host]:await ports.resolve(host).catch(()=>[]);
 if(!addresses.length)return `${host} could not be found.`;
 return addresses.some(privateAddress)?'Addresses on a local network are not read.':undefined;
}
export async function handleFetchUrl(body:unknown,ports:FetchUrlPorts):Promise<{status:number;body:unknown}>{
 let target:URL;try{target=new URL(String((body as {url?:unknown})?.url??''));}catch{return{status:400,body:{error:'A web address is needed.'}};}
 const deadline=AbortSignal.timeout(30_000);
 for(let hop=0;hop<=MAX_REDIRECTS;hop++){
  const reason=await refused(target,ports);if(reason)return{status:400,body:{error:reason}};
  let response:Response;
  try{response=await ports.fetch(target,{redirect:'manual',signal:deadline,headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gumbo/1.0','Accept':'text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.5'}});}
  catch(error){return{status:502,body:{error:deadline.aborted?`${target} took too long to answer.`:`${target} could not be read: ${(error as Error).message}`}};}
  const location=response.headers.get('location');
  if(response.status>=300&&response.status<400&&location){await response.body?.cancel();target=new URL(location,target);continue;}
  const contentType=response.headers.get('content-type')??'',page={url:target.toString(),status:response.status,contentType};
  if(!/text\/|json|xml|javascript/i.test(contentType)){await response.body?.cancel();return{status:200,body:{...page,binary:true}};}
  // At most 2 MB is read; the rest of a long page is left.
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0,truncated=false;
  while(reader){const {done,value}=await reader.read();if(done)break;chunks.push(value);size+=value.length;if(size>=MAX_BYTES){truncated=true;await reader.cancel();break;}}
  const bytes=new Uint8Array(Math.min(size,MAX_BYTES));let at=0;for(const chunk of chunks){const part=chunk.subarray(0,bytes.length-at);bytes.set(part,at);at+=part.length;if(at>=bytes.length)break;}
  const charset=/charset=([\w-]+)/i.exec(contentType)?.[1]??'utf-8';let text:string;try{text=new TextDecoder(charset).decode(bytes);}catch{text=new TextDecoder().decode(bytes);}
  return{status:200,body:{...page,text,truncated}};
 }
 return{status:400,body:{error:'The address redirects too many times.'}};
}
