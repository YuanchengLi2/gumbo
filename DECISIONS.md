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

_Partly replaced on October 11, 2026 by "One agent owns the edit": the lead, its relay to workers and the integration task are gone. The loop limits, commands that never publish, retries and migrations still hold._

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

## Export renders JPEG frames at machine concurrency
Opaque exports render JPEG frames (quality 90) instead of PNG and run half the CPU cores at once (2 to 8) instead of a fixed 2; transparent ProRes layers keep PNG; DREAM_RENDER_CONCURRENCY still overrides. Measured on the 30 s live session project (1080p60 sources, grade, transitions, scenes): 483 s before, 214 s after, with no visible difference. scripts/benchmark-export.ts times the export path for any project.

## October 10, 2026 — Request safety limits

- Every request has a spending limit, $2 by default (DREAM_REQUEST_BUDGET_USD). It is checked before each model call from the request's recorded cost; at the limit the request stops as interrupted with the work so far saved, and each resume allows the same amount again. Before this only the account's daily allowance applied, so one stuck request could use most of a day's budget.
- The same failing tool call three times (or a similar one four times) ends the request as blocked, one attempt sooner than before; the second failure still asks the director or hands over first.
- Spending-limit, quota and sign-in errors from workers end the request instead of being returned to the lead as task errors to retry.
- When the router fails, the request starts with Haiku (which can still call the director) instead of falling back to the local guess, which sent every open-ended request to Opus without notice.
- Every time Opus takes part in a request is recorded as an ai.escalation event with its kind (route, switch, consult, plan) and reason, so live runs show how often it happens and why.

## October 10, 2026 — Timeline actions for the agent

_Replaced on October 11, 2026 by "The agent edits through code; the timeline actions are gone"._

- The agent changes the timeline with edit_timeline: the same typed operations the manual editor uses (insert, trim, split, move, delete and replace clips, speed, framing and grade, clip audio, transitions, overlays and sound effects, captions, music, settings), plus outputs to declare new scenes, music and sound so actions can place them as output:<id>. Live sessions showed most failures and much of the cost came from the agent reading and rewriting the whole project.json for every edit, including a run that invented a new timeline ID.
- Actions apply in order and nothing applies unless every action passes. Each is checked as it is applied; an error names the action and the problem, with the IDs that exist when it named one that does not. The result is then checked against the sources: every asset or declared output exists, every range lies inside its source, every changed item has a length and a clip to stand on, and a deleted clip may not strand items anchored to it.
- The call publishes in the same step (publish:false defers to publish_project, for changes that go with new code), and returns a compact list of what changed instead of the document. A repeated or resumed call replays its saved document and publication instead of applying its actions twice.
- Code is written only for new visuals, music and sound. project.json is edited directly only for what no action expresses. Only the solo editor and a publishing worker get the tool; the director still never edits.

## October 10, 2026 — Smaller agent context

_Partly replaced on October 11, 2026: the director it mentions is gone (see "One agent owns the edit"). Change-only state messages and the tiled frames of view_media still hold._

- Project-state messages report only what changed. The first message already carries the project and its media, so no full state follows it; after that, each change sends the changed fields, and for media and decisions only the records added, changed or removed. The full state is saved locally under the message, and compaction restores it when it drops the earlier messages a change report builds on. A worker whose snapshot describes an older version still gets the full state first. Measured on the saved live sessions, state messages shrink by 87 to 89 percent.
- A look at footage (view_media) with five or more frames returns them tiled on 4x3 contact sheets instead of separate images, about a quarter of the image tokens; a range of a second or two still returns full-size frames for close checks. Looks at footage were the largest results in the live sessions.
- The first message carries at most six code excerpts of 2,000 characters (was twelve of 5,000), and 9,000 characters of related project records (was 14,000). Transcript words carry only id, text, start and end, plus a speaker or an uncertainty flag when there is one.
- Not changed: the Opus compaction point (180K tokens) was never reached in the live sessions, and the Haiku editor already starts without footage images; the director's start is text only.

