# Dream decisions

## October 9, 2026 — Opus orchestrates, Haiku works; every message is routed

- Every message is a new request. The "Continue saved request" option and the resume card are gone. After a stop, the router decides whether a message continues the stopped request (`continue`) or starts a new one. A request for something to read (a script, ideas, feedback) is a reply, not an edit.
- Haiku alone is the default working mode. Opus is used only to orchestrate multi-part creative work. A request can switch between the two modes at most twice, carrying a written handoff each time.
- The Opus lead does no work. It cannot inspect, write, run, publish or propose file changes. Haiku research workers report findings, Haiku build workers implement, and a Haiku review worker checks layout against a checklist. Opus consultations and Opus replies have no tools. The lead runs at medium effort.
- The cost driver this addresses: in the October 9 Minecraft run, Opus was 98% of a $0.97 cost because it explored files itself.
- The stream shows the models' own progress notes, including Opus update-display thinking blocks, which hold notes only, never reasoning. Worker activity nests under its task. Every finished request ends with the agent's short recap.
- The editor's composer starts at two lines.

## October 7, 2026 — Prompt-first desktop and computer files

This entry supersedes earlier editor-first and mandatory-beta-account decisions for the desktop experience.

- Home is the default fresh-launch surface. Project creation uses a stable request-derived folder identifier and a prompt-derived editable display name. New imports are copied; old linked projects are not silently collected.

- First-draft readiness is persisted independently of the current clip count. First generation hides the AI timeline; subsequent AI edits retain a seek/select timeline. Full gestures remain in manual mode.

- One project engine, composition and undo history serve both workspaces. CapCut's layout and core interactions inform manual mode; advanced masks, tracking, speed curves and keyframe authoring are outside this revision.

- Anonymous authenticated sessions replace the desktop login requirement. Existing account/session compatibility, suspension, usage limits and administrator checks remain in place.

- Main-process file grants govern external filesystem access. Whole-computer access is an explicit local grant subject to OS restrictions. Existing-file operations need an immutable reviewed proposal. Timeline undo does not undo external files.

- A first edit waits for proxy/thumbnail/playback-audio readiness, not optional waveform/transcription/vision/audio-feature completion. This prevents optional analysis from blocking creation.

- Desktop is local-first: SQLite owns projects; Supabase owns accounts, AI usage, shares, and server secrets.

- Supabase Edge Functions host the authenticated AI gateway so the supplied Claude credential can live in Supabase secret storage.

- A committed op batch is immutable; batches from the same turn form one undoable action.

- Word anchors identify a clip occurrence as well as a source word.

- The UI is packaged locally; it never loads a hosted editor.

- The source screenshot is a design reference, not synthetic project footage.

- Model-dependent stages report missing runtimes/models honestly and remain resumable.

- Structural/build reviews use bounded rendered evidence from a saved version, followed by at most one repair pass and a second review. Audio timing data is not described as an audio listening test.

- Routine AI prompts contain a compact catalog. Models obtain exact source words through project-scoped local search/read tools, allowing long sources without uploading their full transcripts in every request.

- Rendered video uses frame extraction through Remotion OffthreadVideo; final MP4s declare BT.709. Color-fidelity fixtures must declare their actual input matrix rather than relying on ambiguous decoder defaults.

- Long-project engine: retain lexical retrieval with model-expanded queries; no new embedding runtime is bundled. Exact IDs, revisioned source reads and explicit user provenance take precedence over generated summaries.

- Routing separates requested mutations from requested approval. Director consultation does not itself request a plan or approval. A read-only route can hand work back to the executor in the same turn.

- Adaptive Sonnet effort is low for isolated exact edits, medium for ordinary implementation and high for difficult work or substantive repeated failures. Opus supplies medium/high targeted direction. Missing resources and account failures do not trigger creative escalation.

- Source-backed project decisions quote actual user messages. A model's design recommendation cannot be promoted to a user requirement. Superseding a decision requires the same scope and preserves its source history.

- SQLite content blobs are compressed and checksum verified. Execution checkpoints reference immutable journal scopes; compaction rotates the active scope while preserving archived results and durable tool receipts. Timeline deltas describe actual documents, with canonical integrity hashes and at most 49 deltas between full checkpoints.

- Reusable visual modules are pinned by content hash. Parameter revisions reuse all module hashes. Exact patches require matching draft/module revisions and one unambiguous match; generated modules remain isolated from Node, external packages and the filesystem.

- Desktop history and library browsing are paginated. State updates carry revision/sequence information and document deltas; missing update sequences trigger a fresh snapshot. Playback reads only source words used by the current timeline.

