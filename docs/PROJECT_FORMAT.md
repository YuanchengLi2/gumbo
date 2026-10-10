# Dream project format, version 1

## October 7, 2026 additions

Timeline schemaVersion remains 1. Framing accepts optional rotation, flipX, flipY, opacity, exposure, contrast, saturation and temperature; absent fields retain legacy behavior. Canvas presets are shared helpers, not a second settings format.

SQLite migration 10 adds messages.attachments as JSON text with an empty-array default. Existing backup-before-migration behavior remains active. Project metadata records first_draft_version, activity_steps, turn_start_version, bootstrap, submitted:<requestId>, pending_request and file_wait. first_draft_version is not cleared by undo. turn_activity:<turnId> stores ordered execution steps, their current statuses, a starting version, completed file-operation receipts and the final change list. Message pages include the associated activity so older requests preserve their progress history. Completion and activity metadata are committed together. Older populated projects receive an initial milestone when opened.

Bootstrap records the request ID, prompt, selected paths, registered asset IDs and preparation/dispatched/interrupted state. Stable per-import IDs permit recovery after copying but before the next checkpoint. User message attachments contain project asset IDs. Display-name changes do not rename the automatic project folder.

Installation-scoped projects.json, file-access.json, file-operations/<hash>.json and file-backups are outside project databases. File proposals contain normalized paths, original-request identity, fingerprints, optional text before/after content, completion count and execution status. Credentials are not written to projects or operation journals.

```
Project.dreamproj
.dream/project.sqlite
.dream/writer.lock
.dream/backups/
Media/Originals/
Media/Proxies/
Media/Analysis/
Media/Generated/
Exports/
```

The JSON manifest contains `format: dream`, `schemaVersion: 1`, a stable project ID and the fixed database location `.dream/project.sqlite`. The database uses WAL and foreign-key enforcement. Migrations run transactionally and reject newer unsupported database versions. The manifest ID must agree with database metadata.

Timeline snapshots contain asset IDs, not paths. Source registry entries use `project:` relative paths for files inside the project and absolute references for external originals. Moving a collected project preserves asset, clip, word, version and branch IDs. Word anchors include a clip occurrence, so repeating a source does not make attachments ambiguous.

Splitting a still divides its hold duration in project frames. Splitting footage remaps attachments and occurrence-specific caption overrides to the appropriate side. Source replacement accepts explicit word correspondence; without correspondence, word attachments become proportional clip anchors. It never assigns unrelated replacement dialogue the identity of an old word.

Every editing batch creates a version. Consecutive batches in one AI turn share an undoable action. Undo, redo and restore create new heads and retain existing snapshots. Branches have their own heads and action histories. A new edit after undo clears the redo action path, not the historical version records.

## Collection and recovery

Collection uses SQLite's backup API to capture a coherent database. It copies files into a temporary sibling directory, rewrites the backup's source registry, closes and checkpoints the copied database, then renames the completed folder into place. Missing originals prevent completion. The destination must be empty and outside the source project. External originals are never moved, rewritten or deleted.

Processing writes each derived artifact to a unique temporary file. Successful production and validation precede its rename to the final path. Interrupted output therefore cannot be mistaken for a completed proxy or audio master. Python cached stage results carry a pipeline revision and content hash; corrupt cache files are recomputed.

Opening through the project service acquires an exclusive writer lock. A live writer prevents another open. An unsuccessful acquisition does not own or remove that lock. A stale lock can be recovered only when its recorded process is confirmed absent.

Account sessions, public configuration, model downloads and recent-project lists are stored in Electron application data. They are not copied into portable project folders.

## Creative requests and immutable media

All new creative requests use durable `creation:<requestId>` metadata with the validated command, owning turn, status and completion result. Completed legacy `generation:` and `visual:` receipts are read into this common namespace without replaying placement. Opening recovers queued/running requests as interrupted; Resume reuses their original command and turn. Completion receipts are committed in the asset-registration/timeline transaction.

Generated visual assets reference a project-relative sequence directory, source fps, frame count and immutable revision ID. Each PNG has a SHA-256 hash. The revision identity includes both its recipe cache key and ordered pixel hashes, so an uncached nondeterministic render cannot silently replace an older saved edit. Captured definitions and revision metadata are stored in the local library. Preview, exports and older versions resolve the same asset IDs.

The application-data visual recipe cache is regenerable. The captured frame sequences in `Media/Generated/` are authoritative dependencies of saved project versions; retain or collect them with the project. Project folders contain no account credentials.

SQLite migration 4 adds the disposable project-context chunk/FTS index. Stable record/chunk IDs and content hashes support bounded retrieval of timeline items, beats, asset metadata, local conversations and saved visual code. Changes to the project head and index revision refresh it; deleted timeline items leave the current-context index while immutable version history remains available. This index contains no account credentials and does not upload project files. Saved visual/audio definitions remain project-local library revisions.
