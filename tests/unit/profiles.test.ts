import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {ONBOARDING as APP} from '@dream/contracts';
import {ONBOARDING,readProfile,saveProfile,type ProfilePorts,type ProfileRow} from '../../supabase/functions/dream-gateway/profiles';

/** One account's profile row in memory, keeping when it first answered as the database does. */
function memory(){
 const rows=new Map<string,ProfileRow>();
 const ports:ProfilePorts={read:async user=>rows.get(user)??null,save:async(user,row)=>{rows.set(user,{...row,onboarded_at:rows.get(user)?.onboarded_at??'2026-10-18T00:00:00.000Z'});}};
 return{rows,ports};
}

describe('onboarding answers',()=>{
 it('offers the same answers in the app, the gateway and the database',()=>{
  expect(ONBOARDING).toEqual(APP);
  const sql=readFileSync('supabase/migrations/202610180002_profiles.sql','utf8');
  expect(sql).toContain(`experience in (${ONBOARDING.experience.map(id=>`'${id}'`).join(',')})`);
  expect(sql).toContain(`heard in (${ONBOARDING.heard.map(id=>`'${id}'`).join(',')})`);
 });
 it('keeps the answers it knows and drops the rest',async()=>{
  const {rows,ports}=memory();
  expect(await saveProfile({name:'  Ada Lovelace  ',makes:['youtube','shorts','youtube','crypto'],experience:'expert',heard:'reddit'},'u1',ports)).toEqual({status:200,body:{saved:true}});
  expect(rows.get('u1')).toMatchObject({display_name:'Ada Lovelace',makes:['youtube','shorts'],experience:null,heard:'reddit'});
  expect((await saveProfile(null,'u1',ports)).status).toBe(400);
 });
 it('says when an account has not answered, and gives back what it did answer',async()=>{
  const {ports}=memory();
  expect(await readProfile('u1',ports)).toMatchObject({onboardedAt:null});
  await saveProfile({name:'Ada',makes:['podcasts'],experience:'pro'},'u1',ports);
  await saveProfile({name:'Ada L',makes:['podcasts'],experience:'pro'},'u1',ports);
  expect(await readProfile('u1',ports)).toEqual({name:'Ada L',makes:['podcasts'],experience:'pro',heard:null,onboardedAt:'2026-10-18T00:00:00.000Z'});
 });
});
