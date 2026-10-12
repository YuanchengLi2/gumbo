# Dream

## Code-first editing by one agent — October 11, 2026

One editing agent owns each request, from looking at the footage to publishing and replying.
- **It looks for itself.** Nothing interprets the footage at import. The agent gets plain facts about each source and its transcript file (kept current even while its own commands run), looks at the frames it picks (`view_media`) and at images its own code makes (`read_file`), and measures with code.
- **It edits with code.** Every edit is a change to `project.json`, made directly or by a program the agent writes and runs. ffmpeg, ffprobe, Node and Python are on PATH, and it may install anything else. Processed footage and generated media go under `output/`.
- **Publishing checks the facts.** Each publication reports footage used twice, cuts inside a word and long silences. The agent cannot report the request done while one of these is neither fixed nor kept with a reason, or while a task it delegated is still blocked.
- **One model.** Every role runs on Sonnet: the edit, its helpers, plans and replies. A request that keeps failing is told to diagnose and change approach, then stops as blocked with its work saved.
- **Helpers build separate pieces.** For several scenes, or scenes and music, Haiku helpers write the files in parallel; the agent places them and publishes.

See [the engine documentation](docs/CODE-ENGINE.md) and [DECISIONS.md](DECISIONS.md).

## Scene engine, cost and computer media — October 10, 2026

The agent writes only the code for the video. A prebuilt scene engine provides everything else:
- React with Remotion timing, three.js through React Three Fiber, d3, icons, noise and eleven bundled fonts;
- project media and resources by name, frame-exact video, textures, a ready 3D scene, fit-to-box text, safe areas and beat timing;
- compilation in milliseconds and the live player; only Export renders;
- music written as score files and synthesized by Dream.

**Orchestration.** Opus directs dependency graphs of Haiku workers that share one cached project snapshot, retry once when blocked, and report changed files, errors and cost. _Replaced on October 11, 2026: one editing agent owns each request, and the task graph runs its helpers (see above)._

**Cost and speed.**
- Context is compacted with headroom and stays under Haiku's long-context price.
- Thinking-only cutoffs lower effort instead of raising the output limit.
- The lead's history uses a one-hour cache while workers run (since October 11, the editing agent's, while its helpers run).
- The run monitor shows cost, tokens and time per caller.

**Computer media.** "Use what I shot today" works: `find_media` finds photos, videos and audio by capture date in camera rolls, phone sync folders, Downloads and memory cards, and `import_media` imports them in capture order.

**Chat and timeline.**
- Media drags straight onto the timeline.
- Attachments, selections and message media show as thumbnails and short previews.
- Chat answers render markdown.
- The composer sets the permission mode (edit automatically, plan first, ask only) and the effort.

See [the engine documentation](docs/CODE-ENGINE.md). The optional gateway features take effect after `supabase functions deploy dream-gateway`.

## Opus-led agent engine — October 9, 2026

_Replaced on October 11, 2026 by one editing agent per request (see the top section)._

Simple exact edits and questions are handled by Haiku alone. Creative, multi-part and planned work is led by Opus, which inspects the project, decides, and delegates self-contained tasks to Haiku workers, up to four in parallel when their files do not overlap, then verifies and finishes. The agent loop has step and nudge limits, groups repeated failures, and completes once the current revision is published. Context compaction runs only after a measured overrun and keeps a stable prefix, so prompt caching and model reasoning survive long tasks. Dropped connections are cancelled and retried automatically. Commands no longer publish; scenes can reference bundled libraries with `<script src>`, which publication inlines. Details: [engine documentation](docs/CODE-ENGINE.md). The gateway changes require `supabase functions deploy dream-gateway`.

## Creative coding engine — October 8, 2026

The new agent edits a durable project workspace through general file, command and media-inspection capabilities. Code, dependency lockfiles, generated assets and timeline revisions share publication and undo history. The conversation streams public progress and actual execution, with tasks above the composer and technical details expandable. See [the engine documentation](docs/CODE-ENGINE.md) and [acceptance ledger](docs/ACCEPTANCE.md) for current release gates.

Windows runtime preparation: run `pnpm stage:code-runtime` and `pnpm qualify:code-runtime`. Staging verifies the official archive checksum and applies the documented AppContainer pipe-namespace compatibility patch; the manifest records the modified executable hash. Packaging rejects a missing or stale qualification. This never falls back to unrestricted host execution.

