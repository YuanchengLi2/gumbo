import {PGlite} from '@electric-sql/pglite';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

/** The gateway's database, for tests: a real Postgres (PGlite, in this process) with every migration in supabase/migrations
 * applied in order, over the few parts of Supabase they lean on (the auth and storage schemas, its roles). */
export async function supabaseDb(){
 const db=new PGlite();
 await db.exec(`
  do $$ begin
   if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
   if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
   if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
  end $$;
  create schema auth;create table auth.users(id uuid primary key,email text,is_anonymous boolean not null default false);
  create function auth.uid() returns uuid language sql stable as $f$ select null::uuid $f$;
  create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
 const folder=join(__dirname,'..','..','supabase','migrations');
 for(const file of readdirSync(folder).filter(f=>f.endsWith('.sql')).sort()){
  try{await db.exec(readFileSync(join(folder,file),'utf8'));}catch(error){throw new Error(`${file}: ${(error as Error).message}`);}
 }
 return db;
}
