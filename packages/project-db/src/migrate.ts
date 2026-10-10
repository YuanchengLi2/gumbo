import type Database from 'better-sqlite3';
import {existsSync} from 'node:fs';

// Every step is idempotent, so a partially applied or re-run upgrade (restored backup, older user_version) cannot fail on existing objects.
const addColumn=(table:string,column:string,definition:string)=>(db:Database.Database)=>{if(!(db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);};
export function migrate(db:Database.Database,initialSchema:string){
 const current=db.pragma('user_version',{simple:true}) as number;
 const migrations:(string|((db:Database.Database)=>void))[]=[initialSchema,`CREATE TABLE IF NOT EXISTS embeddings(id TEXT NOT NULL,asset_id TEXT NOT NULL,model_id TEXT NOT NULL,dimensions INTEGER NOT NULL,vector BLOB NOT NULL,PRIMARY KEY(id,model_id)); CREATE INDEX IF NOT EXISTS embeddings_model ON embeddings(model_id,dimensions);`,addColumn('requests','identity','TEXT'),`CREATE TABLE IF NOT EXISTS context_chunks(id TEXT PRIMARY KEY,kind TEXT NOT NULL,owner TEXT NOT NULL,text TEXT NOT NULL,hash TEXT NOT NULL); CREATE VIRTUAL TABLE IF NOT EXISTS context_fts USING fts5(id UNINDEXED,text);`, engineSchema,decisionSchema,workflowIndexSchema,observationIndexSchema,`INSERT INTO meta(key,value) VALUES('timeline_features','manual-v1') ON CONFLICT(key) DO UPDATE SET value=excluded.value;`,addColumn('messages','attachments',"TEXT NOT NULL DEFAULT '[]'"), workspaceSchema];
 if(current>migrations.length)throw new Error('This project was saved by a newer Dream version. Update Dream before opening it.');
 if(current>0&&current<migrations.length){const backup=db.name+`.pre-engine-v${current}.sqlite`;if(!existsSync(backup))db.prepare('VACUUM INTO ?').run(backup);}
 for(let i=current;i<migrations.length;i++)db.transaction(()=>{const step=migrations[i];if(typeof step==='string')db.exec(step);else step(db);db.pragma(`user_version=${i+1}`);})();
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