## Prompt-first desktop redesign — October 7, 2026

Dream now starts on a local project dashboard. Attach media and describe an edit; Dream creates a folder under the operating system's Documents/Dream/Projects directory, copies the selected media, and starts editing as soon as playback assets are ready. Optional source analysis continues in the background. No project-folder picker or account sign-in is required.

The light AI workspace places Chat/Media on the left and the player on the right. Each request now keeps its own live execution steps followed by a summary of the actual saved changes. Completed work remains available when a project is reopened. The composer grows with its text, hides scrollbars, uses a compact send control, and exposes Plan first as a highlighted toggle. The first generation displays “Cooking up your video”; a persistent first-draft milestone reveals the compact seek/select timeline. Later edits dim the preview and animate committed timeline changes. The charcoal manual workspace uses the same project, composition and undo history, with contextual properties, asset categories, real transitions and adjustments, and Ctrl/Cmd+B splitting.

Canvas presets are 16:9, 9:16, 4:3, 3:4, 1:1 and 4:5. New framing fields cover rotation, flips, opacity, exposure, contrast, saturation and temperature. Clip and transition rendering share the same styling calculations.

AI creates an encrypted anonymous session automatically. Offline local editing and export remain available. Computer file access is opt-in in Settings or the attachment menu, remembered locally and revocable. Dream can search/import files and propose organization or text edits. Existing-file changes require review of the exact proposal; deletion uses OS Trash. Video export can also be requested through the permission-aware file tools. Arbitrary binary document editing is not supported.

`DREAM_DOCUMENTS_DIRECTORY` overrides the Documents base for isolated desktop acceptance profiles. Normal installations use the OS Documents location. `pnpm exec tsx scripts/smoke-guest.ts` performs a small real-provider guest edit and local export; its report is separate from deterministic gateway fixtures.

An in-progress local-first Windows/macOS AI video editor. Electron loads the packaged React interface locally; a utility process owns SQLite project state. Supabase handles anonymous AI sessions, usage, and completed-export sharing.

**Status:** development implementation. The full product and release gates are not complete. See [verification ledger](docs/ACCEPTANCE.md).

One chat and one project execution engine handle timeline edits, original coded scenes/animation, procedural music and SFX. A local searchable project index supplies relevant chunks; operation schemas and creative capabilities load on demand. Haiku executes simple requests alone and Opus leads Haiku workers for everything else (see the October 9 entry above). Successful creations appear directly on the timeline. Plan first presents editable steps for approval; durable workflows can consult the director during execution, resume interrupted work and undo the turn as one action. Step completion records explicit outcomes and successful tool receipts; paused plans retain their current step and accept follow-up direction in the same composer. Streamed inference responses persist locally for crash recovery, and long provider conversations compact older results into retrievable execution history. Truncated creative definitions retry with more output capacity before any tool executes, within the documented request limits. The current Windows development package has passed the planning and creative export journeys. Mac distribution, complete analysis coverage, broader real-project soak and release quality gates remain open. The engine now has measured large-project storage/retrieval checks and a live Opus-to-Sonnet/module-revision acceptance run; see the latest ledger entry.

## Develop

Use Node 24 and pnpm 10.14.0. Run `pnpm install`, then `pnpm dev`. `scripts/dev.mjs` loads only desktop public configuration and local runtime paths from the ignored `.env.local`; it does not copy the Anthropic key into the app.

`pnpm typecheck` checks workspace TypeScript. `pnpm test` runs focused engine/persistence tests. `pnpm exec playwright test` runs the packaged Windows journey and requires a current package and generated fixtures.

## Build local media and desktop package

```powershell

pnpm exec tsx tests/fixtures/generate.ts

pnpm exec tsx scripts/build-remotion.ts

pnpm exec tsx scripts/stage-runtime.ts

powershell -NoProfile -File scripts/stage-whisper.ps1

pnpm exec tsx scripts/prepare-package.ts

pnpm exec tsx scripts/stage-ingest.ts

pnpm package

pnpm exec tsx scripts/verify-package.ts

pnpm make

```

