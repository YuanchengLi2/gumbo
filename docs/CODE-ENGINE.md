# Code creation engine

This document describes the production engine as of October 10, 2026: the orchestrator (`packages/orchestrator/src/code-director.ts`, `code-agent.ts`, `task-graph.ts`), the scene engine (`packages/scene-engine`) and the workspace that compiles and publishes their work (`apps/project-service/src/code-workspace.ts`).

## The division of labor

The agent writes only the code for the video. Everything else is the engine's job:

| The agent writes | The engine provides |
|---|---|
| Scene components (React, Remotion timing, three.js through React Three Fiber, d3, SVG, Canvas, CSS) | One prebuilt runtime with those libraries, bundled fonts, project media and resources by name, frame-exact video, textures, a ready 3D scene, fit-to-box text, safe areas and beat timing |
| Timeline actions (`edit_timeline`): what plays when (clips, grade, transitions, overlays, scenes, music, sound, captions) | Checking each action against the sources, compilation in milliseconds, publication, versions and undo, the live player and Export |
| Score files (`src/music/*.score.json`) and sound designs | Expansion, validation and synthesis into audio assets with beat times |
| Which media to use | Finding media on the computer by capture date, importing, proxies, thumbnails, transcripts, contact sheets |

Nothing renders during chat. Published scenes run live in the right panel; only Export renders frames.

## Who does the work

Haiku starts every request and does the work; a stronger model takes over only when Haiku fails or the request builds several new pieces at once. A request runs in one of two working modes, solo or directed, and can move between them.

| Mode or request | Model | Role |
|---|---|---|
| **Working alone** (the default) | Haiku 5.5, then Sonnet 5.5 | **solo**: inspects, edits, publishes and replies. When the engine sees Haiku fail (the same tool error twice, the step limit, repeated output cut-offs) Sonnet continues alone from a handoff; when Sonnet fails the same way, the Opus director takes over. `switch_to_orchestrated` asks for a Sonnet director when the request needs several new pieces built together. `consult_director` asks the next model up one question, answered with no tools. |
| **Directed** (several new pieces at once) | Sonnet 5.5, or Opus 5.5 | **lead**: decides, writes self-contained briefs, dispatches a task graph of workers, reads their reports and finishes. Its only tools are `delegate`, `update_tasks`, `remember_decision`, `finish` and `hand_off`. It never inspects, writes, runs or publishes anything. A Sonnet director whose workers keep failing hands the request to Opus once. Opus directs from the start only a whole new video made from nothing, or when the user asks for Opus or the director. |
| Work dispatched by the lead | Haiku 5.5 | **worker**: one isolated conversation per task. Research tasks are read-only and report facts; build tasks write and, when assigned, publish. |
| A reply: a question, a script, ideas | Haiku 5.5, or Sonnet 5.5 for scripts and concepts | **readonly**: answers directly. Sonnet replies with no tools. |
| Planning, and approved plans | Opus 5.5 | **readonly** planner returning an editable plan; an approved plan runs as one continuing lead conversation. |

Every move to a model above Haiku is recorded as an `ai.escalation` event with its kind (route, switch, consult, plan) and reason; `scripts/session-report.ts` lists them per request.

### Routing, permission modes and effort

Exact local instructions, "continue" phrasing and plain follow-up edits on a titled project with a timeline (`plainEdit`: "make it warmer", "add crossfades") skip the classifier and start with Haiku. Everything else is classified by Haiku with a provider JSON schema, falling back to Haiku and the local heuristic (`routeCodeRequest`) if classification fails. Routes are `question`, `local`, `plan` and `continue` (only while a stopped request exists); intelligence is haiku, sonnet or opus, and the app turns an Opus route on an existing timeline or for a question into Sonnet unless the request names Opus or the director.

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

## The footage map

Every imported video or image is analyzed once in the background after it is ready (`apps/project-service/src/footage-map.ts`). One ffmpeg pass at 320 px and 10 fps finds cuts, frozen and black stretches, blur, brightness, motion and camera shake; shots between cuts carry these measurements and their problems. One Haiku call then looks at a contact sheet of up to sixteen shots and describes each (what it shows, framing, tags, energy, usable) and flags what measurements cannot see: player controls, recorder or desktop windows, pause icons, burned-in text, watermarks, letterboxing. Loudness is measured per source too. The media list carries each source's map (shots and problems, frozen and black stretches, where usable footage ends), the timeline outline says what each placed clip shows, and `edit_timeline` warns, without blocking, about flagged footage, unanalyzed sources, slow motion below half speed, one clip over 40% of the video and repeated footage.

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

