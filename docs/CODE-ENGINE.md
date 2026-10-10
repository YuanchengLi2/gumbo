# Code creation engine

This document describes the production engine as of October 10, 2026: the orchestrator (`packages/orchestrator/src/code-director.ts`, `code-agent.ts`, `task-graph.ts`), the scene engine (`packages/scene-engine`) and the workspace that compiles and publishes their work (`apps/project-service/src/code-workspace.ts`). `legacy-director.ts` is retained only for historical tests and older serialized projects; it is not the production director.

## The division of labor

The agent writes only the code for the video. Everything else is the engine's job:

| The agent writes | The engine provides |
|---|---|
| Scene components (React, Remotion timing, three.js through React Three Fiber, d3, SVG, Canvas, CSS) | One prebuilt runtime with those libraries, bundled fonts, project media and resources by name, frame-exact video, textures, a ready 3D scene, fit-to-box text, safe areas and beat timing |
| `project.json`: what plays when (clips, overlays, scenes, music, sound) | Compilation in milliseconds, publication, versions and undo, the live player and Export |
| Score files (`src/music/*.score.json`) and sound designs | Expansion, validation and synthesis into audio assets with beat times |
| Which media to use | Finding media on the computer by capture date, importing, proxies, thumbnails, transcripts, contact sheets |

Nothing renders during chat. Published scenes run live in the right panel; only Export renders frames.

## Who does the work

Opus directs and Haiku does the work. A request runs in one of two working modes and can switch between them.

| Mode or request | Model | Role |
|---|---|---|
| **Haiku alone** (the default for edits) | Haiku 5.5 | **solo**: inspects, edits, publishes and replies. It can call `switch_to_orchestrated` with a written handoff when the request needs multi-part direction, and it switches automatically after repeated substantive failures of the same step. `consult_director` asks Opus one question; Opus answers with no tools. |
| **Opus-directed** (multi-part creative work) | Opus 5.5 | **lead**: decides, writes self-contained briefs, dispatches a task graph of workers, reads their reports and finishes. Its only tools are `delegate`, `update_tasks`, `remember_decision`, `finish` and `hand_off`. It never inspects, writes, runs or publishes anything. |
| Work dispatched by the lead | Haiku 5.5 | **worker**: one isolated conversation per task. Research tasks are read-only and report facts; build tasks write and, when assigned, publish. |
| A reply: a question, a script, ideas | Haiku 5.5, or Opus 5.5 when the router judges it creative | **readonly**: answers directly. Opus replies with no tools. |
| Planning, and approved plans | Opus 5.5 | **readonly** planner returning an editable plan; an approved plan runs as one continuing lead conversation. |

### Routing, permission modes and effort

Exact local instructions and "continue" phrasing skip the classifier; everything else is classified by Haiku with a provider JSON schema, falling back to the local heuristic (`routeCodeRequest`) if classification fails. Routes are `question`, `local`, `plan` and `continue` (only while a stopped request exists).

The composer chooses the permission mode and the effort:

- **Edit automatically** (default): routed as above.
- **Plan first**: every request is routed to `plan`. Approving a plan (the button or "do it") switches the composer back to Edit automatically.
- **Ask only**: every request is routed to `question`; nothing in the project changes.
- **Effort** Auto, Low, Medium or High. Auto picks effort by role: low for the router, research workers and timeline integration; medium for build workers and the lead (high after two consecutive worker failures); high for difficult solo work. A chosen effort applies to every model of that request except the router. A phase whose response spent its whole output allowance thinking steps its effort down.

## Delegation as a task graph

The lead's `delegate` takes one to eight tasks `{id,title,brief,mode,writes,publish,after,context}` and runs them as a dependency graph (`runTaskGraph`):

- A task starts as soon as every task in its `after` list completed, with at most `engineBudgets.maxWorkers` (4) running at once. Dependents of a blocked task are skipped with that reason.
- At most one build task publishes, and it must come after every other build task. Build tasks that can run at the same time need disjoint `writes` and leave `project.json` to the publisher. Dependencies must name tasks in the call and form no cycle (`validateDelegation`).
- `context` attaches up to 12 workspace files (60K characters in total) to the brief, so workers do not explore to find them.
- The graph and its reports are saved per call (`taskgraph:<turn>:<call>`); a resumed request does not rerun finished tasks.

