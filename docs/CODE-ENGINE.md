# Code creation engine

This document describes the production engine as of October 11, 2026: the orchestrator (`packages/orchestrator/src/code-director.ts`, `code-agent.ts`, `task-graph.ts`), the scene engine (`packages/scene-engine`) and the workspace that compiles, checks and publishes the agent's work (`apps/project-service/src/code-workspace.ts`).

## The division of labor

The agent makes the edit with code: it writes and runs whatever programs a request needs (any language, any package it installs) and changes the project document. The engine provides the rest:

| The agent writes | The engine provides |
|---|---|
| The project document (`project.json`): what plays when (clips and their ranges, speed, framing, grade, transitions, overlays, effects, scenes, music, sound, captions), changed directly for a small change or by a program that reads it, the sources and `context/` and writes it | Validation against the sources, publish checks of what changed (footage used twice, cuts inside words, long silences), publication, versions and undo, the live player and Export |
| Scene components (React, Remotion timing, three.js through React Three Fiber, d3, SVG, Canvas, CSS) | One prebuilt runtime with those libraries, bundled fonts, project media and resources by name, frame-exact video, textures, a ready 3D scene, fit-to-box text, safe areas and beat timing; compilation in milliseconds |
| Produced media under `output/` (processed footage, generated images and audio) | Hash-addressed storage and placement as `output:<id>` |
| Score files (`src/music/*.score.json`) and sound designs | Expansion, validation and synthesis into audio assets with beat times |
| Which media to use, and what to look at in it | Finding media on the computer by capture date, importing, proxies, thumbnails, waveforms, loudness and cloud transcripts |

Nothing renders the edit during chat. Published work runs live in the right panel; only Export renders. Source footage may be processed and looked at freely.

## Who does the work

One editing agent owns each request from start to finish: it looks at what it needs, decides, edits, publishes, checks and replies. Every role runs on Sonnet 5.5 (`models.agent`); there is no tier to choose and no hand-over to another model.

| Request | Model | Role |
|---|---|---|
| **An edit** | Sonnet 5.5 | **solo**: the editing agent. When an attempt keeps failing it is told to diagnose (the second identical failure returns `diagnosisRequired`), and the third identical failure, or the fourth similar one, ends the request as blocked with its work saved. `delegate` has helpers build separate pieces. |
| Pieces the agent delegates | Sonnet 5.5 | **worker** (a helper): one isolated conversation per task that writes only its declared paths. It never edits `project.json`, publishes, imports media or changes the user's computer; the agent places its outputs and publishes. |
| A reply: a question, a script, ideas | Sonnet 5.5 | **readonly**: answers directly, looking at what it needs with the read-only tools. |
| Planning, and approved plans | Sonnet 5.5 | **readonly** planner returning an editable plan; the approved steps run as one continuing editing-agent conversation. |

Earlier projects may hold `ai.escalation` events from the Haiku, Sonnet and Opus ladder; `scripts/session-report.ts` still lists them.

### Routing, permission modes and effort

Exact local instructions, "continue" phrasing and plain follow-up edits on a titled project with a timeline (`plainEdit`: "make it warmer", "add crossfades") skip the classifier. Everything else is classified by Sonnet with a provider JSON schema, falling back to the local heuristic (`routeCodeRequest`) if classification fails. Routes are `question`, `local`, `plan` and `continue` (only while a stopped request exists). The routing schema still has an `intelligence` field for older gateways; the app ignores it.

The composer chooses the permission mode and the effort:

- **Edit automatically** (default): routed as above.
- **Plan first**: every request is routed to `plan`. Approving a plan (the button or "do it") switches the composer back to Edit automatically.
- **Ask only**: every request is routed to `question`; nothing in the project changes.
- **Effort** Auto, Low, Medium or High. Auto is medium on Sonnet and xhigh on Haiku (to make up for the smaller model), except the router, which classifies within a 2K-token allowance and stays low; `DREAM_BUILD_WORKER_EFFORT` overrides helpers only, for measurement. A chosen effort applies to every model of that request except the router. A phase whose response spent its whole output allowance thinking steps its effort down.

## Helpers as a task graph

`delegate` takes one to eight tasks `{id,title,brief,writes,after,context}` and runs them as a dependency graph (`runTaskGraph`). It is meant only for independent pieces that take real work, such as several new scenes or scenes plus music; the agent does everything else itself.

- A task starts as soon as every task in its `after` list completed, with at most `engineBudgets.maxWorkers` (4) running at once. Dependents of a blocked task are skipped with that reason.
- Every task declares `writes` (path prefixes such as `src/intro/`). No task may claim `project.json` or the whole workspace; tasks that can run at the same time need disjoint writes; dependencies must name tasks in the call and form no cycle (`validateDelegation`). Writes are also confined to the declared scopes at execution.
- `context` attaches up to 12 workspace files (60K characters in total) to the brief, so helpers do not explore to find them.
- The graph and its reports are saved per call (`taskgraph:<turn>:<call>`); a resumed request does not rerun finished tasks.