## October 10, 2026 — Old director removed; session numbers per request

_review-packet and footage-tools were deleted on October 11, 2026 with the footage map (see "The agent looks at footage itself; nothing pre-interprets it")._

- The old tool-based director (legacy-director.ts) and the modules only it used (read-loop, director-consult, design, review-loop, presentation, tool-registry, tool-context, visual-tools, media-tools) are deleted. The app had not used them since the code engine; about a fifth of the integration tests still exercised them, so a passing suite said less about the shipping app than it seemed. Each behavior those tests covered (resuming without repeating effects, file approval, truncated responses, plan approval, transient retries, compaction, undo) has a test against the current engine; tests in mixed files that did not use the old director are kept. review-packet and footage-tools stay for the smoke scripts.
- scripts/session-report.ts reads a project's database read-only and reports each request: status, time, cost, calls per model, the largest context sent, the share read from cache, moves to Opus with their reasons, compactions and spending-limit stops; --compare puts an older session's numbers beside it. The live session test records these numbers for every step and writes session-report.txt, compared with DREAM_LIVE_COMPARE when set. The last live session before these changes: $0.70 for nine requests, $0.57 of it Opus in the first three.

## October 10, 2026 — Haiku first, then Sonnet, then Opus

_Replaced on October 11, 2026 by "One agent owns the edit": a failing request continues in the same conversation on a stronger model, and there is no director._

- Haiku starts every request that changes or questions an existing project. When the engine sees it fail (the same tool error twice, the step limit, or repeated output cut-offs), Sonnet takes over working alone, with the same tools and a handoff of the request, Haiku's latest notes and what is published. When Sonnet fails the same way, the Opus director takes over. Before this, Haiku's second repeated failure went straight to Opus.
- An editor that asks for direction (switch_to_orchestrated: several new pieces built together) gets a Sonnet director with Haiku workers. A Sonnet director whose workers keep failing (two or more failed tasks) and that finishes blocked hands the request to Opus once. A consultation goes one step above the model asking: Haiku asks Sonnet, Sonnet asks Opus.
- The router chooses haiku, sonnet (one request that builds several new pieces) or opus (a whole new video from nothing, or when the user asks for Opus or the director). The app enforces that rule itself: an Opus route on a project that already has a timeline, or for a question, becomes Sonnet unless the request names Opus or the director, so it also holds with a gateway whose routing schema only knows haiku and opus. The gateway schema now also accepts sonnet; it takes effect when the gateway is next deployed. Script and concept replies are written by Sonnet.
- A plain follow-up edit (an instruction such as "make it warmer" or "add crossfades", not a question, a plan, a script or a call for a stronger model) on a titled project with a timeline goes straight to Haiku without a router call, which saves a round trip before work starts.
- Every move to a model above Haiku is an ai.escalation event with its kind and reason, and each mode switch records the models on both sides.
- Planning requests (plan first) and approved plans still run with Opus, since the user asked for them explicitly.

## October 10, 2026 — Project notes and timeline outline

- Every request starts with an outline of the video in order: one line per clip with its place on the timeline, source and range, speed, framing, grade and transition, then overlays, sound effects, music and captions. Follow-ups such as "the middle clip" or "the title" can be acted on without reading project.json or looking at the footage again. Workers get the same outline in their snapshot.
- The editor or director keeps project notes: finish takes optional notes (what the user wants for this video overall, such as mood, style, pacing, likes and dislikes, and lasting decisions), which replace the previous notes and appear as projectNotes in every later request. They are written in the call that already ends the request, so they cost no extra model call. Workers and consultations never write them. Verbatim user preferences still go through remember_decision.

## October 10, 2026 — What the agent saw stays with the project

_Partly replaced on October 11, 2026: the notes travel as sourceNotes in the request block (see "The cached briefing actually stays the same"), and the visual-understanding job it mentions was deleted with the footage map._