Every worker of one call starts from the same project snapshot (overview, media in capture order, capabilities, computer status, decisions), marked for caching, followed by its task, scope and context files. Later workers start once the first worker's stream begins (at most 5 s), so they read that cached prefix instead of each writing it. A blocked worker is retried once with the reason, unless the block needs the user. Reports carry the summary, changed files, outputs, scene errors, attempts, duration and cost.

Commands and publication run one at a time within the workspace (`CodeWorkspace.exclusive`). Worker writes are confined to their declared scopes at execution.

## Scenes

A scene is a default-exported React component in `src/**/*.tsx` (or `.ts`, `.jsx`, `.js`), declared in `project.json` outputs as `{id, path, kind:'scene', ...}`. Width, height, fps and duration default to the project's; `props` lets one component serve many shots; `transparent` makes it an overlay. The engine reference the agent reads is `packages/scene-engine/reference/api.md`, mirrored into the cached system prompt.

- **Runtime**: five chunks (core, three, d3, icons, noise) built by `scripts/build-engine.ts` into `resources/staged/engine/<version>/`, sharing one React, Remotion and three.js through a module registry. Each scene document mounts the component through Remotion's `Thumbnail`, one frame at a time.
- **Determinism**: a frame is acknowledged only after React commits, 3D roots advance to the frame time, and textures, files, fonts, images and video seeks finish. Randomness is seeded by the revision and clocks report frame time, so frames are identical in any order.
- **Isolation**: each scene runs in its own sandboxed document, served from `dream-engine://` in the player and from the loopback render server during export. Its CSP allows only that origin plus data and blob URLs; there is no network.
- **Compilation**: publication compiles scene outputs with esbuild in milliseconds. Engine modules resolve to the shared runtime; packages installed in `Workspace/node_modules` are bundled; anything else fails with an install hint. Files under `resources/` (24 MB per file, 96 MB in total) are copied to `Media/Engine/files` and served by name. Any input change recompiles and refreshes the scene on the timeline.
- **Export**: 3D export finds a working WebGL backend on first use (ANGLE, then SwiftShader) and remembers it.
- **Legacy HTML scenes** (`window.renderFrame`) are unchanged. `bundle_scene` and the HTML guide exist only in advanced mode (`DREAM_AGENT_ADVANCED_TOOLS=1`).

### Errors without background runs

Nothing runs scene code in the background. Writing scene code returns a compile check; `check_outputs` compiles drafts that the user sees live under the worker's row. Runtime errors come from scenes playing in the visible player or a chat preview: the stack is mapped through the scene's source map to `src/file:line`, stored per scene revision or draft, added to the agent's project state, and a request cannot finish complete while a scene changed in it reports errors.

### Music and sound

Music is a score file (`src/music/*.score.json`) in compact notation (drum step patterns, note strings, chord progressions, arpeggios, sections, repeats) or a full score document; Dream expands and validates it, naming the field and token at fault. Sound effects are a sound design file or a named preset. Synthesis runs in the procedural audio worker and is cached by content. Music assets carry beat times that a scene reads with `useBeats(name)`. Scenes are silent; sound goes on the timeline.

## Media from the computer

- `find_media` finds photos, videos and audio by capture date: today, yesterday, this week, the last 7 days, or explicit dates, in the computer's local time.
  - By default it searches camera rolls, phone sync folders (OneDrive, iCloud), Videos, Downloads, Desktop and memory-card DCIM folders.
  - Capture time comes from each file's own metadata without decoding: QuickTime creation date with time zone, MP4 creation time, or EXIF `DateTimeOriginal` in JPEG/HEIC/TIFF, falling back to the file time.
  - It returns a capture-sorted catalog marked with what is already imported.
- `import_media` imports up to 100 files in one call.
  - An unchanged file (same path, size and modification time) is imported once.
  - Asset IDs, capture times and contact sheets return immediately. Proxies, thumbnails and transcripts continue in the background; transcription runs two sources at a time and skips clips under two seconds.
- `import_resources` brings folders and archives (only matching entries are extracted) into `resources/` for scenes.

With computer access granted the agent imports automatically; changes to computer files still go through `propose_file_changes` and the user's approval. A dropped folder grants a read-only subtree. Phones connected over MTP are reached through their synced folders.

## What the user sees

Every role says in one sentence what it is about to do, adds brief updates when something matters, writes out scripts or copy before building, and ends with a short recap. Opus's between-tool notes and Haiku's summarized thinking are shown as progress; reasoning itself is never shown. Worker activity nests under its task row. Imported and inspected media, and published or draft scenes, appear as thumbnails and live previews in the stream. The run monitor shows the current step, elapsed time, tasks, and the request's cost, tokens and time per caller.