The staged browser and media tools are included outside ASAR so a distributed app does not download them on first export. Freeze the analysis worker first with `uv sync --locked` in `apps/ingest-worker`, followed by `uv run pyinstaller --noconfirm runtime.spec` in its `build` directory. Build on each target platform. Mac signing and notarization require publisher credentials and a Mac build host.

## Cloud

The dedicated Supabase project is `qewguvfkkwvdoqptiljd`. Migrations and the deployed `dream-gateway` Edge function live under `supabase/`. The provider credential lives in Supabase function secrets. Never add it to desktop configuration or commit `.env.local` / `.secrets`.

The companion runs with `pnpm --filter @dream/companion dev`. Public configuration is `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. No provider or service-role key belongs in the companion bundle.

See [architectural decisions](DECISIONS.md), [license status](docs/LICENSES.md), and [verification ledger](docs/ACCEPTANCE.md).

## Long-project engine

Project search remains local lexical FTS with bounded query expansion. Incremental source indexes, revision-checked reads, source-backed user decisions and paginated history keep the active context focused. The inference gateway accepts validated low/medium/high adaptive profiles; ordinary exact edits remain economical. Director questions that require user intent pause execution until answered.

SQLite stores compressed content by hash, append-only execution exchanges and verified timeline deltas, with a full checkpoint every 50 versions. Saved source, undo history and interrupted jobs are retained. Disposable visual caches use a 5 GiB target with a ten-minute lease for recently rendered output. Existing databases receive a pre-migration backup before schema upgrades.

Visual source drafts support immutable reusable modules, exact hash-checked patches and parameter-only revisions. Draft changes do not affect the timeline until compile/render/commit succeeds. Version-1 source remains readable and is normalized into a one-module manifest without changing saved pixel identities.

Validation commands:

```powershell

pnpm typecheck

pnpm exec vitest run --maxWorkers=2

pnpm exec tsx scripts/benchmark-engine.ts

pnpm exec tsx scripts/smoke-engine-local.ts

pnpm exec tsx scripts/smoke-ai.ts --engine

pnpm exec tsx scripts/smoke-ai.ts --recovery