Every helper of one call starts from the same project snapshot (overview, timeline outline, project notes, media facts, capabilities, computer status, decisions), marked for caching, followed by its task, scope and context files. Later helpers start once the first helper's stream begins (at most 5 s), so they read that cached prefix instead of each writing it. A blocked helper is retried once with the reason, unless the block needs the user. Reports carry the summary, changed files, scene errors, attempts, duration and cost. The agent cannot finish complete while a task it delegated is still blocked or was skipped.

Commands and publication run one at a time within the workspace (`CodeWorkspace.exclusive`).

## Scenes

A scene is a default-exported React component in `src/**/*.tsx` (or `.ts`, `.jsx`, `.js`), declared in `project.json` outputs as `{id, path, kind:'scene', ...}`. Width, height, fps and duration default to the project's; `props` lets one component serve many shots; `transparent` makes it an overlay. The engine reference the agent reads is `packages/scene-engine/reference/api.md`, mirrored into the cached system prompt.

- **Runtime**: five chunks (core, three, d3, icons, noise) built by `scripts/build-engine.ts` into `resources/staged/engine/<version>/`, sharing one React, Remotion and three.js through a module registry. Each scene document mounts the component through Remotion's `Thumbnail`, one frame at a time.
- **Determinism**: a frame is acknowledged only after React commits, 3D roots advance to the frame time, and textures, files, fonts, images and video seeks finish. Randomness is seeded by the revision and clocks report frame time, so frames are identical in any order.
- **Isolation**: each scene runs in its own sandboxed document, served from `dream-engine://` in the player and from the loopback render server during export. Its CSP allows only that origin plus data and blob URLs; there is no network.
- **Compilation**: publication compiles scene outputs with esbuild in milliseconds. Engine modules resolve to the shared runtime; packages installed in `Workspace/node_modules` are bundled; anything else fails with an install hint. Files under `resources/` (24 MB per file, 96 MB in total) are copied to `Media/Engine/files` and served by name. Any input change recompiles and refreshes the scene on the timeline.
- **Export**: 3D export finds a working WebGL backend on first use (ANGLE, then SwiftShader) and remembers it.
- **Legacy HTML scenes** (`window.renderFrame`) are unchanged. `bundle_scene` and the HTML guide exist only in advanced mode (`DREAM_AGENT_ADVANCED_TOOLS=1`).

### Errors without background runs

Nothing runs scene code in the background. Writing scene code returns a compile check; `check_outputs` compiles drafts that the user sees live in the stream. Runtime errors come from scenes playing in the visible player or a chat preview: the stack is mapped through the scene's source map to `src/file:line`, stored per scene revision or draft, added to the agent's project state, and a request cannot finish complete while a scene changed in it reports errors.

### Music and sound

Music is a score file (`src/music/*.score.json`) in compact notation (drum step patterns, note strings, chord progressions, arpeggios, sections, repeats) or a full score document; Dream expands and validates it, naming the field and token at fault. Sound effects are a sound design file or a named preset. Synthesis runs in the procedural audio worker and is cached by content. Music assets carry beat times that a scene reads with `useBeats(name)`. Scenes are silent; sound goes on the timeline.

## Footage: facts, and the agent's own looks

Nothing interprets the footage for the agent. Import prepares what the player and Export need (proxy, playback audio, thumbnail, waveform, loudness for auto-level) and runs cloud transcription. The agent is given facts per source: length, size, frame rate, sound, path, capture time, its own earlier notes (`sourceNotes`), and the transcript's state (`status`, `transcribedUntilSec`, word count, and the file `context/transcripts/<id>.json`, whose `coverage` shows how far transcription has got). The files in `context/` are never stale copies: between tool calls they are rewritten, and while a command runs each transcript file is rewritten as its transcription advances and `assets.json` (with `Sources/`) when a source is added, so a program can wait on them. `read_transcript` reads the same words, including the part transcribed so far while a long recording is still running.

The agent decides what to look at and what to measure:

- `view_media` returns source frames at the times it picks (a range up to 8 seconds, or 60 for an overview), with the timed words in the range, and audio measurements on request. Five or more frames come back tiled on 4x3 contact sheets; a range of a second or two returns full-size frames.
- `read_file` returns any image in the workspace as the image itself, so the agent can look at frames, crops, plots or sheets its own code made.
- `run_command` measures with code: ffmpeg, ffprobe, Node and Python are on PATH, and any other tool may be installed.

## Media from the computer

