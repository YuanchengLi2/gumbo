import type {MemorySyncPorts,SyncProfileRow,SyncRecord} from '../../../supabase/functions/dream-gateway/memory-sync';
import {newer} from '../src/shared/sync-engine';
/** The synced copy in memory, for the stand-in gateway and the unit tests: the same rules as the migration's functions
 * (supabase/migrations/202610260001_memory_sync.sql, checked against Postgres in tests/integration/memory-sync.test.ts),
 * behind the gateway's own handler. `accounts` is open, so tests can look at exactly what the server holds. */
export type SyncAccount={profile:Omit<SyncProfileRow,'limit_bytes'>;rows:Map<string,SyncRecord&{size:number}>};
export function memorySyncServer(limitBytes=256*1024*1024){
 const accounts=new Map<string,SyncAccount>();let seq=0;
 const ports:MemorySyncPorts={
  profile:async user=>{const a=accounts.get(user);return a?{...a.profile,limit_bytes:limitBytes}:null;},
  create:async(user,profile)=>{if(accounts.has(user))return false;accounts.set(user,{profile:{...profile,bytes:0},rows:new Map()});return true;},
  reset:async user=>{accounts.delete(user);},
  push:async(user,keyId,rows)=>{
   const a=accounts.get(user);if(!a||a.profile.key_id!==keyId)return null;
   let applied=0,taken=0,full=false;const older:string[]=[];
   for(const row of rows){
    const old=a.rows.get(row.sid);
    if(old&&!newer(row,old)){older.push(row.sid);taken++;continue;}
    const size=row.payload.length,grows=size-(old?.size??0);
    if(grows>0&&a.profile.bytes+grows>limitBytes){full=true;break;}
    a.rows.set(row.sid,{...row,seq:++seq,size});a.profile.bytes+=grows;applied++;taken++;
   }
   return{applied,older,taken,full,bytes:a.profile.bytes,limit:limitBytes};
  },
  pull:async(user,keyId,since,limit,maxBytes)=>{
   const a=accounts.get(user);if(!a||a.profile.key_id!==keyId)return null;
   const after=[...a.rows.values()].filter(r=>r.seq!>since).sort((x,y)=>x.seq!-y.seq!);
   const rows:SyncRecord[]=[];let bytes=0;
   for(const r of after.slice(0,limit)){if(rows.length&&bytes+r.size>maxBytes)break;bytes+=r.size;rows.push({sid:r.sid,seq:r.seq,at:r.at,device:r.device,version:r.version,payload:r.payload});}
   return{rows,more:after.length>rows.length};
  },
 };
 return{ports,accounts};
}
