import {mkdir,readdir,readFile,writeFile,unlink,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

/** Every edit's log reaches Gumbo on its own (the gateway's edit-logs.ts), so costly or broken edits can be found without
 * anyone pressing Send log. When a run of a request ends (complete, failed, stopped, or cut off by the app closing) its
 * log (turn-log.ts) is written to a queue folder at once and sent from there in the background: an edit never waits on
 * it. Offline, signed out or a gateway that is down, it stays queued and is tried again later, after a restart too, for
 * two weeks. Each run is sent once: a sent run is remembered here, and the gateway keeps one row per request. */
export const MAX_LOG_BYTES=1_900_000,KEEP_MS=14*86_400_000,REMEMBERED=3000;
export type EditLogEntry={key:string;turnId:string;accountId:string;appVersion:string;platform:string;training:boolean;queuedAt:number;attempts:number;nextAt:number;log:Record<string,unknown>};
export type EditLogPorts={
 /** The signed-in account, if any: a log goes only to the account whose edit it was. */
 account():string|undefined;
 /** Posts one log and answers the gateway's status (0 when it could not be reached). */
 send(entry:Omit<EditLogEntry,'attempts'|'nextAt'|'queuedAt'|'accountId'>):Promise<number>;
 appVersion:string;platform:string;training():boolean;now?():number;
};
/** Waits after a failed send: a minute, doubling, at most six hours. */
export const backoff=(attempts:number)=>Math.min(6*3_600_000,60_000*2**Math.max(0,attempts-1));
/** What a run is known by: its request and when the run started, so a resumed request sends its longer log again. */
/** The editor service already keeps a log under 1.5 MB; one that still comes out bigger is sent as its summary alone. */
export const bounded=(log:Record<string,unknown>)=>{const size=JSON.stringify(log).length;if(size<=MAX_LOG_BYTES)return log;
 const {version,turnId,project,request,outcome,timing,cost,totals}=log as any;return{version,turnId,project,request:String(request??'').slice(0,4000),outcome,timing,cost,totals,tooLarge:size};};
export const runKey=(turnId:string,log:any)=>`${turnId}@${log?.timing?.runStartedAt??log?.timing?.startedAt??'none'}`;

export class EditLogs{
 private sent?:Set<string>;private sending?:Promise<void>;private timer?:ReturnType<typeof setInterval>;
 constructor(readonly folder:string,private ports:EditLogPorts){}
 private now(){return this.ports.now?.()??Date.now();}
 private file(key:string){return join(this.folder,createHash('sha256').update(key).digest('hex').slice(0,40)+'.json');}
 private async remembered(){if(!this.sent){await mkdir(this.folder,{recursive:true});this.sent=new Set(await readFile(join(this.folder,'sent.json'),'utf8').then(t=>JSON.parse(t) as string[],()=>[]));}return this.sent;}
 private async remember(key:string){const sent=await this.remembered();sent.add(key);const kept=[...sent].slice(-REMEMBERED);this.sent=new Set(kept);await this.write(join(this.folder,'sent.json'),JSON.stringify(kept));}
 /** Written beside and renamed, so a crash mid-write never leaves half a file. */
 private async write(path:string,text:string){await writeFile(path+'.tmp',text);await rename(path+'.tmp',path);}
 /** A run ended: its log is queued on disk and sending starts in the background. Nothing is queued signed out, twice, or
  * for a log the editor service could not build. */
 async capture(turnId:string,log:unknown){
  const accountId=this.ports.account();if(!accountId||!turnId||!log||typeof log!=='object')return false;
  const key=runKey(turnId,log),path=this.file(key);
  if((await this.remembered()).has(key)||await readFile(path).then(()=>true,()=>false))return false;
  const entry:EditLogEntry={key,turnId,accountId,appVersion:this.ports.appVersion,platform:this.ports.platform,training:this.ports.training(),queuedAt:this.now(),attempts:0,nextAt:0,log:bounded(log as Record<string,unknown>)};
  await this.write(path,JSON.stringify(entry));void this.flush();return true;
 }
 /** Sends what is due, one at a time; a second call while sending waits for the same pass. */
 flush(){return this.sending??=this.pass().finally(()=>{this.sending=undefined;});}
 private async pass(){
  await this.remembered();const names=(await readdir(this.folder).catch(()=>[] as string[])).filter(n=>/^[0-9a-f]{40}\.json$/.test(n));
  for(const name of names){
   const path=join(this.folder,name),entry=await readFile(path,'utf8').then(t=>JSON.parse(t) as EditLogEntry,()=>undefined);
   if(!entry?.key){await unlink(path).catch(()=>{});continue;}
   if(this.sent!.has(entry.key)||this.now()-entry.queuedAt>KEEP_MS){await unlink(path).catch(()=>{});continue;}
   // Another account's edit waits until that account signs in here again.
   if(entry.nextAt>this.now()||entry.accountId!==this.ports.account())continue;
   const {attempts:_a,nextAt:_n,queuedAt:_q,accountId:_id,...body}=entry;
   const status=await this.ports.send(body).catch(()=>0);
   // Kept (200) or refused for good (a log the gateway cannot take): done. Anything else is tried again later.
   if(status===200||status===400||status===413){await this.remember(entry.key);await unlink(path).catch(()=>{});continue;}
   const attempts=entry.attempts+1;await this.write(path,JSON.stringify({...entry,attempts,nextAt:this.now()+backoff(attempts)})).catch(()=>{});
   // Unreachable: the rest would fail the same way, so they wait for the next pass.
   if(status===0)break;
  }
 }
 /** Sends at start (after the app has settled) and every few minutes while it runs. */
 start(delayMs=30_000,everyMs=5*60_000){setTimeout(()=>void this.flush(),delayMs).unref?.();this.timer=setInterval(()=>void this.flush(),everyMs);this.timer.unref?.();}
 stop(){if(this.timer)clearInterval(this.timer);}
}