- `find_media` finds photos, videos and audio by capture date: today, yesterday, this week, the last 7 days, or explicit dates, in the computer's local time.
  - By default it searches camera rolls, phone sync folders (OneDrive, iCloud), Videos, Downloads, Desktop and memory-card DCIM folders.
  - Capture time comes from each file's own metadata without decoding: QuickTime creation date with time zone, MP4 creation time, or EXIF `DateTimeOriginal` in JPEG/HEIC/TIFF, falling back to the file time.
  - It returns a capture-sorted catalog marked with what is already imported.
- `import_media` imports up to 100 files in one call.
  - An unchanged file (same path, size and modification time) is imported once.
  - Asset IDs, capture times and durations return immediately; the agent looks at what it needs itself. Proxies, thumbnails and transcripts continue in the background; transcription runs two sources at a time and skips clips under two seconds.
- `import_resources` brings folders and archives (only matching entries are extracted) into `resources/` for scenes.

With computer access granted the agent imports automatically; changes to computer files still go through `propose_file_changes` and the user's approval. A dropped folder grants a read-only subtree. Phones connected over MTP are reached through their synced folders.

## What the user sees

Every role says in one sentence what it is about to do, adds brief updates when something matters, writes out scripts or copy before building, and ends with a short recap. Between-tool notes are shown as progress; reasoning itself is never shown. Each helper task is a row holding its own notes and actions. Imported and inspected media, and published or draft scenes, appear as thumbnails and live previews in the stream. The run monitor shows the current step, elapsed time, tasks, and the request's cost, tokens and time for Dream (the editing agent) and each helper.

## The agent loop

Each phase is a checkpointed conversation. Tool calls and results are persisted as complete pairs; a replayed call ID returns its saved receipt and never repeats an effect.

- **Spending limit**: each request may spend $3 (`DREAM_REQUEST_BUDGET_USD`), checked before every model call; at the limit it stops as interrupted with its work saved, and each resume allows the same amount again.
- **Step limits**: 80 model calls per role. At the limit the request reports a blocker with its work saved, never completion.
- **Text-only responses**: nudged at most twice. Engine nudges are tagged and dropped at compaction.
- **Repeated failures**: failures of the same tool on the same file or command count as one problem (`coarseKey`). The second failure's result carries `diagnosisRequired`, and the prompt tells the agent to find out why (the error, the log, the files) and change approach; the third identical failure, or the fourth similar one, ends the request as blocked.
- **Parallel reads**: the reads at the start of a response (`read_file`, `view_media`, `read_transcript`, `search`) run together; results are recorded in order.
- **Truncation**: a response cut off with visible content retries with double the output allowance, up to 64K, scoped to its phase. A response that only thought is not retried with more room: the agent is told to act in one concrete step, and the phase's effort steps down. Three truncations end the step.
- **Over-long fields**: prose fields (summary, brief, query, title) are shortened instead of failing the call. Paths and code are never trimmed.
- **Completion**: only when the current head was published (or validated unchanged) in this phase with no unpublished changes and no scene errors, every must-fix check of the request's publications is fixed or listed in `finish.kept` with a reason, and no delegated task is blocked or skipped. Kept reasons go into the recap. Plan notes (`update_tasks.notes`) survive compaction.

## Context

- **Editing agent**: the first message is two blocks. The first, cached so the next request within five minutes reads it, holds what changes rarely: capabilities, environment, the workspace folder, the project document and its schema (`context/project-schema.json`), the computer without its clock, and the media facts above. The second carries the request, the project overview, an outline of the timeline in order (one plain line per clip: place, source and range, speed, framing, grade, transition; then overlays, sound effects, music and captions), the project notes, source notes, media the agent made, recent conversation, relevant indexed chunks found from words, the authored files by name (no code excerpts), decisions and the computer status (access, media folders, local date and time zone).
- **Project notes and source notes**: `finish` takes optional `notes` (what the user wants for the video overall; the editing agent only) and `sourceNotes` (what each inspected source shows and where). Both are saved with the project and shown to every later request, at no extra model call.
- **Readonly and planning** get the same briefing; nothing is pushed into any role's context beyond it.
- **State changes**: when the project or media state changes, a message with only the changed fields (and the media or decision records added, changed or removed) is appended, never edited. The full state is kept locally under each message; compaction restores it when it drops the messages a change report builds on.
- **Transcript words** carry only id, text, start and end (plus speaker or an uncertainty flag).

The compaction target is 180K tokens.

- **Measurement**: the last response's real prompt size calibrates the byte estimate. The token-count endpoint is called only without a calibration or near the target.
- **Compaction**: an overrun compacts to half the target from the current sticky view. It carries the earlier summary forward and keeps only real instructions and the newest state snapshot. Following steps then append to a stable cached prefix.