## The agent loop

Each phase is a checkpointed conversation. Tool calls and results are persisted as complete pairs; a replayed call ID returns its saved receipt and never repeats an effect.

- **Step limits**: 100 model calls for the lead and 80 for other roles. Hitting the limit reports a blocker, never completion.
- **Text-only responses**: nudged at most twice. Engine nudges are tagged and dropped at compaction.
- **Repeated failures**: failures of the same tool on the same file or command count as one problem (`coarseKey`).
- **Truncation**: a response cut off with visible content retries with double the output allowance, up to 64K, scoped to its phase. A response that only thought is not retried with more room: the agent is told to act in one concrete step, and the phase's effort steps down. Three truncations end the step.
- **Over-long fields**: prose fields (summary, brief, query, title) are shortened instead of failing the call. Paths and code are never trimmed.
- **Completion**: only when the current head was published (or validated unchanged) in this phase with no unpublished changes and no scene errors. The lead keeps plan notes (`update_tasks.notes`) that survive compaction.

## Context

- **Lead and solo**: the first message carries the request, the project overview, recent conversation, relevant indexed chunks, decisions, engine capabilities and the computer status (access, media folders, local date and time zone).
- **Lead, readonly and planning**: these also receive the source map on their first request:
  - a one-line-per-source catalog, in capture order when known;
  - one 4x3 contact sheet per shown source;
  - a catalog sheet with one frame per source for nine or more sources.
- **State changes**: when the project or media state changes, a state message is appended, never edited.

Compaction targets are 80K tokens for Haiku (never sent more than 96K, so it stays below the 100K long-context price) and 180K for Opus.

- **Measurement**: the last response's real prompt size calibrates the byte estimate. The token-count endpoint is called only without a calibration or near the target.
- **Compaction**: an overrun compacts to half the target from the current sticky view. It carries the earlier summary forward and keeps only real instructions, the two latest pieces of director advice and the newest state snapshot. Following steps then append to a stable cached prefix.
- **Haiku cap**: if Haiku would still exceed its hard cap, the largest recent tool results are shortened for that request.

## Inference, caching and cost

- **Transport**: requests stream through the Supabase gateway. Tools and system carry a one-hour cache breakpoint. Lead conversations ask for one-hour caching of the whole history (`cacheTtl`), because the lead waits minutes for workers. Workers share their snapshot's cached prefix.
- **Task budgets**: each role gets a budget the model can see (lead 150K, build workers 100K, research 40K). The remainder is sent explicitly after compaction.
- **Failures**: a 90-second idle watchdog replaces a total timeout. Transient and unconfirmed failures are cancelled server-side and retried up to three times.
- **Usage tracking**: every response is recorded in the append-only `ai_usage` table: phase, worker, tokens, cost (a parity-tested client mirror of the gateway's price formula), duration and visible size.
- **Activity**: activity events are rows, one upsert per stream update. Publications record changed files as hashes and line counts; text loads on demand.

The gateway features above (one-hour lead cache, task budgets, summarized Haiku progress, cost in receipts, the `continue` route) are optional and take effect after `supabase functions deploy dream-gateway`; the app works unchanged against an older deployment.

## Workspace and publication

`Workspace/project.json` is a version-1 `dream-workspace` document with `baseVersionId`, the timeline and `outputs` (scenes, images, audio, music, sound effects). Publication validates the document, compiles scenes, synthesizes music and sound, copies files into hash-addressed storage, resolves asset references, and saves the timeline, source snapshot, assets and receipt in one SQLite transaction. Replaying a completed call cannot create another version. Undo, redo, restore and branch changes restore the workspace sources with the version.

## Runtime

The Windows host runs commands in an AppContainer with project-specific identity, read-only runtime and source access, an explicit environment without account credentials, and a kill-on-close Job Object. Node 24.19.0 and Python 3.13.16 are pinned (`pnpm stage:code-runtime`, `pnpm qualify:code-runtime`). Scenes, music and imports do not need commands; `run_command` remains for package installs and rare data work.

## Verification

`pnpm test` and `pnpm typecheck` cover the engine end to end with fixture gateways. The packaged desktop specs (`pnpm exec playwright test tests/desktop`) cover the player, export, drag-and-drop, planning and the agent. `pnpm exec tsx scripts/smoke-engine-local.ts --budget=<usd>` runs real requests against the Anthropic API through this repository's gateway code on localhost and reports cost and time per phase. Results are recorded in `docs/ACCEPTANCE.md`.