- The plan assumed footage descriptions were already saved; they are not (the visual-understanding job is not wired into the app and its jobs are retired when a project opens). Instead, finish takes optional sourceNotes: one short line per source the agent looked at, saying what it shows and where. They are saved per source (a new note replaces the old one) and listed as seen in the media list of every later request, so follow-ups like "swap the last clip for one that fits the mood better" can choose from what was already seen and look with view_media only for what the notes do not cover. The notes are written in the call that already ends the request; nothing scans footage in the background.

## October 10, 2026 — Reads in one response run together

- When one response asks for several reads (read_file, view_media, read_transcript, search) before any other call, they start together and their results are still recorded in order. read_transcript waits up to two minutes while a source is still being transcribed, so transcripts of several clips just imported, which used to wait one after another, now overlap; looks at several clips extract their frames in parallel. A read that comes after a write in the same response still runs after it.
- The editor is told transcription runs in the background, to ask for several transcripts or looks in one step, and to skip transcripts of sources whose speech does not matter to the request, so a first cut on visuals does not wait for speech.

## October 11, 2026 — A second live session aimed at the new behavior

- tests/desktop/agent-editing-checks-live.spec.ts (only with DREAM_LIVE_EDITING=1, capped like the first) runs ten follow-up requests on footage found on this computer: a first cut, a mood stated once ("calm and dreamy... keep that in mind"), swapping the second and third clips, making the first clip exactly 2 seconds, extending the last clip by 30 seconds (which most clips cannot give), music that fits without restating the mood, a title scene, replacing the shakiest clip, removing the music, and a question about the mood and length; then Export. Every check reads the project state (exact order, exact length, ranges inside their sources, an honest reply when the footage runs out, the mood recalled), nothing is judged by a model.
- Steps also carry targets for the cost and speed goals: simple follow-ups without a router call, on Haiku only, under $0.05 and a minute; no Opus anywhere; the mood in the project notes; notes on what was seen after the first cut; at most two looks at footage when replacing a clip. Problems and missed targets are both soft failures, so the whole session always runs and the report shows each.
- The first session stays as it was, so it can still be compared with the run before these changes. The shared setup is in tests/desktop/live-session.ts. The session report now also shows whether a request used the router and how many looks at footage it made.

## October 11, 2026 — First live run of the editing checks, and three more sessions