- The disposable visual cache has a 5 GiB target; recent ten-minute leases can temporarily exceed it. Cache cleanup never deletes retained project media, module source, undo history or interrupted requests.

- Large timeline validation allows a 32 MiB document now that storage and transport use deltas. This is a processing bound, not a guarantee that arbitrary projects up to that size meet the measured latency targets.

- Source understanding is a separate resumable background queue; it never blocks local playback or mutates the timeline. Normal source windows cover six seconds with a half-second look-behind, approximately 2 fps and at most 16 resized images. Uncertain temporal actions may trigger up to two 3.75-second motion inspections at approximately 4 fps. A source-frame tool also supports direct inspection before timeline placement.

- Visual observations preserve absolute source times, actual supplied frame hashes, confidence, uncertainty and denser refinement evidence. Speech is contextual evidence and cannot prove a visual event. Model descriptions are not face identities, exhaustive playback or audio-listening proof.

- Hierarchical narrative summaries reference saved observation/summary nodes; the latest-window description is not presented as the whole-video summary. Source observations and their searchable index survive project collection through the existing SQLite backup path.

- Sampled frames and transcript excerpts are sent through the existing account-gated provider gateway. Missing authentication, quota or uncertain network outcomes leave the scan resumable and its completed observations available.

- Manual editing and AI editing use the same immutable timeline versions, source assets, generation library and grouped undo engine. Mode switching does not translate to a second project format or fork the project. Manual mutation controls pause while an AI turn is active.

- OpenCut Classic's MIT-licensed interaction algorithms are pinned and vendored with notices. Dream owns the UI and adapters; the upstream Rust rewrite is not substituted for the existing renderer or database.

- Manual requests use frame-precise timing. Automatic speech snapping only applies to timing operations on the clips actually being changed, never unrelated pre-existing manual cuts.

- Optional track settings store names, visibility, mute and locks. Locks are enforced at the shared operation boundary. Free manual layers opt into content-derived duration; legacy timelines retain their previous primary-track duration behavior until this feature is used. An explicit minimum duration supports fixed-length canvases.

- Project schema revision 9 marks manual-timeline feature compatibility so older binaries reject newer project features rather than silently dropping them.


## Reliability and workspace revision — October 7, 2026

- Keep existing Sonnet/Opus/Haiku routing and Groq speech. Codex is the reference for plan/progress presentation, not a new provider.
- Thinking signatures carry exact-prefix provenance. Provider-session epochs separate changed prompts/tools/models and compacted messages while local exchanges remain append-only.
- A server-side request/result record owns one provider generation and usage reservation. Subscriber loss does not cancel it; result recovery and explicit cancellation are separate authenticated operations. Results expire after 24 hours and expired records are pruned during request claims.
- Tasks are a dock above the composer; public commentary and actual actions form the chronological conversation. Full-document plan saves are deterministic local operations with revision-checked approval.
- Media readiness is capability-based. Compatible original audio/video can play before collection, normalized audio, speech, and visual context complete. Legacy observer/model jobs no longer gate the current pipeline.
- Editable export uses stable track identities, independent overlap lanes, linked stereo audio, shared preview/export gain envelopes, and isolated rendered graphics when interchange cannot represent an effect. Manual UI is disabled while shared project/timeline code is retained.
## October 8, 2026 — General code agent

One creative agent uses a stable general capability catalogue. It authors workspace files and installs compatible local packages; successful command receipts gate atomic publication. The old editing/generation catalogue remains only in historical compatibility code. Source snapshots and dependency locks follow timeline undo/redo. Public progress and actual file/process/media events share stable IDs and monotonic revisions; private reasoning signatures are excluded from the UI.

Automatic execution uses Windows AppContainer plus Job Object supervision. Node 24.19.0 requires the upstream libuv #5181 pipe-namespace backport; the pinned Python distribution includes an AppContainer temporary-directory ACL adapter. These changes address general runtime compatibility, not individual creative recipes. The packaged environment must pass native qualification before release. No new execution, package-install or spending approval dialogs are introduced. Existing file grants and account limits still apply.

Opus executes subjective/complex work directly; Sonnet executes exact local work. Execution uses an executor profile even after plan approval. Media metrics and sampled frames remain distinct from listening/continuous-motion evidence. Runtime acceptance and product acceptance are reported separately.

## October 9, 2026 — Opus leads, Haiku executes

This entry supersedes earlier statements that Sonnet executes or that Opus executes subjective work directly.

