import type Database from 'better-sqlite3';
import {existsSync} from 'node:fs';
import {lineDelta} from '@dream/contracts';

// Every step is idempotent, so a partially applied or re-run upgrade (restored backup, older user_version) cannot fail on existing objects.
const addColumn=(table:string,column:string,definition:string)=>(db:Database.Database)=>{if(!(db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);};
export function migrate(db:Database.Database,initialSchema:string){
 const current=db.pragma('user_version',{simple:true}) as number;
 const migrations:(string|((db:Database.Database)=>void))[]=[initialSchema,`CREATE TABLE IF NOT EXISTS embeddings(id TEXT NOT NULL,asset_id TEXT NOT NULL,model_id TEXT NOT NULL,dimensions INTEGER NOT NULL,vector BLOB NOT NULL,PRIMARY KEY(id,model_id)); CREATE INDEX IF NOT EXISTS embeddings_model ON embeddings(model_id,dimensions);`,addColumn('requests','identity','TEXT'),`CREATE TABLE IF NOT EXISTS context_chunks(id TEXT PRIMARY KEY,kind TEXT NOT NULL,owner TEXT NOT NULL,text TEXT NOT NULL,hash TEXT NOT NULL); CREATE VIRTUAL TABLE IF NOT EXISTS context_fts USING fts5(id UNINDEXED,text);`, engineSchema,decisionSchema,workflowIndexSchema,observationIndexSchema,`INSERT INTO meta(key,value) VALUES('timeline_features','manual-v1') ON CONFLICT(key) DO UPDATE SET value=excluded.value;`,addColumn('messages','attachments',"TEXT NOT NULL DEFAULT '[]'"), workspaceSchema, activitySchema, moveActivityEvents, sceneErrorSchema, addColumn('messages','selection',"TEXT NOT NULL DEFAULT '[]'"), withoutInterpretations];
 if(current>migrations.length)throw new Error('This project was saved by a newer Dream version. Update Dream before opening it.');
 if(current>0&&current<migrations.length){const backup=db.name+`.pre-engine-v${current}.sqlite`;if(!existsSync(backup))db.prepare('VACUUM INTO ?').run(backup);}
 for(let i=current;i<migrations.length;i++)db.transaction(()=>{const step=migrations[i];if(typeof step==='string')db.exec(step);else step(db);db.pragma(`user_version=${i+1}`);})();
}

// Activity events are rows, so a stream update writes one small row instead of re-serializing the whole turn.
const activitySchema=`
CREATE TABLE IF NOT EXISTS activity_events(turn_id TEXT NOT NULL,id TEXT NOT NULL,sequence INTEGER NOT NULL,json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(turn_id,id));
CREATE INDEX IF NOT EXISTS activity_turn_sequence ON activity_events(turn_id,sequence);
CREATE TABLE IF NOT EXISTS ai_usage(request_id TEXT PRIMARY KEY,turn_id TEXT,model TEXT NOT NULL,purpose TEXT,phase TEXT,parent TEXT,input_tokens INTEGER NOT NULL DEFAULT 0,cache_read INTEGER NOT NULL DEFAULT 0,cache_write INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,cost_usd REAL NOT NULL DEFAULT 0,duration_ms INTEGER,stop_reason TEXT,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ai_usage_turn ON ai_usage(turn_id);
`;
// Errors that scenes reported from the visible player or a chat preview, with the authored file position when known.
const sceneErrorSchema=`CREATE TABLE IF NOT EXISTS scene_errors(id TEXT PRIMARY KEY,asset_id TEXT,revision_id TEXT,draft TEXT,turn_id TEXT,message TEXT NOT NULL,stack TEXT,location TEXT,count INTEGER NOT NULL DEFAULT 1,first_at TEXT NOT NULL,last_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS scene_errors_revision ON scene_errors(revision_id); CREATE INDEX IF NOT EXISTS scene_errors_turn ON scene_errors(turn_id);`;
// Existing turns move their events into rows; the saved turn keeps only its status, phase, tasks and changes.
function moveActivityEvents(db:Database.Database){
 const insert=db.prepare('INSERT OR IGNORE INTO activity_events(turn_id,id,sequence,json,updated_at) VALUES(?,?,?,?,?)'),update=db.prepare('UPDATE meta SET value=? WHERE key=?');
 for(const row of db.prepare("SELECT key,value FROM meta WHERE key LIKE 'turn_activity:%'").all() as {key:string;value:string}[]){
  let value:any;try{value=JSON.parse(row.value);}catch{continue;}
  if(!Array.isArray(value?.events))continue;const turnId=row.key.slice('turn_activity:'.length);
  value.events.forEach((event:any,index:number)=>{if(event?.id)insert.run(turnId,String(event.id),Number.isFinite(event.sequence)?event.sequence:index,JSON.stringify(compactActivityEvent(event)),String(event.updatedAt??new Date().toISOString()));});
  delete value.events;update.run(JSON.stringify(value),row.key);
 }
}
/** Activity rows keep what the stream shows. Command output and details are bounded; file changes keep hashes and
 * line counts, and the text is read on demand through file_diff. */
export function compactActivityEvent<T extends Record<string,any>>(event:T):T{
 const out:any={...event};
 if(typeof out.output==='string'&&out.output.length>4000)out.output=out.output.slice(-4000);
 if(typeof out.detail==='string'&&out.detail.length>1000)out.detail=out.detail.slice(0,1000);
 if(Array.isArray(out.files))out.files=out.files.map(({before,after,truncated:_truncated,...file}:any)=>({...file,...(typeof file.added!=='number'?lineDelta(String(before??''),String(after??'')):{})}));
 return out;
}

const engineSchema=`
CREATE TABLE IF NOT EXISTS content_blobs(hash TEXT PRIMARY KEY,codec TEXT NOT NULL,bytes BLOB NOT NULL,raw_size INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS version_storage(version_id TEXT PRIMARY KEY,base_id TEXT,depth INTEGER NOT NULL,hash TEXT NOT NULL,document_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS execution_journal(scope TEXT NOT NULL,ordinal INTEGER NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(scope,ordinal));
CREATE TABLE IF NOT EXISTS execution_receipts(scope TEXT NOT NULL,call_id TEXT NOT NULL,name TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(scope,call_id));
CREATE TABLE IF NOT EXISTS context_dirty(kind TEXT NOT NULL,owner TEXT NOT NULL,PRIMARY KEY(kind,owner));
CREATE TABLE IF NOT EXISTS context_owners(kind TEXT NOT NULL,owner TEXT NOT NULL,revision TEXT NOT NULL,PRIMARY KEY(kind,owner));
CREATE TABLE IF NOT EXISTS project_decisions(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,scope TEXT NOT NULL,text TEXT NOT NULL,supersedes TEXT,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS visual_drafts(id TEXT PRIMARY KEY,revision TEXT NOT NULL,hash TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS context_owner ON context_chunks(kind,owner);
CREATE INDEX IF NOT EXISTS record_range ON index_records(kind,json_extract(json,'$.assetId'),json_extract(json,'$.start'),json_extract(json,'$.end'));
CREATE INDEX IF NOT EXISTS version_parent ON versions(parent_id);
CREATE TRIGGER IF NOT EXISTS context_asset_insert AFTER INSERT ON assets BEGIN INSERT INTO context_dirty SELECT 'asset',NEW.id WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind='asset' AND owner=NEW.id); END;
CREATE TRIGGER IF NOT EXISTS context_asset_update AFTER UPDATE ON assets BEGIN INSERT INTO context_dirty SELECT 'asset',NEW.id WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind='asset' AND owner=NEW.id); END;
CREATE TRIGGER IF NOT EXISTS context_asset_delete AFTER DELETE ON assets BEGIN INSERT INTO context_dirty SELECT 'asset',OLD.id WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind='asset' AND owner=OLD.id); END;
CREATE TRIGGER IF NOT EXISTS context_message_insert AFTER INSERT ON messages BEGIN INSERT INTO context_dirty SELECT 'conversation',NEW.id WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind='conversation' AND owner=NEW.id); END;
CREATE TRIGGER IF NOT EXISTS context_message_update AFTER UPDATE ON messages BEGIN INSERT INTO context_dirty SELECT 'conversation',NEW.id WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind='conversation' AND owner=NEW.id); END;
CREATE TRIGGER IF NOT EXISTS context_message_delete AFTER DELETE ON messages BEGIN INSERT INTO context_dirty SELECT 'conversation',OLD.id WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind='conversation' AND owner=OLD.id); END;
CREATE TRIGGER IF NOT EXISTS context_library_insert AFTER INSERT ON library BEGIN INSERT INTO context_dirty SELECT 'library',NEW.id WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind='library' AND owner=NEW.id); END;
CREATE TRIGGER IF NOT EXISTS context_library_update AFTER UPDATE ON library BEGIN INSERT INTO context_dirty SELECT 'library',NEW.id WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind='library' AND owner=NEW.id); END;
CREATE TRIGGER IF NOT EXISTS context_library_delete AFTER DELETE ON library BEGIN INSERT INTO context_dirty SELECT 'library',OLD.id WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind='library' AND owner=OLD.id); END;
CREATE TRIGGER IF NOT EXISTS context_meta_update AFTER UPDATE ON meta WHEN NEW.key IN ('preferences','task_plan','outline') BEGIN INSERT INTO context_dirty SELECT NEW.key,'project' WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind=NEW.key AND owner='project'); END;
CREATE TRIGGER IF NOT EXISTS context_meta_insert AFTER INSERT ON meta WHEN NEW.key IN ('preferences','task_plan','outline') BEGIN INSERT INTO context_dirty SELECT NEW.key,'project' WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind=NEW.key AND owner='project'); END;
INSERT OR IGNORE INTO context_dirty SELECT 'asset',id FROM assets;
INSERT OR IGNORE INTO context_dirty SELECT 'conversation',id FROM messages;
INSERT OR IGNORE INTO context_dirty SELECT 'library',id FROM library;
INSERT OR IGNORE INTO context_dirty SELECT key,'project' FROM meta WHERE key IN ('preferences','task_plan','outline');
`;

const decisionSchema=`
CREATE TRIGGER IF NOT EXISTS context_decision_insert AFTER INSERT ON project_decisions BEGIN INSERT INTO context_dirty SELECT 'decision',NEW.id WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind='decision' AND owner=NEW.id); END;
CREATE TRIGGER IF NOT EXISTS context_decision_update AFTER UPDATE ON project_decisions BEGIN INSERT INTO context_dirty SELECT 'decision',NEW.id WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind='decision' AND owner=NEW.id); END;
INSERT OR IGNORE INTO context_dirty SELECT 'decision',id FROM project_decisions;
`;

const workflowIndexSchema=`
CREATE TRIGGER IF NOT EXISTS context_workflow_insert AFTER INSERT ON meta WHEN NEW.key LIKE 'workflow:%' BEGIN INSERT INTO context_dirty SELECT 'workflow',substr(NEW.key,10) WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind='workflow' AND owner=substr(NEW.key,10)); END;
CREATE TRIGGER IF NOT EXISTS context_workflow_update AFTER UPDATE ON meta WHEN NEW.key LIKE 'workflow:%' BEGIN INSERT INTO context_dirty SELECT 'workflow',substr(NEW.key,10) WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind='workflow' AND owner=substr(NEW.key,10)); END;
INSERT OR IGNORE INTO context_dirty SELECT 'workflow',substr(key,10) FROM meta WHERE key LIKE 'workflow:%';
`;

// The agent looks at footage itself: earlier projects' shot descriptions and video observations leave the indexes it
// searches, observations stop being indexed, and asset entries are rebuilt without the footage map.
const withoutInterpretations=`
DROP TRIGGER IF EXISTS context_observation_insert;
DROP TRIGGER IF EXISTS context_observation_update;
DROP TRIGGER IF EXISTS context_observation_delete;
DELETE FROM context_fts WHERE id IN (SELECT id FROM context_chunks WHERE kind='observation');
DELETE FROM context_chunks WHERE kind='observation';
DELETE FROM context_owners WHERE kind='observation';
DELETE FROM context_dirty WHERE kind='observation';
DELETE FROM footage_fts WHERE kind<>'words';
INSERT INTO context_dirty SELECT 'asset',id FROM assets WHERE NOT EXISTS(SELECT 1 FROM context_dirty d WHERE d.kind='asset' AND d.owner=assets.id);
`;

const observationIndexSchema=`
CREATE TRIGGER IF NOT EXISTS context_observation_insert AFTER INSERT ON index_records WHEN NEW.kind='observations' BEGIN INSERT INTO context_dirty SELECT 'observation',NEW.id WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind='observation' AND owner=NEW.id); END;
CREATE TRIGGER IF NOT EXISTS context_observation_update AFTER UPDATE ON index_records WHEN NEW.kind='observations' BEGIN INSERT INTO context_dirty SELECT 'observation',NEW.id WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind='observation' AND owner=NEW.id); END;
CREATE TRIGGER IF NOT EXISTS context_observation_delete AFTER DELETE ON index_records WHEN OLD.kind='observations' BEGIN INSERT INTO context_dirty SELECT 'observation',OLD.id WHERE NOT EXISTS(SELECT 1 FROM context_dirty WHERE kind='observation' AND owner=OLD.id); END;
INSERT OR IGNORE INTO context_dirty SELECT 'observation',id FROM index_records WHERE kind='observations';
`;

const workspaceSchema=`
CREATE TABLE IF NOT EXISTS workspace_versions(version_id TEXT PRIMARY KEY,snapshot_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_publications(id TEXT PRIMARY KEY,identity TEXT NOT NULL,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_processes(id TEXT PRIMARY KEY,identity TEXT NOT NULL,status TEXT NOT NULL,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_files(path TEXT PRIMARY KEY,hash TEXT NOT NULL,characters INTEGER NOT NULL,chunks TEXT NOT NULL);
`;