## Inference, caching and cost

- **Transport**: requests stream through the Supabase gateway. Tools, system and history are cached for five minutes. The editing agent's conversation switches to one-hour caching of all of them (`cacheTtl`) once a wait for its helpers in the request has outlasted the five-minute cache; short requests keep the cheaper one. Helpers share their snapshot's cached prefix.
- **Task budgets**: each role gets a budget the model can see (editing agent 120K, helpers 100K, planner 60K, replies 40K). The remainder is sent explicitly after compaction.
- **Failures**: a 90-second idle watchdog replaces a total timeout. Transient and unconfirmed failures are cancelled server-side and retried up to three times.
- **Usage tracking**: every response is recorded in the append-only `ai_usage` table: phase, helper, tokens, cost (a parity-tested client mirror of the gateway's price formula), duration and visible size.
- **Activity**: activity events are rows, one upsert per stream update. Publications record changed files as hashes and line counts; text loads on demand.

The gateway features above (one-hour conversation cache, task budgets, cost in receipts, the `continue` route, the routing schema on Sonnet) are optional and take effect after `supabase functions deploy dream-gateway`; the app works unchanged against an older deployment.

## Workspace and publication

`Workspace/project.json` is a version-1 `dream-workspace` document with `baseVersionId`, the timeline and `outputs` (scenes, images, audio, video, music, sound effects). It is the edit: the agent changes it directly for a small change (`write_file`, `edit_file`) or with a program it writes and runs, which may also produce media under `output/`. `publish_project` validates the document against the sources, compiles scenes, synthesizes music and sound, copies files into hash-addressed storage, resolves asset references, and saves the timeline, source snapshot, assets and receipt in one SQLite transaction. Replaying a completed call cannot create another version. Undo, redo, restore and branch changes restore the workspace sources with the version.

Each publication then checks what the request changed, against the version the request started from, using the timeline and the transcript only (`apps/project-service/src/edit-checks.ts`). Must fix: the same footage used twice (over a second of overlap), a cut more than 0.05 s inside a spoken word, more than three seconds of silence between words inside a clip. Notes: slow motion below half speed, one clip over 40% of a video of 15 seconds or more. The checks return with the publication and are saved for the request (`edit-checks:<turn>`).

## Sound and colour

Clip sound is levelled toward -18 LUFS from each source's measured loudness (at most 12 dB either way; `settings.autoLevel` false turns it off), in the shared audio manifest so preview and Export match; music keeps its own gain. Export then normalizes the mix to -14 LUFS with true peaks below -1.5 dBTP in two passes, copying the picture. Colour temperature is an SVG colour matrix that scales red against blue, defined once per temperature in the composition. Effect items on footage (`slow_push`, `punch_zoom`, `shake`, `grade`) need no code and are documented in the engine reference.

## Runtime

Without computer access, the Windows host runs commands in an AppContainer with project-specific identity, read-only runtime and source access, the app's own ffmpeg and ffprobe on PATH (read-only), internet access, an explicit environment without account credentials, and a kill-on-close Job Object. With computer access granted, commands run on the user's computer as the user (cmd.exe in the project workspace) with the bundled Node, Python and ffmpeg ahead on PATH and the app's own secrets removed. Node 24.19.0 and Python 3.13.16 are pinned (`pnpm stage:code-runtime`, `pnpm qualify:code-runtime`). Commands never publish; `publish_project` does.

## Verification

`pnpm test` and `pnpm typecheck` cover the engine end to end with fixture gateways. Every live session first checks that the packaged app is newer than the app's code and the deployed gateway newer than the gateway's code (`assertCurrent` in `tests/desktop/live-session.ts`), and refuses to start otherwise. `tests/desktop/agent-smoke-live.spec.ts` (`DREAM_LIVE_SMOKE=1`) is the cheap live check to run before a long session: three minutes of the long-form talk cut into a short clip, then captions. The live session specs (`tests/desktop/agent-*-live.spec.ts`, each behind its own `DREAM_LIVE_*` variable, sharing `tests/desktop/live-session.ts`) record each step's cost, model calls, largest context, escalations and looks at footage and write `session-report.txt`, compared with `DREAM_LIVE_COMPARE` when set; `tsx scripts/session-report.ts <folder> [--compare <older>]` reports any saved project. The packaged desktop specs (`pnpm exec playwright test tests/desktop`) cover the player, export, drag-and-drop, planning and the agent. `pnpm exec tsx scripts/smoke-engine-local.ts --budget=<usd>` runs real requests against the Anthropic API through this repository's gateway code on localhost and reports cost and time per phase. `scripts/compare-export.ts` compares the native export with the browser export. Results are recorded in `docs/ACCEPTANCE.md`.