- Haiku 5.5 completes simple exact edits and questions alone. Opus 5.5 leads all creative, multi-part and approved-plan work: it inspects, decides, delegates to Haiku workers through `delegate`, verifies and finishes. The lead has no write or command tools; it may publish what workers prepared or confirm no change is needed. Sonnet is not used by the engine.
- Parallel workers declare disjoint write scopes and never publish; one integration task owns `project.json`. Publication restores the workspace from the published snapshot, so concurrent publication would discard other workers' drafts.
- The agent loop is bounded (60 lead / 80 other model calls, two text nudges) and reports a blocker instead of looping. Completion requires a publication of the current head in the phase; evidence bookkeeping and task lists are reconciled automatically rather than rejecting `finish`.
- Commands never publish. Scenes may reference workspace scripts and stylesheets, which publication inlines.
- Context targets are 90K tokens for Haiku and 180K for Opus. Compaction requires a measured overrun and is sticky (stored prefix, append-only afterwards) to preserve prompt caching and thinking-block bindings. Retained exact reads are bounded to 40% of the target.
- Inference retries unconfirmed outcomes after cancelling them server-side (up to three times). Generations have no side effects; tools execute only after a complete response is saved.
- Effort is fixed per role for a conversation. Tools and system prompts use a one-hour cache breakpoint; worker system prompts are identical across tasks.
- Migrations are idempotent.
- Chat never renders (October 8 rule, reaffirmed after a brief stills experiment): published code appears in the live player immediately and only Export renders. Layout robustness comes from authoring rules (relative sizing, fit-to-box text, flex/grid layout) and source review by the lead.
- Approved plans run in one continuing lead conversation rather than a new conversation per step (per-step cache writes roughly halved in live measurement). Earlier steps' publications do not satisfy later steps.
- Computer-file changes are proposed through `propose_file_changes` with the existing review and resume flow; the October 8 rewrite had dropped this capability.


## October 10, 2026 — Chat, core engine, cost and file system upgrade