```

The two smoke commands use dedicated temporary beta accounts and real inference; `--engine` caps its test account's daily allowance at $3. They require the linked dedicated Supabase project and staged visual/media runtimes. Reports in `artifacts/` distinguish deterministic local fixtures, live provider results and native packaged tests.

## Fast source context

_Partly replaced on October 11, 2026: the source map, the visual context prepared for the agent and the scene-aware overview runtime (`stage-context.ts`, `context-requirements.txt`) are gone; the agent picks the frames it looks at. Media still registers and becomes usable before its copy finishes._

New compatible media is registered from its selected local source as soon as metadata is read. Playback, the first prompt, and visual context do not wait for a full file copy, checksum, proxy, or transcription. Originals are copied and verified in the background; copying status remains available in project jobs. Unsupported playback codecs still require conversion.

The default visual overview seeks directly through the container's encoded keyframe index and returns at most twelve timestamped images spanning the complete source duration, including the beginning and ending. It does not traverse the entire decoded video or ask a second AI to describe every window. Long-GOP footage with too few keyframes receives extra middle/end samples. Overview images and available timestamped speech are included in the editing Claude's first substantive request. Precise isolated operations avoid unnecessary image context. Source selection and candidate cuts can be verified through the existing detailed frame/transcript tools.

The first visual overview is broad evidence, not exhaustive event recognition or speech understanding. Speech transcription continues separately and is explicitly marked unavailable until real words exist. Claude must read/inspect candidate ranges before claiming exact events or dialogue. The source map exposes filenames, dimensions, duration, available speech excerpts and real frame timestamps. Cached context is reused across follow-up requests.

The optional scene-aware overview uses pinned claude-real-video 0.10.7 for explicitly requested ranges of up to sixty seconds. It is no longer an automatic prerequisite. Its small offline runtime is built with the ingest worker's context.spec and staged by scripts/stage-context.ts. Install its selected local-extraction dependencies from apps/ingest-worker/context-requirements.txt using uv pip install --no-deps in the existing ingest build environment. No new cloud model or credentials are required.

Measured locally on October 7: source-frame overviews for two approximately 22-second clips took 1.2 and 1.8 seconds; a synthetic one-hour/6.4 GB file made by repeating real encoded footage took 1.9 seconds. Cached lookups took 1–2 ms. The large file registered and became usable in 0.64 seconds with its copy pending. These measure context preparation, not Claude response time, transcription time, or final editing quality. Reports are in artifacts/preview-benchmark.json and artifacts/import-benchmark.json.

## AI workspace and editable export

Dream opens one AI workspace. Media contains project uploads and generated assets; manual editing and the separate library switcher are unavailable. Existing timelines, generated definitions, and undo history remain readable.

Public editing updates appear chronologically in chat. The Tasks bar above the composer expands upward to show planned and executing work. Plans can be edited as complete documents, saved locally, and approved as a specific revision. Editing a plan does not use another AI request.

Export defaults to Premiere/Resolve XML plus a media folder. Source cuts and track identities are preserved, overlapping items receive separate lanes, and stereo channels are linked. Graphics requiring Dream's renderer are separate transparent ProRes clips. Their internal animation is baked. Captions include SRT, and the package includes conversion notes.

### Cloud speech context

The desktop starts Groq Whisper Large V3 Turbo transcription directly from the imported source, independently of copying, playback conversion, thumbnails, and waveforms. It extracts 16 kHz mono PCM WAV chunks: the first 30 seconds, then 90-second ranges with one second of overlap on each side. At most three extraction/upload requests run at once per project. Word timestamps become absolute source seconds, overlap ownership prevents repeated boundary words, and each completed range becomes searchable immediately. The source map and footage tools expose partial coverage so missing text cannot be mistaken for silence.

The authenticated Supabase dream-gateway/transcribe route owns GROQ_API_KEY; never put that key in desktop environment files or bundles. Apply migration 202610080001_dream_speech.sql, set the Supabase secret, and deploy dream-gateway. The server validates actual PCM audio duration, accounts for the provider's ten-second minimum, and records audio seconds/cost against the existing daily account budget. This is usage accounting, not a customer checkout or overage billing implementation.

Each project caches chunk transcripts and words locally. The gateway also caches results by account and audio hash, including duplicate uploads and lost-response retries. Raw uploaded audio is forwarded to Groq without being stored by Dream's gateway; transcript results remain in the account's private cache. Failed jobs show Retry speech and retain completed chunks. Existing completed local transcripts are reused. Cloud errors do not silently fall back to the slow local runtime. The local Whisper path remains available to standalone service callers that do not configure the cloud speech callback.

Live gateway verification on October 7: the same 22.208-second source previously measured at 151.292 seconds with local Whisper completed in 2.410 seconds including PCM extraction and the authenticated cloud request (58 timed words). Local cache reuse took 60 ms; a repeat server upload took 538 ms and reused its cache without another provider request. This is one measured short-clip comparison, not a latency guarantee for long content. See artifacts/groq-speech-benchmark.json.

## Conversation recovery

The gateway saves account-scoped request results for 24-hour recovery. A duplicate request ID with identical content returns its existing response; different content is rejected. Desktop disconnections can recover the original response, while explicit Stop cancels execution. An unknown expired provider outcome remains interrupted rather than silently creating a paid replacement.

Provider thinking is replayed only against its exact recorded account/model/prompt/tool/message prefix. Compaction and changed capabilities establish a new provider epoch without deleting local history. The gateway also uses Anthropic's thinking-binding compatibility controls for older clients.

Deploy migration 202610080002_inference_results.sql and dream-gateway before distributing this desktop build. DREAM_AI_MAX_WALL_MS defaults to 120000; any override must fit the hosting plan's runtime limit. The app retains immediate media registration, background collection, keyframe context, and chunked cloud speech. Playback readiness and optional context/transcription state are separate.

## Agent-driven computer access

Ask Dream to find and use content on your computer in the normal composer. When access is needed, approve Allow computer access in chat; Dream resumes the saved request and finds/imports the files itself. This approval persists until revoked in Computer files. Manual browsing is optional. File discovery is also available during planning and questions, with only read tools in those phases.

Computer search can start without a path and prioritizes the operating system's Desktop, Downloads, Documents, Pictures, Videos, Music, and home locations before other drive contents. Listings and searches are paginated. Existing original-file modification approvals remain separate from permission to find/read/use content.