- The editing-checks session ran live against the packaged app with every change through October 10: all ten requests passed their checks and Export produced the video, for $0.066 in total with no Opus call, in 225 seconds of requests (the previous full session, with different requests, was $0.70 with $0.57 of Opus, 498 seconds). Simple follow-ups (swap, exact length, remove music) took 6 to 8 seconds for $0.002 to $0.005 each, without a router call. The mood stated once was saved in the project notes, used for the music without being repeated, and recalled when asked. Evidence: artifacts/live-editing-checks-1791691366159.
- Two targets were missed. "Extend the last clip..." went through the router because extend was not a plain-edit verb; extend, stretch, shrink, rotate and flip now are. Replacing the shakiest clip took eight looks at footage: the first cut was built from import contact sheets and transcripts without looking closely, so no note said which clip shakes. Finding shake needs looking, so that target is now at most eight looks.
- Three more live sessions share tests/desktop/live-session.ts: a long video (DREAM_LIVE_LONG: a two-minute recap of a week of footage, a dozen follow-ups by clip position, the context of the last follow-up within 30 percent of the first, then the best 45 seconds of the longest video), media already in the app (DREAM_LIVE_IMPORTED: generated clips that differ only in color, a photo and a song imported through the app's picker with no computer access; used by look, by name, as an attachment and as a timeline selection, and what was left out recalled), and interruptions and modes (DREAM_LIVE_INTERRUPTIONS: stop part way and continue without duplicate scenes, an accidental undo put back, ask-only changing nothing, plan first waiting for approval and then running, stop and redirect, a vague request).

## October 11, 2026 — The footage map: the agent sees what the footage shows

_Replaced on October 11, 2026 by "The agent looks at footage itself; nothing pre-interprets it"._

- The live editing-checks run showed the agent editing video from transcripts alone: the project held only words, it looked at footage in one of ten requests, and its notes on sources quoted dialogue. It extended a clip into a paused stretch and a screen-recorder window it had never seen.
- Every imported video or image now gets a footage map in the background after it is ready (stage footage_map). One local ffmpeg pass at 320 px and 10 fps (about 15 times real time) finds cuts (scdet), frozen stretches (freezedetect, which catches a paused video), black stretches, blur, brightness, motion and camera shake (vidstabdetect; the frame-to-frame camera move minus its one-second average, so pans do not count). Shots between cuts carry their measurements and problems (frozen, black, dark, blurry, shaky); thresholds were set on real footage (sharp video blurs at about 4, soft at about 9; steady footage jitters about 1 px per frame, handheld 4). Then one inexpensive Haiku call looks at a contact sheet of up to sixteen shots and returns a line per shot (what it shows, framing, tags, energy, usable) plus problems measurements cannot see: player controls, a screen-recorder or desktop window, a pause icon, burned-in text, watermarks, letterboxing. Without a connection the map keeps every measurement and says the shots were not described. Shots are stored in the existing shot records, so search finds them by description. Loudness (EBU R128) is measured per source as well (stage loudness).
- The media list shows each source's map (summary, shots with their problems, frozen and black stretches, where usable footage ends), within a budget of about 150 shot lines across sources; a source not analyzed yet says so. The timeline outline says what each placed clip shows and what is wrong in its range.
- edit_timeline returns warnings with the result, never blocking: placed ranges that are frozen, black, dark, blurry, shaky or show junk (with where usable footage ends), sources not analyzed yet, slow motion below half speed, a clip over 40 percent of a video of 15 seconds or more, and the same footage used twice. The agent fixes them or says in its recap why it kept them, and is told to offer an alternative when a request cannot be met with good footage.

## October 11, 2026 — The project briefing is cached across requests

_Partly replaced on October 11, 2026: the footage map is no longer in the cached block (see "The agent looks at footage itself; nothing pre-interprets it"). The two-block cached briefing still holds._

- In the live run, cache writes were 56 percent of all spending: every request rebuilt a briefing of about 25,000 characters and put it after the request text, so no part of it could be read from cache by the next request. The first message is now two blocks. The first holds what changes rarely (capabilities, environment, the computer without its clock, the media list with each source's footage map) and carries a cache breakpoint, so a request within five minutes of the last reads it instead of writing it again. The second holds the request and what depends on it: the time, the timeline outline, project notes, decisions, recent conversation and related records.
- The briefing lists authored files by name instead of carrying code excerpts (up to 12,000 characters, unrelated to most edits); search and read_file open the code a request needs. Related project records are capped at 5,000 characters, since the timeline outline and the media list now cover clips and sources.

## October 11, 2026 — Tools that failed at their job in the live run

- remember_decision failed both times it was used for its purpose: the agent passed a conversation record ID (conversation:<id>:0), then a made-up one. The message ID is now optional and may be either form; the quote itself finds the user's message (the named one, else the latest of their recent messages that contains it), compared without regard to quote marks, dashes or spacing. Words the user never wrote are still refused.
- view_media refused motion detail over more than 8 seconds and said so only after the call, so finding the shakiest clip took seven looks. A longer range is now sampled more coarsely (scene-aware overview up to 60 seconds, a preview beyond) with a note that a shorter range gives frame-by-frame motion.
- A choice field sent as quoted JSON ("\"captured\"") is unwrapped; only fields with a fixed set of choices, so file contents keep their quote marks. Invalid tool input is reported as plain lines (field, what is wrong, the accepted values) instead of raw validator output.
- Project notes hold what the user wants, never the current state of the edit (the live run's notes said "five shots at 0.75 speed" two edits after that stopped being true). Replies never mention internal records such as project notes, the footage map or receipts.

## October 11, 2026 — Effects the agent can use, and a real white balance

- The player already supports effect items on footage (slow_push, punch_zoom, shake and a grade layer), and the manual editor offers them, but the engine reference and the edit tool never mentioned them, so the agent never used them. They are now documented with an example: an attached item of type effect changes every clip under it, with no scene code.
- Colour temperature was a sepia tint plus a rotation of every hue: cooler footage got a warm tint and a fixed -20 degree hue shift. It is now an SVG colour matrix (feColorMatrix, sRGB interpolation) that scales red against blue, with green following red slightly; the composition defines one filter per temperature used by clips and grade layers, and clips refer to it by ID. Checked in the app's render browser: grey 128 becomes 144,131,112 warmed by 0.5 and 112,125,144 cooled by 0.5. The grade layer now takes a temperature too.
- The bulk-import test waits for background analysis, which now includes the footage map, before closing the project; it has 90 seconds under a full parallel run (about 6 alone).

## October 11, 2026 — Balanced sound

- Clips played at whatever level they were recorded and the final mix was never normalized: the live run's export measured -12.3 LUFS with a 13.5 LU loudness range. Each clip's sound is now levelled toward -18 LUFS from its source's measured loudness (at most 12 dB either way), in the shared audio manifest, so preview and Export hear the same thing; the clip's own gain still applies on top. Music keeps the gain it was given (generated scores carry no measurement, and the agent sets music relative to dialogue). A project can turn levelling off with settings.autoLevel false.
- Export then brings the finished mix to -14 LUFS with true peaks below -1.5 dBTP in two passes (measure, then a linear loudnorm), copying the picture untouched; silent exports and ones already within half a decibel are left as they are. Export progress shows "Balancing the sound" for this step.

## October 11, 2026 — The agent may download anything and write any code

- The user wants the agent to work like Claude Code: install or download any tool, library, model or binary, write any code, and process audio, images and source footage however a request needs. The instructions no longer forbid building infrastructure, limit installs to what the engine lacks, or confine commands to data files; they say commands have internet access (the sandbox already had it) and that produced media goes under output/ as an output to place on the timeline. Media outputs may now be video as well as audio and images, so a cleaned-up recording or a converted clip can go on the timeline. The one rule left: the edit itself renders only when the user clicks Export.
- Safety limits stay as limits on spending, not on capability: each request may now spend $3 (was $2) before it stops with its work saved, and each resume allows another $3. Changes to files on the user's computer still need their approval, and no account credentials reach the agent's commands.

## October 11, 2026 — Second live run of the editing checks, with the footage map

- Same ten requests on the same footage as the first run: all checks passed except one, which was a fault in the check, and Export produced the video. $0.075 in total with no Opus (first run $0.066), 304 seconds of requests (225). The export is 47 seconds at -14.3 LUFS with an 8.2 LU range (first run: -12.3 LUFS, 13.5 LU). Evidence: artifacts/live-editing-checks-1791736600743.
- The quality fault from the first run is gone. The agent recognized the sources as screen captures of videos, used the playback content and left out desktop and recorder windows; asked to extend the last clip by 30 seconds, it built the time from clean footage, skipping a player window and a blurry stretch, and its recap said the shot runs long and asked the user to check the pace. No frame shows player controls, a pause icon or a recorder window (the first run's export ended on all three).
- Two follow-ups. Swapping two clips also trimmed and slowed the moved clip because the outline flagged it (6 calls and 40 seconds instead of 2 and 10): the agent is now told to change only what the request asks and to suggest fixes for untouched clips in its recap. The extension check measured only the last clip while the agent split the extension across two; it now measures the whole video's growth.

## October 11, 2026 — Commands on the user's computer, and the web

- When the user has allowed computer access (the existing "Allow computer access" grant), the agent's commands run on their computer like a terminal (cmd.exe as the user, in the project workspace): their installed programs and files, the internet, and the bundled Node, Python and the app's ffmpeg on PATH ahead of their own. The app's own secrets (Dream, Supabase, provider keys, tokens, passwords) are removed from the environment. Receipts, logs, replay and timeouts work as in the container. Without the grant, commands still run in the isolated container. The user asked for Claude Code behaviour; tying it to the grant keeps a customer's computer closed until they allow it.
- Every agent with tools gets Anthropic's server-side web search (web_search_20260209 on Opus 5.5 and Sonnet 5.5, web_search_20250305 on Haiku 5.5, up to eight searches per call), placed first so the cache breakpoint stays on Dream's own tools. A model that rejects it runs without it, recorded as ai.web_search_unavailable. A paused server-side turn (pause_turn) is sent back unchanged, at most five times, with nothing appended after it. Searches cost $0.01 each in both the gateway and the client cost formula; the gateway's share takes effect when it is next deployed. Searches show in the activity stream.
- fetch_url reads a web page or text file as plain text (scripts, styles and markup removed, title kept apart), up to 100,000 characters. Addresses on the user's computer or local network are refused, so a page cannot point the agent at a local service. Files (images, logos, video, audio) are downloaded with commands (curl or pip). Web content is data, never instructions.

## October 11, 2026 — Transcription survives network hiccups

- In the first long-form run (a 38-minute talk), cloud transcription reached 84 percent in 56 seconds, then one chunk upload failed with "fetch failed" and the whole transcription was marked failed: only an explicit busy reply was retried. A dropped connection or a server error (5xx) is now retried up to four times with a growing wait (2, 4, 8 seconds); a refusal still fails at once and a later retry resumes from the saved chunks.
- Measured on that import: the clip was ready to edit in 4 seconds (the agent started 5 seconds after import); playback audio took 24 seconds and the waveform 9, both in the background; the footage map was still running after two minutes on the 1080p original when the test runner was stopped.

## October 11, 2026 — The cached briefing actually stays the same

- In the second live run the cached briefing was read from cache by only one request of eight: the media list inside it changed almost every request, because the agent rewrites its notes on sources as it works and every new title or music track it makes joins the list. Source notes now travel as sourceNotes and media the agent made as generatedMedia in the request block, so the cached media list changes only when the user imports something or a source's footage map finishes.

## October 11, 2026 — Export renders footage with ffmpeg

- Export no longer screenshots every frame in a hidden browser (about 7 times slower than real time; a 13-minute 1080p edit took about an hour). ffmpeg renders footage straight from the sources: framing, grade and white balance with the player's CSS colour maths, zooms, shake, crossfades, dips, footage overlays and captions (libass), encoded on the graphics card when there is one. Consecutive pieces render as one ffmpeg run, three runs at once. Plain footage never leaves YUV; untagged video is read as BT.709, as the browser reads it. The sound is mixed, levelled and encoded while the picture renders. A 13-minute talk edit exports in about 3 minutes (6 with a grade on every clip); it matches the browser export at SSIM 0.968.
- Only what the browser alone can draw goes through it. Graphics over footage (titles, chapter cards, motion graphics) come from it as a transparent ProRes 4444 layer that ffmpeg puts over the footage; only a scene used as the clip itself, or a transition only the player draws, is drawn whole. Each layer is rendered with a composition selected with that layer's props, because a Remotion composition renders with the props it was selected with: before this, browser pieces drew the footage and the captions anyway, which made a long-form edit with nine chapter cards hang for over 40 minutes. That edit (10 minutes) now exports in 5.
- If the native path fails, the browser renders the whole video as before. DREAM_EXPORT=browser forces the browser path.

## October 11, 2026 — Editing starts while a long recording is still being transcribed

- read_transcript returns the speech transcribed without gaps from the start while transcription runs, waiting at most 45 seconds for the requested page, with transcribedUntilSec; its revision stays fixed while words are appended, so pages already read stay valid. Each source's state shows how far transcription has got.

## October 11, 2026 — The agent looks at footage itself; nothing pre-interprets it

- The import-time footage map is gone: no measured "frozen / dark / black" labels, no one-frame-per-shot descriptions (one Haiku call per import), no preview frames warmed for the agent, no contact sheets pushed into its first message or returned by import_media, no shot descriptions in the timeline outline or in project search. In the first long-form run the map called a talk with a moving speaker in a corner box "solid black frame" and flagged every clip frozen and dark; the warnings were then ignored wholesale, and the one real warning (the hook used twice) with them.
- What the agent gets is facts: each source's length, size, frame rate, sound, path, capture time, its own earlier notes (sourceNotes), and how far transcription has got with the file of timed words. It decides what to look at (view_media frames at the times it picks) and measures with code.
- Cloud transcription still runs at import: it is raw data (what was said, with timings) that captions, music ducking and word anchors need, and it is a file the agent may read, not pushed into its context.
- Kept for the player and export: playback copies, thumbnails, waveforms, loudness (auto-level). Earlier projects' maps, shot descriptions and video observations are dropped from the search indexes by a migration, and their footage_map/context/shots jobs are retired on open. The dream-context preview runtime and its staging script are removed.
- Edit warnings keep only facts about the timeline: slow motion, a dominating clip, footage used twice.

## October 11, 2026 — The agent edits through code; the timeline actions are gone

- edit_timeline is removed. Every edit (cutting and tightening speech, ordering, pacing, framing, colour, effects, graphics, titles, captions, music, sound) is a change to project.json made by the agent: directly for a small change, or by a program in any language it writes and runs that reads the project, the sources and context/ and writes it. What the timeline cannot express it makes: processed or generated media under output/, or a scene. In the first long-form run the agent's helpers cut speech by typing seconds into dozens of timeline actions, then reported the pause removal blocked; a program over the transcript does that work exactly.
- ffmpeg and ffprobe (the app's own) are on PATH in the isolated command container as well as on the user's computer. read_file returns an image the agent's code wrote (a frame, a crop, a sheet of frames), so it can look at what it measured.
- publish_project checks what the request changed, from the timeline and the transcript only: footage used twice, a cut inside a spoken word, silence over three seconds between words inside a clip (must fix), slow motion and a dominating clip (notes). finish complete is refused while a must-fix check is neither fixed nor listed in finish.kept with a reason, and while a task the agent delegated is still blocked or was skipped: unfinished work is not reported as done.
- The engine reference documents the project document itself (sources, transcripts, clips and their framing, outputs) instead of actions. It states that a clip's scale zooms about the frame's centre: the agent's punch-in on a speaker in a corner box zoomed into the black slide area, so a region is cropped by processing the footage or with a scene.

## October 11, 2026 — One agent owns the edit

This entry supersedes the October 9 entry (Opus leads, Haiku executes) and the October 10 entry (Haiku first, then Sonnet, then Opus) where they describe a director.

- One editing agent owns each request from start to finish: it looks at the footage, decides, edits project.json, publishes, checks and replies. In the first long-form run a Sonnet director relayed the work to Haiku workers through written briefs; a worker reported the pause removal blocked, and the director published and called the request done.
- The router picks that agent's model: Haiku for changes to an existing edit and edits of short footage; Sonnet for a big edit (the first cut or a full re-edit of long footage, many sources cut into one video, or several new pieces built at once); Opus only for a whole new video made from nothing or when the user asks for Opus. The route schema is unchanged, so the gateway needs no deploy.
- When the agent keeps failing (the same error twice, a similar one three times, its step limit, or three cut-offs), the same conversation continues on the next model up (Haiku, Sonnet, Opus) with everything it has read and done and a fresh step allowance; a resumed request keeps the stronger model. Before this, a new conversation started from a written handoff. At the top of the ladder a repeated failure asks Opus for direction instead.
- The director (lead role, its prompt, switch_to_orchestrated, hand_off and the mode phases) is removed, and so are research workers: the agent reads in parallel itself.
- For separate pieces that take real work (several new scenes, or scenes and music) the agent may delegate Haiku helpers as a task graph. A helper writes only its declared paths: it never edits project.json, publishes, imports media or changes the user's computer. The agent places their outputs and publishes. finish complete is still refused while a delegated task is blocked or was skipped.
- Plan first: the Opus planner writes the plan; the approved steps run as one Sonnet editing-agent conversation (was the Opus lead).
- consult_director asks the model one step above the asker. Effort and task budgets have no director settings left: Auto effort is low for the router and simple work, high for difficult work, medium otherwise; the editing agent sees a 120K task budget and helpers 100K. The run monitor labels the agent's costs Dream and each helper by its task.

## October 11, 2026 — Sonnet only, a real environment, and checks before a live run

This entry supersedes "One agent owns the edit" where it describes choosing a model and moving up a ladder.

- Every role runs on Sonnet 5.5: the router, the editing agent, its helpers, plans and replies (`models.agent`). The Haiku, Sonnet, Opus ladder, escalation within a request and consult_director are removed. A repeated failure is now the agent's own to diagnose (the second identical failure returns diagnosisRequired, and the prompt says to find out why and change approach); the third ends the request as blocked with its work saved. Replies have the read-only tools, so they can look at the transcript or frames before answering. Starting on Haiku and stepping up added routing, escalation and consultation paths, each with its own failures, to save cost on easy requests; one capable model is simpler to get right.
- The workspace is real: nothing the agent reads is a stale copy. The context files were rewritten only between tool calls, so in the October 11 long-form runs the agent's script waiting for the 38-minute transcript (Haiku in one run, Sonnet in the next) read a frozen file and would have waited 25 minutes after transcription had finished. While a command runs, each transcript file is now rewritten as its transcription advances, and assets.json with the Sources/ copies when a source is added.
- The gateway attaches the routing JSON schema for Sonnet as well (only Haiku had it), so a Sonnet router still answers in the schema. This needs `supabase functions deploy dream-gateway`.
- A live session refuses to start when the packaged app is older than the app's code or the deployed gateway older than the gateway's code. The October 11 long-form run went to Haiku because the Sonnet routing schema, committed the day before, had never been deployed. A short live smoke session (three minutes of the talk, then captions) runs before a long one.
- The workspace's package.json no longer declares "type":"module" (earlier workspaces lose it on open). In all three October 11 runs the agent's first `require()` script failed on it; without it Node 24 runs CommonJS and detects ES module syntax, as in a fresh npm project. The smoke session (three minutes of the talk to a 66-second cut, then captions) passed every check for $0.40 in 74 seconds, and its script waiting for the transcript returned as soon as transcription finished.
- Auto effort is medium for every role (the router stays low: it classifies within a 2K-token allowance, and more thinking could cut off its answer). The router called nearly every request difficult, which meant high effort: in the long-form session thinking was 57 percent of all output, and adding chapter titles cost $0.30. A user-chosen effort in the composer still overrides it.
- When DREAM_AGENT_MODEL selects Haiku, its Auto effort is xhigh (Haiku 5.5 accepts low to max), to make up for the smaller model at a fraction of Sonnet's price; Sonnet stays at medium. The contracts and the gateway accept xhigh (needs `supabase functions deploy dream-gateway`).

## October 12, 2026 — One gate decides when an edit is done

- A request could end "complete" three ways, and only the finish call checked the published edit. In the Haiku long-form run the first cut ended complete with six silences of up to 25 seconds left in, while the agent's own reply said it was not finished: a plain reply with something published was accepted, and so was running out of nudges. Every way an edit can end complete now goes through one check (completionBlocker): the head is published with nothing unpublished, no scene it changed fails while playing, every must-fix check is fixed or kept with a reason, and no delegated task is blocked. A reply that fails it is told exactly what is left; when the nudges run out the request ends blocked with that list, never complete. Replies to questions, plans and helpers are unchanged.
