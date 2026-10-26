import {describe,expect,it,vi} from 'vitest';
vi.mock('../../../apps/extension/src/background/db',()=>({getSealed:async()=>undefined,putSealed:async()=>{}}));
vi.mock('../../../apps/extension/src/background/capture',()=>({capturePage:async()=>{}}));
const {writeOf,isConnectorTool}=await import('../../../apps/extension/src/background/connectors');

describe('connector writes ask first, reads do not',()=>{
 it('asks before a draft, an event, or SQL that changes anything',()=>{
  expect(writeOf('gmail_draft',{to:'dana@example.com',subject:'Thursday'})).toBe('Write a Gmail draft to dana@example.com: “Thursday”?');
  expect(writeOf('calendar_create',{title:'Planning',start:'2026-10-29T15:00:00-07:00'})).toMatch(/^Add “Planning” to your calendar, /);
  expect(writeOf('supabase_sql',{project:'abcd',sql:'delete from users'})).toMatch(/^Run this on abcd: delete from users\?$/);
  expect(writeOf('supabase_sql',{project:'abcd',sql:'select 1; drop table users'})).toBeDefined();
  expect(writeOf('supabase_sql',{project:'abcd',sql:'with x as (update users set a=1 returning *) select * from x'})).toBeDefined();
 });
 it('lets reads through',()=>{
  expect(writeOf('supabase_sql',{project:'abcd',sql:'select count(*) from auth.users;'})).toBeUndefined();
  expect(writeOf('gmail_search',{query:'from:dana'})).toBeUndefined();
  expect(writeOf('stripe_list',{resource:'charges'})).toBeUndefined();
 });
 it('knows its own tools',()=>{
  expect(isConnectorTool('vercel_build_log')).toBe(true);expect(isConnectorTool('click')).toBe(false);
 });
});