- **Spending limit**: each request may spend $3 (`DREAM_REQUEST_BUDGET_USD`), checked before every model call; at the limit it stops as interrupted with its work saved, and each resume allows the same amount again.
- **Step limits**: 100 model calls for the lead and 80 for other roles. Haiku or Sonnet working alone hands over to the next model at the limit; otherwise it reports a blocker, never completion.
- **Text-only responses**: nudged at most twice. Engine nudges are tagged and dropped at compaction.
- **Repeated failures**: failures of the same tool on the same file or command count as one problem (`coarseKey`). The second failure moves a solo request up the ladder (or asks the next model up when switching is not available); the third identical failure, or the fourth similar one, ends the request as blocked.
- **Parallel reads**: the reads at the start of a response (`read_file`, `view_media`, `read_transcript`, `search`) run together; results are recorded in order.
- **Truncation**: a response cut off with visible content retries with double the output allowance, up to 64K, scoped to its phase. A response that only thought is not retried with more room: the agent is told to act in one concrete step, and the phase's effort steps down. Three truncations end the step.
- **Over-long fields**: prose fields (summary, brief, query, title) are shortened instead of failing the call. Paths and code are never trimmed.
- **Completion**: only when the current head was published (or validated unchanged) in this phase with no unpublished changes and no scene errors. The lead keeps plan notes (`update_tasks.notes`) that survive compaction.

## Context

- **Lead and solo**: the first message is two blocks. The first, cached so the next request within five minutes reads it, holds what changes rarely: capabilities, environment, the computer and the media list with its footage map. The second carries the request, the project overview, an outline of the timeline in order, the project notes, recent conversation, relevant indexed chunks (9,000 characters), the authored files by name (no code excerpts), decisions, the media list (with what earlier requests saw in each source), engine capabilities and the computer status (access, media folders, local date and time zone).
- **Project notes and source notes**: `finish` takes optional `notes` (what the user wants for the video overall; editors and directors only) and `sourceNotes` (what each inspected source shows and where). Both are saved with the project and shown to every later request, at no extra model call.
- **Lead, readonly and planning**: these also receive the source map on their first request:
  - a one-line-per-source catalog, in capture order when known;
  - one 4x3 contact sheet per shown source;
  - a catalog sheet with one frame per source for nine or more sources.
- **State changes**: when the project or media state changes, a message with only the changed fields (and the media or decision records added, changed or removed) is appended, never edited. The full state is kept locally under each message; compaction restores it when it drops the messages a change report builds on.
- **Looks at footage**: `view_media` returns five or more frames tiled on 4x3 contact sheets; a range of a second or two returns full-size frames. Transcript words carry only id, text, start and end (plus speaker or an uncertainty flag).

Compaction targets are 80K tokens for Haiku (never sent more than 96K, so it stays below the 100K long-context price) and 180K for Sonnet and Opus.

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

`Workspace/project.json` is a version-1 `dream-workspace` document with `baseVersionId`, the timeline and `outputs` (scenes, images, audio, music, sound effects). The agent changes it with `edit_timeline`: the manual editor's typed operations plus output declarations, applied in order and checked against the sources (every asset or output exists, every range lies inside its source, changed items have a length and a clip to stand on, deleted clips strand nothing); if any fails, nothing applies and the error names the action. The call publishes in the same step and returns a compact list of changes; a replayed call restores its saved document instead of applying the actions again. Publication validates the document, compiles scenes, synthesizes music and sound, copies files into hash-addressed storage, resolves asset references, and saves the timeline, source snapshot, assets and receipt in one SQLite transaction. Replaying a completed call cannot create another version. Undo, redo, restore and branch changes restore the workspace sources with the version.

## Sound and colour

Clip sound is levelled toward -18 LUFS from each source's measured loudness (at most 12 dB either way; `settings.autoLevel` false turns it off), in the shared audio manifest so preview and Export match; music keeps its own gain. Export then normalizes the mix to -14 LUFS with true peaks below -1.5 dBTP in two passes, copying the picture. Colour temperature is an SVG colour matrix that scales red against blue, defined once per temperature in the composition. Effect items on footage (`slow_push`, `punch_zoom`, `shake`, `grade`) need no code and are documented in the engine reference.

## Runtime

The Windows host runs commands in an AppContainer with project-specific identity, read-only runtime and source access, an explicit environment without account credentials, and a kill-on-close Job Object. Node 24.19.0 and Python 3.13.16 are pinned (`pnpm stage:code-runtime`, `pnpm qualify:code-runtime`). Scenes, music and imports do not need commands; `run_command` remains for package installs and rare data work.

## Verification

`pnpm test` and `pnpm typecheck` cover the engine end to end with fixture gateways. The live session spec (`tests/desktop/agent-workflow-live.spec.ts`, only with `DREAM_LIVE_WORKFLOW=1`) records each step's cost, model calls, largest context and escalations and writes `session-report.txt`, compared with `DREAM_LIVE_COMPARE` when set; `tsx scripts/session-report.ts <folder> [--compare <older>]` reports any saved project. The packaged desktop specs (`pnpm exec playwright test tests/desktop`) cover the player, export, drag-and-drop, planning and the agent. `pnpm exec tsx scripts/smoke-engine-local.ts --budget=<usd>` runs real requests against the Anthropic API through this repository's gateway code on localhost and reports cost and time per phase. Results are recorded in `docs/ACCEPTANCE.md`.