- Chat answers and streamed notes share one markdown renderer (tables, lists, quotes, code). Terminal text streams as a note and hands over to the formatted answer, so nothing blinks out at the end of a run.
- A sent message appears immediately (optimistic) and the chat pins to the bottom; a failed send returns the text to the composer.
- The composer chooses the permission mode (Edit automatically, Plan first, Ask only) and the effort (Auto, Low, Medium, High). Ask only routes every request to an answer; a chosen effort applies to every model of that request except the router. Approving a plan leaves plan mode, as in Claude Code.
- The task dock monitors the running request (current step, elapsed time, tasks, latest activity).
- Compaction has hysteresis: an overrun compacts to half the target from the current sticky view, carrying the earlier summary forward, so following steps append to a stable cached prefix. Only real user direction, the two latest Opus advice messages and the newest project-state snapshot survive; engine nudges are dropped and early media images become a note.
- Haiku compacts at 80K and is never sent more than 96K input tokens (newest large tool results shrink to receipts first), keeping it below the 100K long-context price tier.
- The last response's real prompt size calibrates the byte estimate; the token-count endpoint is called only without a calibration or within 5% of the target. Implausible usage reports are ignored.
- A response cut off while only thinking never raises the output allowance: the agent is told to act in one concrete step and that phase's effort steps down. A cut-off with visible content doubles the allowance once. Raised allowances belong to one phase and are cleared after a complete response.
- Effort by role: research and timeline-integration workers low, build workers medium, the lead medium (high after two consecutive worker failures). The composer's choice still overrides. The lead requests a one-hour conversation cache, and every agent role sends a task budget; both are optional gateway features.
- Over-long prose fields (summary, query, brief) are shortened instead of failing the tool call. Paths and code are never trimmed.
- Every provider response records phase, worker, tokens, cost, duration and visible size in an append-only ai_usage table, priced by a client mirror of the gateway formula (parity-tested).
- Activity events are rows (one upsert per stream update). Publications record changed files as hashes and line counts; text is read on demand through file_diff, and older events page in through activity_page.
- Gateway (requires deployment): `cacheTtl:'1h'` makes every breakpoint of a lead conversation one hour; task budgets are forwarded with their beta and switched off for the instance if the provider rejects them; Haiku thinking is summarized (same cost) and shown as transient progress on the worker's row; receipts carry `costUsd` and `dream_policy.features`. Every feature is optional, so the app works unchanged against an older deployment.
- Scene engine: one prebuilt runtime runs every engine scene, so the agent writes only the code for the video and may install packages for anything else. Scenes are React components using Remotion APIs (frame, interpolate, spring, Sequence, transitions, shapes, paths), three.js through React Three Fiber, d3, icons, noise and bundled OFL fonts. Engine helpers cover the plumbing: project media and resources by name, frame-exact video, textures, a ready 3D scene (camera, lights, studio reflections), fit-to-box text, safe areas and beat timing. Nothing in the engine is specific to a prompt or a kind of video.
- The runtime ships as five chunks (core, three, d3, icons, noise) sharing one React, Remotion and three.js through a module registry. Each scene document mounts the scene through Remotion's Thumbnail one frame at a time; a frame is acknowledged only after React commits, 3D roots advance to the frame time, and textures, files, fonts, images and video seeks have finished (suspended resources count until the component that read them commits). Randomness is seeded by the revision and clocks report frame time, so frames are identical in any order.
- Scenes run in their own sandboxed document: dream-engine:// in the player and the loopback render server during export, with the same relative routes and a CSP that allows only that origin plus data and blob URLs. 3D export finds a working WebGL backend on first use (ANGLE, then SwiftShader) and remembers it. Legacy HTML scenes are unchanged.
- Publishing compiles .tsx/.ts/.jsx/.js scene outputs with esbuild (no code runs in the host): engine modules resolve to the shared runtime, packages installed in Workspace/node_modules are bundled, and a package that is neither provided nor installed fails with an install hint. Imports stay inside src/, resources/ and installed packages. Files under resources/ (authored, 24 MB per file, 96 MB total) and files imported from src/ are copied to a content-addressed store (Media/Engine/files) and served by name. Engine scenes default to the project frame size and rate, take props (one component for many shots) and can be transparent. Any input change recompiles and refreshes scenes on the timeline; compile errors name file, line and column and block publication.
- No background test runs. Scene errors come from scenes playing in the visible player or a chat preview: the stack is mapped through the scene's source map to src/file:line, stored per scene revision or draft, added to the agent's project state, and a request cannot finish complete while a scene changed in it reports errors. Writing scene code returns a compile check, and check_outputs compiles drafts that the user sees live under the worker's row before anything is published.
- The agent's default tools for solo and build work are list_files, search, read_file, write_file, edit_file, run_command (package installs stay available), import_resources, check_outputs, read_transcript, publish_project, view_media and, when allowed, propose_file_changes. bundle_scene and the HTML scene guide exist only in advanced mode (DREAM_AGENT_ADVANCED_TOOLS=1). The engine reference (packages/scene-engine/reference/api.md, mirrored into the cached system prompt and drift-tested) is identical for every worker; the lead gets a short capability summary instead. The first message carries the capabilities, and view_media no longer copies computer media into Sources/.
- import_resources reads folders, archives (only matching entries are extracted) and single files directly in the project service under the existing computer permission, writes them to resources/<name>/ with an index of paths, sizes and image dimensions, and respects the 24 MB per file and 96 MB total limits. It replaces copying, extracting or encoding files with commands.
- Music and sound effects are written as data and synthesized by Dream, never as audio code. A music output is a score file (src/music/*.score.json) in compact notation (drum step patterns, note strings with durations, chord progressions, arpeggios, sections and repeats) or a full score document; Dream expands and validates it, naming the field and token at fault. Sound effects are a sound design file or a named preset. Rendering uses the procedural audio worker and is cached by the sound's content, so republishing unchanged sound is instant. Music assets carry their beat times; a scene output that lists a music output reads them with useBeats(name).
- A delegate call is a task graph: tasks name dependencies with after and run as soon as those complete, at most maxWorkers at once; dependents of a blocked task are skipped with that reason. One publishing task must depend on every build task; build tasks that can overlap in time need disjoint writes. The graph and its reports are saved, so a resumed request does not rerun finished tasks.
- Every worker of one call starts from the same project snapshot (overview, media, capabilities, decisions; no query search or conversation), marked for caching, followed by its task, scope and attached context files. Later workers start after the first worker's stream begins (at most 5 s) so they read that cache instead of each writing it.
- A blocked worker is retried once with the reason, unless the block needs the user. Reports carry changed files, outputs, scene errors, attempts, duration and cost. The lead keeps plan notes through compaction, has 100 steps, and verifies from receipts and errors instead of dispatching code-reading review workers.
- Agent media context: a one-line-per-source catalog (capture order when known), one 4x3 contact sheet per shown source instead of separate frames, and a catalog sheet with one frame per source for nine or more sources.
- The run monitor shows the request's running cost, tokens and time per caller (director, Dream, each worker), loaded from ai_usage and kept current by live ai.usage events.
- Computer media is found by when it was captured: find_media scans camera rolls, phone sync folders (OneDrive, iCloud), Videos, Downloads, Desktop and memory-card DCIM folders for a local-time window (today, yesterday, this week, last 7 days, or dates), reads each file's own capture time (QuickTime creation date with time zone, MP4 creation time, EXIF DateTimeOriginal in JPEG/HEIC/TIFF) without decoding, and returns a capture-sorted catalog. Phones connected over MTP are not file paths and are reached through their synced folders.
- import_media imports up to 100 files in one call, four at a time with one state update. An unchanged file (same path, size and modification time) is imported once whatever request brings it. Assets record their source path and capture time. Ids and contact sheets return immediately; proxies, thumbnails and speech continue in the background, with transcription limited to two sources at a time and skipped for clips under two seconds.
- With computer access granted, the agent imports automatically; changes to computer files still go through proposals. A dropped folder grants a read-only subtree. The agent's context states whether access is allowed, the familiar folders, and the local date and time zone that today refers to; media lists are in capture order.
- Media drags straight onto the assistant timeline: Media-tab cards and files from the computer land at the drop time on that row (footage and photos join the story, audio goes to music, other visuals become overlays), several files go in capture order as one undoable change, and a clip crossing the drop point is split there. The timeline appears as a drop zone as soon as a project has media. While Dream is editing, a drop is attached to the next message instead, because history cannot change during a run. The placement code is shared with the manual editor through @dream/timeline.
- Attachments, timeline selections and message media show as media tiles: kind icon, the exact frame at a clip's in point (or the thumbnail), a muted preview of the range on hover, live scenes, audio waveforms and length. A message stores the timeline selection it referred to, so the conversation shows what was selected.

## October 10, 2026 — Fixes from the first live comparison run

- The first live run of the comparison request finished in 5.5 minutes for $0.32 (39 model calls), against 34 minutes and $2.14 before. Its transcript showed where calls were still wasted, and these fixes target only those causes:
  - The engine reference now has a complete, publish-tested example of every timeline item (scene clip, overlay, sound effect, music) and the anchor rules, and says it is complete, so workers stop searching the schema and the workspace for formats.
  - Invalid project documents are reported one line per problem (field, what is wrong, accepted values); an item that cannot be placed says why (missing clip, missing word, no length).
  - check_outputs also checks score and sound files: length in bars and seconds, sections, each track's loop length, and tracks that drift against the bar line. Workers no longer write their own scripts to count bars.
  - The workspace README and environment note no longer point at the retired HTML scene guide; older projects get the new README.
  - Review renders always receive the engine runtime, so a renderer without it fails loudly instead of timing out on scene frames.
- The lead's conversation cache is five minutes until a wait for workers in the request outlasts that (four minutes), then one hour. Live runs showed short requests where the one-hour write (twice the five-minute price) was most of the cost and never paid back. System prompts and tools keep their one-hour cache across requests.
- Scene3D treats a missing, "transparent" or "none" background as a see-through canvas. three.js reads unknown colour names as white, so a live run's teaser came out with white text on a white canvas; unreadable colours are now scene errors that reach the agent.
- The lead finishes once a publication succeeded, no errors are reported and the reports cover the request, instead of dispatching workers to confirm what a report states. A live run spent a third of its cost on such a confirmation.
- Build workers stay at medium effort: a live run with low effort was slower (its large scene write hit the smaller output allowance and was redone) and did not lower the thinking share. DREAM_BUILD_WORKER_EFFORT exists only for such measurements.
- Publishing keeps the project's own timeline ID when a project.json based on the current version carries a different one; the base-version check already proves the document belongs to this project. In a live session a worker rewrote project.json from scratch with a made-up ID and every publish failed with an unhelpful "belongs to another project" error. The engine reference also says to edit project.json in place and keep its identity fields.
- tests/desktop/agent-workflow-live.spec.ts runs a real editing session in the packaged app against the deployed gateway on footage found on this computer: find and cut, reorder and trim, a gloomy grade, motion graphics, music, captions, transitions and speed, swapping a clip, a question, and Export. It runs only with DREAM_LIVE_WORKFLOW=1 on a temporary account with a capped daily allowance.
- Routing favours Haiku: Opus directs only requests that build several new pieces at once (two or more new scenes, new visuals plus new music, a whole video from nothing) or when the user asks for the director. Footage edits that need taste (best moments, montage, reordering, grading and mood, captions, titles, music, transitions, swaps) go to Haiku alone, which sees the footage and can still ask the director one question or hand over. A live editing session showed the Opus lead at about 83% of each step's cost while Haiku workers did the work for a few cents.
- The lead no longer receives contact-sheet images (workers look at the footage), and its briefs state only what is specific to the task, since workers already have the engine reference, the document format and the project snapshot.
