import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {CreationCommandSchema,type CreationCommand,type CreationResult} from '@dream/contracts';
import {CreationJobs} from '../../apps/project-service/src/creation-jobs';

function fixture(){const folder=mkdtempSync(join(tmpdir(),'dream-creation-'));return new ProjectDB(folder,'Creation');}
const audio=(requestId:string,expectedVersionId:string):CreationCommand=>({type:'generate_sfx',presetId:'sfx_01',requestId,expectedVersionId});
const visual=(requestId:string,expectedVersionId:string)=>CreationCommandSchema.parse({type:'create_visual',requestId,expectedVersionId,placement:'spine',start:{kind:'project',at:'start',offsetSec:0},definition:{schemaVersion:1,id:'scene',title:'Scene',code:'export default function Scene(){return null}',parameters:{},parameterSchema:{},width:64,height:64,fps:30,durationInFrames:1,seed:1}});
const result:CreationResult={assetId:'asset',revisionId:'revision',definitionId:'definition',placed:false};

it('serializes audio and visuals in one queue and cancels queued work without executing it',async()=>{
 const db=fixture(),jobs=new CreationJobs(db,()=>{}),calls:string[]=[];let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
 jobs.register('audio',async command=>{calls.push(command.requestId);await waiting;return result;});jobs.register('visual',async command=>{calls.push(command.requestId);return result;});
 try{
  const first=jobs.run(audio('audio',db.head()),'turn'),second=jobs.run(visual('visual',db.head()),'turn');
  const canceled=expect(second).rejects.toMatchObject({name:'AbortError'});await Promise.resolve();expect(calls).toEqual(['audio']);jobs.cancel('visual');release();await first;await canceled;expect(calls).toEqual(['audio']);
  await jobs.resume('visual');expect(calls).toEqual(['audio','visual']);expect(db.state().jobs.every(job=>job.step==='creation'&&job.status==='complete')).toBe(true);
  await jobs.run(audio('audio',JSON.parse(db.getMeta('creation:audio')!).command.expectedVersionId),'turn');expect(calls).toHaveLength(2);
  await expect(jobs.run(visual('audio',db.head()),'turn')).rejects.toThrow('different content');
 }finally{release();await jobs.close();db.close();}
});

it('migrates durable legacy receipts and resumes only interrupted work after reopen',async()=>{
 let db=fixture();const folder=db.folder,command=audio('old',db.head());db.setMeta('generation:old',JSON.stringify({command,turnId:'old-turn',status:'complete',result}));db.setMeta('visual:pending',JSON.stringify({command:visual('pending',db.head()),turnId:'old-turn',status:'running'}));db.close();
 db=new ProjectDB(folder);const jobs=new CreationJobs(db,()=>{});let runs=0;jobs.register('visual',async()=>{runs++;return result;});
 try{jobs.recover();expect(await jobs.resume('old')).toEqual(result);expect(runs).toBe(0);expect(JSON.parse(db.getMeta('creation:pending')!).status).toBe('interrupted');await jobs.resume('pending');expect(runs).toBe(1);expect(JSON.parse(db.getMeta('creation:pending')!).status).toBe('complete');}finally{await jobs.close();db.close();}
});
