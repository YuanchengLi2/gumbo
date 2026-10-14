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

## October 12, 2026 — Every failed AI response is recorded with what the stream showed

- The Sonnet long-form first cut died on "The AI response could not be decoded" after retries, and the cause could not be found: the stream reader built diagnostics, but nothing saved them, and a record that was not JSON carried none. Each failed attempt is now an ai.inference_failed event with the model, phase, attempt, error code and message, and the reader's diagnostics: stop reason, open blocks, block types, whether a tool call's JSON failed to parse, and the last 20 events. A record that is not JSON is an invalid stream naming its event and the first 300 characters. The session report lists failed responses per request. The shared stream reader is also the gateway's, so this needs `supabase functions deploy dream-gateway`.


## October 12, 2026 — Every call carries less: what the October 11 runs actually spent tokens on

- Measured with `scripts/cost-anatomy.ts` (images counted by pixel size; the earlier estimate counted their base64 text and put images at 36%, when they were about 3%). In the Sonnet long-form run the re-read tokens were the system prompt and tools (38%), the briefing (18.5%), thinking (13%), view_media text (9%) and command output (8%). One view_media look carried 85,000 characters of text: up to 300 transcript words as full JSON objects.
- The system prompt keeps the rules and the project-document half of the engine reference; the scene-authoring half (imports, @dream/engine, frame rules, scores, examples) is written to context/engine.md and read when a scene or sound is written. Helpers, which always write scenes, keep the whole reference. Tool schemas carry types, choices, defaults and required fields; length and count limits are still enforced when an input is parsed. The editing agent's fixed prefix is 6.8K tokens (was 12.7K).
- Replies and plans are sent the editing agent's system prompt and tool list (the engine still refuses their write calls), and the mode travels in the first message, so they read the same cached prefix and briefing.
- view_media gives the model a compact view (frame times, words as "start end text" lines, merged coverage spans; no absolute paths or hashes), with the full evidence still saved with the call. A default look keeps every other frame on contact sheets about 1024 px wide; detail true gives every frame, full-size frames for short ranges and 1568 px sheets. read_file images are about 1024 px. read_transcript returns words as lines. Command results drop timings, log path, isolation and hash (kept in the receipt).
- The briefing lists library versions once, sound presets as their combination, media the agent made without paths or dimensions; relevant records are only what the user selected or attached and matching earlier conversation (the outline already lists every clip); earlier assistant replies are cut to 700 characters.
- Not changed: thinking (13% of Sonnet's re-reads, 41% of Haiku's at xhigh) is preserved by the provider and never edited mid-conversation; effort decides it.

## October 12, 2026 — Every result's text is capped, including looks at footage

- In the Sonnet long-form run, one look at footage added 52,812 tokens to the conversation in one step (94,735 characters of text beside its images), which every later call in that request re-read. The size cap applied only to results that are plain text; a result of text and images bypassed it. Now the text blocks of any result share the same budget, with the receipt to read the rest.
- Considered and not done: clearing old tool results earlier. Simulated on the October 11 Sonnet calls, clearing at 35K to 100K tokens changed input cost by -7% to +7%, because each clearing rewrites the cache at 12.5 times the price of reading it. Skipping the calls after a failed one in the same response was tried and removed: the engine cannot tell dependent calls from independent ones, and a helper's independent writes were skipped.

## October 12, 2026 — The user picks the model in the composer; Auto sends small changes to Haiku

This entry supersedes "Sonnet only" (October 11) where it says every request runs on Sonnet.

- The composer has a Model choice: Auto (default), Sonnet or Haiku. It is pinned per request (agent-model:<turnId>), so the agent, its helpers and any resume share one model and one prompt cache.
- Auto runs a request on Haiku only when it is a small, precise change to an edit that exists: the router (or the plain-edit shortcut) calls it a simple local edit, and it names no new visuals, sound, captions or whole-video change. The first cut, motion graphics, scenes, music, captions, pacing across the video, questions and plans stay on Sonnet. In the October 11 runs Haiku cost about a seventh of Sonnet but left long silences in a first cut, which the completion gate now refuses.
- The router stays on Sonnet; DREAM_AGENT_MODEL still forces one model for a measured comparison.

## October 12, 2026 — The timeline beside the chat is the editor

- The layout stays: chat on the left, player and timeline on the right (a full OpenCut-style rearrangement was considered and dropped). The timeline under the player is the OpenCut-derived one that was dormant in the manual editor: drag clips to move them (onto another row, or onto the empty row below the used ones, which makes a new track), drag edges to trim, marquee and Shift/Ctrl selection, snapping (Alt to bypass), Delete, Ctrl/Cmd+B to split, Ctrl/Cmd+D to duplicate, and media dropped from the Media tab. Each change is one undoable version the agent sees in its next request; while the agent works the timeline is locked and dropped media goes with the next message.
- It is minimal: no card around it, flush under the player, a zoom slider in the corner of the ruler (double-click fits), icon-only track headers with mute and hide on hover, no toolbar, footer or horizontal scrollbar. It opens fitted to the width, with the main track first. Its height is dragged from its top edge and remembered.

## October 12, 2026 — No router: the user picks the model

This entry supersedes "The user picks the model in the composer; Auto sends small changes to Haiku".

- The composer's Model choice is Sonnet (default), Haiku or Opus 5.5, and that is the model the request runs on (agent, helpers, replies and plans). Auto and the router model call are removed: the router rated nearly every request difficult, so a rule built on its rating could not be trusted to pick a model. DREAM_AGENT_MODEL still sets the default for a measured run.
- Whether a message is an edit, a question to answer, or carrying on with a stopped request is read from its words and the Permissions mode (Edit, Plan first, Ask only), with no model call. The agent sets the project title itself.

## October 12, 2026 — Requests travel compressed, because the firewall in front of the gateway blocks the agent's code

- In the October 12 live long-form run three requests (the first cut, the faster middle, captions) failed four times each with "Unexpected token '<', \"<!DOCTYPE\"". Replaying the saved conversation without a login showed why: Cloudflare, in front of Supabase's functions, answered 403 with its HTML block page, because a tool call in the conversation was a Node one-liner with require('fs').readFileSync(...).writeFileSync(...), which its rules treat as code injection. The first message alone reached the gateway (401 JSON). A code-writing agent sends such content all the time, and the October 11 "could not be decoded" failure was most likely the same block.
- The desktop now sends the AI and token-count requests gzip-compressed (application/x-dream-json-gzip) and the gateway decompresses them; plain JSON is still accepted. The same conversation compressed reaches the gateway. A reply that should be JSON and is not now fails with its status, content type and the start of its text, recorded with the failed attempt.
- Without a router, a message is a question when it starts with a question word (now also where, which, who, when, do, did, was, were, should); in the same run "Where does it still feel slow or confusing?" was taken as an edit. A polite request ("Can you add captions?") stays an edit.

## October 12, 2026 — The agent's edit appears on the timeline as it works, as CapCut-style blocks

- While the agent works, the timeline and the player show its unpublished draft (the workspace.draft events): blocks it adds come in one after another, moved and trimmed ones glide, removed ones fade out, and "Editing live" shows beside the zoom. The player plays the draft whenever everything in it already exists; scenes built only on publish show on the timeline first. A half-written project.json keeps the last good draft on screen; publishing makes the draft the edit.
- Every part of the edit is a block on a track of its kind, top to bottom as in CapCut: Effects (punch zoom, slow push, shake), Filters (a grade over a stretch, and a clip's own grade shown over that clip), Text, Captions, Overlays (motion graphics the agent wrote, named after the scene, and overlay media), the main track, Sound effects and Music. Only tracks with something on them show, plus one empty overlay and one empty audio row to drag onto for a new track.
- The old read-only timeline and its styles are removed.

## October 12, 2026 — Export cannot fill the disk

- Each graphics layer the browser renders (ProRes, about 41 MB a second at 1080p30 with transparency) is deleted as soon as the run that uses it is encoded, instead of when the whole export ends; at most one per concurrent run exists at a time.
- Before rendering, export estimates its peak space (the largest concurrent layers, the encoded runs and the joined output, plus a margin) and stops with "Export needs about N GB free on C:; M GB is free." when the drive is short.
- A full drive is not retried in the browser, which needs more space still; any other native failure is, and if that fails too its message carries the first error (the browser's "out of memory" no longer hides the cause).
- The layer format stays ProRes 4444: a smaller format with transparency (VP9) is far slower to encode, and deleting layers as they are used already bounds the space.
- Measured on the October 11 long-form edit (11:18, 12 chapter cards and overlays): exported in 574 s with a peak of 0.56 GB of work files.

## October 12, 2026 — Commands run in a POSIX shell

- The agent writes bash: `;` between commands, `head`, `\"` inside a `node -e` one-liner. Under cmd.exe those broke silently — `node -e "…"; type x | findstr …` piped node's output into findstr and came back empty, and `head` did not exist.
- Commands now run in BusyBox's sh (busybox-w32 FRP-6075, Unicode build, pinned by its published SHA-256, GPLv2, source linked in notices/busybox), on the user's computer and in the container alike. It brings POSIX quoting and the Unix tools (ls, cat, head, tail, grep, sed, awk, find, wc, xargs); Node, npm, Python, pip and ffmpeg run from it as before.
- Inside the AppContainer BusyBox cannot exec a program in its place (it exits at once and the job ends the program), so every command gets a final `exit $?`: the shell waits and passes on the exit code. An explicit `exec` in a command still fails there.
- A command that runs to its end is a result whatever its exit code, as in a terminal: the agent reads the exit code and output, nothing is marked failed or counted toward repeated failures. Only a stop, a timeout or a crash (a negative exit code) is an error.
- check_outputs with nothing to check answers with an empty list and a note instead of an error, and publishing a non-scene output outside output/ names the output, its kind and path, and both fixes (move it under output/, or declare a live scene as kind "scene").
- The creation runtime was restaged and passed qualification, with a new check for quoting, pipes and the Unix tools.

## October 12, 2026 — The agent sidebar follows Cursor

- A quiet header holds Chat and Media as text tabs and version history as an icon; the "Figjam" name row above each answer is gone.
- The user's message is a bubble on the right. The agent's notes are plain text; each step is one grey line with an icon for its kind (reading, searching, writing, running, publishing, looking); the live step shimmers, a failed one is red.
- A finished request folds into one line, "Worked for 49s · 11 steps" (or "Stopped after …"), above its answer; it opens to the full stream. A request that ended without an answer stays open. Its changes follow as small pills ("+7 clips", "− transition").
- The composer is one box: the timeline selection and attachments as small tiles inside it, the text, then + · mode · model and a round send button. Mode and model are plain text menus (Edit, Plan, Ask; Opus, Sonnet, Haiku). The run monitor and to-dos sit on top of the box like a tab, and "jump to latest" is a small round button on the chat's bottom edge.
- The sidebar uses the system UI font (Segoe UI); the rest of the app is unchanged.
- Timeline: a spare row for a new track keeps one height and only lights up during a drag; opening it moved every track under the cursor, so drops landed on the wrong row.
- After a stop, a message that ends with "continue" (after the feedback it carries) carries on with the stopped request, as one that starts with it already did.

## October 12, 2026 — Web search without the server sandbox

- A request failed with "code_execution tool use … was found without a corresponding code_execution_tool_result block". The 20260209 web search brings Anthropic's own code sandbox along (to filter results), and the agent took it for its workspace: it wrote its project.json edit there, next to an ordinary tool call. That code never ran, and the call without a result made the API reject the conversation.
- Web search uses the 20250305 version on every model, which has no sandbox; filtering results costs some input tokens instead.
- A server tool call left without its result is dropped from the saved reply (and from saved conversations when they resume), except in a paused turn, which is sent back as it is so the server can finish it.

## October 12, 2026 — Home, media, and no settings page

- Home is one greeting, "What do you want to create?", one box to start an edit (Add media, round send), four idea chips that fill the box, and recent projects as cards that lift on hover ("Edited today", length, an open arrow). The mark is the fig from usefigjam.com and the wordmark says figjam. The top of the page matches the window-control strip.
- The settings page and its buttons (home and editor header) are gone. Computer file access lives in the composer's mode menu; the local runtime status and the optional speech-model download had no other use.
- Media is a bin like CapCut's: search and Import, kind toggles with counts (All, Video, Audio, Images, Made by Figjam), 16:9 pictures with their length (tenths under a second), a muted preview on hover, Figjam's scenes as purple graphic tiles and audio as green waveform tiles. Only states that need attention show (preparing, transcribing, a failure to retry, a missing source to relink). Clicking selects for the next message with a sticky "N selected · Clear" bar; files dropped from the computer are imported.

## October 12, 2026 — Keyframes, and only Export renders

- Asked for "CapCut-style keyframes" panning up a pyramid, the agent baked each camera move into a new video with ffmpeg (a per-pixel blend over the whole clip took over ten minutes and hit the command limit twice) and swapped it in for the footage. The timeline had no way to say "zoom and pan over time", and the instructions sent anything the timeline could not express to processed media.
- Clips and attached items take `keyframes`: `sec` on the source clock (so trims, splits and speed changes keep them on their footage), any of scale, x/y (where the picture's centre sits), rotation, opacity, exposure, contrast, saturation and temperature, and an easing (linear, ease in/out, hold) for the move into each one. Each property moves between the keyframes that set it and holds outside them. The player draws them live; Export draws the same values in the browser renderer (ffmpeg's native path hands keyframed pieces over).
- Keyframes are white diamonds on their block: press one to jump there, drag to move it, Delete removes it.
- The agent is told camera moves are keyframes, other visuals are scenes, and processed media is never the edit itself. Commands that render scenes or the composition (the Remotion CLI's render or still, or the renderer API in a script the command runs) are refused before they start.
- Same day: scores are mastered to about -9 LUFS (one came out at -31 LUFS, inaudible under the music gain and ducking); resuming a conversation repaired for an unanswered server call starts a new journal scope instead of failing; the timeline says why it does not respond while Figjam is editing.

## October 13, 2026 — Motion graphics stay, on the one engine; plans are answered like Codex

- Phase 5 had removed coded scenes from v1. The user reversed it: the agent keeps writing Remotion, drawings and anything else as code, unrestricted. The revert brought the agent's instructions back; the new engine now shows scenes too.
- Preview: a scene is a layer in the frame model. Its own sandboxed document (dream-engine:// for engine scenes, the file for legacy HTML scenes) is placed, scaled and cropped where the frame model puts it and told which frame to draw. Whatever lies under the first scene is drawn on the engine's canvas below it; whatever lies over it (titles, captions, overlays) on a transparent canvas above. A scene that fails shows its error over the picture and the agent sees it next request, as before.
- Export: each scene frame is drawn in a hidden, transparent, off-screen window in the main process over the same frame protocol, captured with its alpha and composited by the same compositor as footage. A held frame is drawn once.
- Plans: under a proposed plan, a bar takes what to change (sent as a revision of the saved plan), Accept runs it, and underneath it a model menu (the composer's model by default) picks which model carries it out.
- Project files: writes go through a temporary copy and a rename, which Windows refuses (EPERM) while OneDrive or a reader holds the file. One helper retries for about a second, then writes in place.

## October 13, 2026 — The editor shows the agent working, and clips show their frames

- Model check: every run after the plan card's "Run with" went to the chosen model. The Northern Vietnam vlog was sent with Opus selected, so its plan ran on Opus (about $0.27) and the approved work on Sonnet. Gateway prices match Anthropic's list; about half of a typical run's cost is prompt-cache writes.
- Run clock: an approved plan continues the request it was planned in, so the clock counted from the planning hours earlier. Each run records when it starts (`run_started_at`, sent with `ai.status`); the task bar and the live stream count from it, and "Worked for" leaves out waits over ten minutes.
- While the agent edits, the editor shows it as Codex or Antigravity show an agent using a computer: a blue glow, a status bar with Stop, and Figjam's cursor visiting each block the streamed draft adds, moves or trims. The agent announces its phase (`ai.phase`) as soon as it is set, because full state refreshes reached the window after the first change.
- Timeline blocks draw real frames along the clip (WebCodecs through Mediabunny, from the playback copy, on a time grid per asset), so media the agent made with effects baked in, which has no import thumbnail, shows its picture instead of a colour block.
- Selection tiles each have an X. Right-clicking a block opens split, duplicate, delete and playhead moves (a menu, not a toolbar). The chat and timeline dividers show a handle and go further (chat 20–60%, timeline 15–80%).
- The task window puts tasks first with the cost and models used at their top right, and the latest activity beside them.
- Shortcuts: Ctrl+L or / types in the chat, Shift+Tab in the chat or Ctrl+1/2/3 pick Edit, Plan or Ask, Ctrl+Shift+M steps through the models.

## October 13, 2026 — Black and white, dark mode, Settings

- The whole app is black and white. The renderer's ~350 hard-coded colours were converted by script into a grey scale (`--n0` paper to `--n100` ink) and an ink accent, both redefined for dark mode; the blue agent overlay, errors, greens, timeline block colours and shadows were left as they are. Text on pictures (clip labels over frames, length badges) stays white on a dark scrim in both themes.
- Settings sits at the top right of home and the editor, as in Claude Code: Light / Dark / System (follows the system by default, remembered on this computer) and the keyboard shortcuts. The window's own controls take the page colour (`--chrome`) so the header reads as one strip.
- The home logo is bigger and monochrome. Version history is gone (Undo/Redo stay); change cards replace it. The task bar above the chat box stays small and opens its window only when clicked; the window closes for each new request.
- While the agent edits, the video gets a soft blue wash and a slow light sweep on top of the blue outline, and keeps playing underneath.

## October 13, 2026 — Change cards and the elements list

- Under each reply that edited the timeline, a card lists its changes one by one, as Codex and Claude Code show a diff: added, edited (what was trimmed, sped up, recoloured, retimed) and removed clips, elements and audio, captions, settings, order and tracks. Opening a row shows its details and selects the change on the timeline with the playhead on it, lit up, ready to drag, trim or right-click; Undo reverts that change alone as a new undoable step.
- The diff lives in `@dream/timeline` (`timelineChangeList`) with the operations that undo each change; the service answers `turn_changes` from the version before the request to its last version.
- An Elements tab lists everything on the timeline (clips, transitions, text, motion graphics, overlays, effects, filters, sound effects, music, captions), marks what Figjam added, can show only that, and selects or removes each one.

## October 13, 2026 — Auto is back, and GPT, Gemini and DeepSeek behind the gateway

- Auto is the default model choice again, decided per request from the request's words and route, with no extra model call: Haiku for a small, precise change to an edit that exists; Opus to plan difficult work (the approved plan then runs on what Auto picks for doing it); Sonnet for everything else; a question that changes nothing goes to Gemini 3.8 Flash when its key is set. A model the user picks always wins over Auto.
- The composer lists Claude Opus/Sonnet/Haiku 5.5, GPT-6 Astra, GPT-6.1 Sol, GPT-6 Luna, Gemini 4 Argon, Gemini 3.8 Flash, DeepSeek V4 Pro and DeepSeek V4.1 Flash, with prices from the official pages on October 13, 2026 (DeepSeek at its peak rate; Gemini 4 Argon doubles on December 1). A provider without a key on the gateway is listed but can't be picked.
- The gateway translates requests for these models from Anthropic Messages to OpenAI's Responses API (GPT, `store:false`) or Chat Completions (Gemini's OpenAI-compatible endpoint, DeepSeek) and their streams back into Anthropic events, so streaming, receipts, recovery and accounting are unchanged. Thinking blocks, cache controls and Anthropic's web search tool are left out for them; tool-result images move into the next user turn; DeepSeek V4 Pro gets a note instead of images. Keys: OPENAI_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY; `/providers` says which are set. Token counting for them uses Sonnet's tokenizer.

## October 13, 2026 — The user's choices win, editing taste, a smaller file search

- The editing agent is told first that the user's words are the brief: their explicit choices override every default and suggestion; it never substitutes, skips or waters down part of a request, does the rest of what it can and says exactly what it could not do and why, and offers ideas only after doing what was asked. "When the footage cannot meet a request, say so and offer an alternative" became "do the closest version and say what differs".
- Taste: a short summary in the system prompt (open on the strongest moment, cut what does not move the story, vary rhythm, prefer clean cuts, effects only with a reason, readable text in the safe area, clear speech over ducked music, consistent colour) and a fuller guide at context/editing.md, read before a first cut, a re-edit or a creative choice left open; helpers get the motion-graphics part. The fixed prefix grows by about 250 tokens (cap now 7,500).
- find_media results, which every later call re-reads (a third of the Northern Vietnam vlog's re-read tokens), are grouped by folder as one line a file (name, local capture time, kind, length, resolution, size, the asset it was imported as): about 75% smaller per file.

## October 13, 2026 — Why the vlog's sound effects kept failing

- The Northern Vietnam vlog's request ended with "Repeated attempts could not complete this step" while the agent was fixing each sound-effect error correctly. Four engine causes, all fixed: (1) a sound or score reported only its first problem, so three problems took three publishes; (2) the layer rule said "need unique IDs, envelopes within their duration and placement within the sound" without saying which layer or rule; (3) sound and music files were checked only at publish, not as they were written like scenes; (4) failures were counted per tool call, and publish_project has no input, so three different failed publishes looked like one step failing three times.
- Now every problem comes back at once, one line each with its path, layer, rule and the numbers to fix it (`describeIssues`); writing a .sfx.json or .score.json returns that check; failures are counted per distinct error (`failureSignature`: numbers and ids removed), so a new error after a fix is progress and only the same error three times ends the request; "Source range exceeds" says how long the source is.
- A silent repair of bad sounds (lengthening, renaming, clamping) was tried and dropped: it hides what the agent wrote. Leaving out a layer's id, pan, start, envelope or filter still gets an obvious default.

## October 13, 2026 — Haiku routes Auto; the vlog stuck on a disk-wide search

- Auto now asks Haiku (one low-effort call, a 2K-token allowance, about $0.0002) which model should do each request, or the next part of one (an approved plan, a continuation). It sees the request, the mode, the project's size and the models that can run, each with what it is good at, whether it can see images and its price, and picks the cheapest that will do it well; the keyword rules decide when it cannot answer. Picking Auto always decides again: a model pinned by an earlier pick no longer carries over (the vlog stayed on DeepSeek after the user switched back to Auto).
- The model menu shows each model's strengths and a cost tier ($ to $$$$$) under its name.
- The vlog's run sat on `grep -r ... /` and `find / ...` for ten minutes: the agent was searching the whole computer for the sound-design rules, because the error was vague and context/engine.md listed the layer fields without the required id or the two rules. The reference now gives the full format with defaults, both rules and a valid example.
- Caching per provider: DeepSeek's automatic prefix cache served about 98% of each call's prompt in the vlog run. OpenAI requests now carry a per-request prompt_cache_key so a request's calls share one cache. Gemini caches implicitly; not yet measured.

## October 13, 2026 — A project's second request was invisible; disk, scenes, dark mode, framing

- The window dropped every live event whose request id differed from the one it had on screen, so from a project's second request on it showed no steps ("Planning next moves"), no editing overlay and no Stop until the run ended. Events carry the service's current request, so a new id now means a new request: the window moves to it and refreshes once. Auto's Haiku router also never ran, because the model was pinned before it; it now runs first.
- From the moment a message is sent, the send button is Stop and the editor turns blue; a live card in the editor lists the last steps with the current one's command or file, or "Thinking" between steps.
- Showing a change (a change card, the Elements list) lights it up on the timeline with the playhead on it, without selecting it into the chat.
- Disk: agent-made music keeps only its mix (the separate instrument tracks, unused by the timeline, were 345 MB in the vlog); the playback copy of imported audio is FLAC instead of WAV (about half the size, same samples); files on this computer's own drive are always linked, never copied, whatever the agent asks. Existing projects keep their current files.
- Motion-graphics scenes show a still on their timeline block: one frame per scene revision, drawn in a hidden window that closes straight after.
- Dark mode turned a transparent captions scene into a white sheet over the video: Chromium paints an embedded document whose color scheme differs from the page's with an opaque backdrop. Embedded scene documents keep the default scheme.
- The main track always fills the project's frame: footage of another shape is cropped to cover it (never letterboxed), never zoomed out below the frame, and moves and shake only travel as far as the zoom leaves room.

## October 13, 2026 — Every part of a request gets done; tests stop filling the disk

- A message with several asks (a list, "and then", "also", several sentences) is split by Haiku into parts when an edit request starts; the agent gets the list, and finishing as complete is refused until it reports each part as done, or not_possible with the reason, which is added to its recap. One plain ask is not split (no extra call) and needs no report.
- 6.7 GB of the user's disk was test leftovers: about 7,700 scratch projects and profiles from test runs in the temp folder, none from the app. Both test runners now give each run one temp folder (TEMP/TMP/TMPDIR) and delete it at the end; folders from crashed runs older than an hour are removed by the next run.

## October 13, 2026 — The installed app is 1.6 GB, not 3.1 GB

- Left out of the installed app: ffmpeg-static and ffprobe-static (414 MB, binaries for every platform; the installed app always used staged/media-runtime, and they are now looked up only when running from source), the local analysis runtime staged/ingest (1 GB; only the retired audio_features step ran it), and imageio-ffmpeg's own ffmpeg (84 MB; agent commands set IMAGEIO_FFMPEG_EXE to the app's ffmpeg).
- Kept for now: the headless Chrome and Remotion renderer (about 330 MB) still serve the editable-timeline XML export and the old export code; moving those to the engine would remove them. The bundled Python and Node libraries (about 700 MB) are what the agent's own code uses.

## October 13, 2026 — Auto scores each request, and the score picks the model

- What went wrong in the last two days: a word rule labelled nearly every message "difficult, open-ended", and Auto asked Haiku for "the cheapest model that will do it well" from ten one-line descriptions and only the latest message. "make the caption white" went to DeepSeek Flash (described as the cheapest, though Haiku and GPT Luna cost a third of it) and took 12½ minutes; small talk bounced between DeepSeek, GPT Luna and Haiku; follow-ups like "its still there" or "go" were judged without the conversation.
- Now one Haiku call (triage, with its own reply schema on the gateway) reads the message with the last six messages, a stopped request and the project's size, and returns what it is (edit, answer, plan, continue), a difficulty from 1 to 5 with a rubric drawn from these requests, whether it needs eyes on the footage, whether it still wants a stopped request's asks, and its parts. It replaces the word rules (kept as the fallback), the model-picking call and the separate parts call. Requests without a composer choice (tests, the command line) use the word rules.
- The score picks a tier: an edit of 1 is light (Haiku, GPT-6 Luna, DeepSeek V4.1 Flash, Gemini 3.8 Flash), 2–4 strong (Sonnet, GPT-6.1 Sol, Gemini 4 Argon), 5 frontier (Opus, GPT-6 Astra); a plan of 4–5 is frontier; an answer of 1–2 is light. Within a tier the cheapest listed price among the providers that can run wins, a tie going to Claude. A model the user picks always runs. The score also sets thinking effort (1 low, 2–4 medium, 5 high; Haiku one step higher) unless the user picked one.
- A message after a stop that still wants the stopped request's asks ("aside from that…") carries them into the new request; the vlog's "put the definition on screen" was lost this way.
- The router's own thinking is no longer recorded as reasoning activity. DeepSeek V4 Pro is removed.

## October 13, 2026 — What the agent writes reaches the user and the next request

- Banana: the agent wrote the full ooga-booga script, finishing was refused because nothing had been published, it published an unchanged project, and only its one-line finish summary was saved. The user never saw the script ("i still cant see it"), and the next turns, seeing only that summary, rewrote it from memory and contradicted themselves about having looked at the drawings. 16 no-op publications across the two days came from the same rule.
- A request that changed nothing (the project is still the version it started from and no workspace file changed) now finishes complete without publishing. An edit request that only talks is still nudged, then stopped as blocked; finishing complete with no change takes an explicit finish.
- The saved reply is what the agent wrote: the text that ends its work (sent with finish, or a response with no tool calls), never replaced by a later short line. The finish recap follows it only when the project changed and the recap adds something. finish's summary is described as the reply the user reads (12,000 characters, was 4,000).
- The next request sees the latest reply in full (up to 8,000 characters) and earlier replies up to 2,500 (was 700 each), each longer one saying where to read the rest.
- Limits the model is never shown no longer fail a call: over-long text is shortened and over-long note lists cut, except paths, code, commands, URLs and ids. Part ids are matched on their number ("P1", "part 1", "p1-captions"); a one-part request is never refused for its report. A remembered decision may quote the user with the spelling fixed, as long as nearly every word is theirs.

## October 13, 2026 — Precise edits: the agent looks at its own edit and measures it

- Rough drafts worked; precise requests did not, because the agent edited blind. "make the caption white" was reported done three times while the captions showed dark; a green tint at 10–13 s took four guesses; "doesn't fit 9:16", "weird border" and an empty "VS" were each fixed by reading code. Every reply ended "I haven't watched the result".
- The user chose "player frames, when needed" (this replaces the October 8 rule that chat never draws frames; only Export still renders video). view_media with target preview now returns, for the published edit at the timeline times the agent picks (up to 12, or six over a range): exactly what is on screen at each moment from the engine's own frame description (the clip or item id, where it lands in the frame, opacity, grade, blur, text and colours, bottom to top), the frame as the player's engine draws it, and its measured colours (average and a 3x3 grid of region averages). The on-screen list is exact even when no window can draw.
- The frames come from the editor window: the main process sends frames.request, the window draws them with the compositor the player and Export use (source frames decoded exactly with WebCodecs, scenes through the existing scene capture) and answers through dream:framesResult. The old Remotion still-renderer is no longer used by the app.
- Engine components no longer drop settings silently: FitText takes the text's look directly (color, textShadow, WebkitTextStroke, letterSpacing, textTransform, fontStyle, textDecoration) and any prop FitText or SafeArea does not take comes back as a scene error naming what it does take. The vlog's captions were dark because FitText ignored color.
- Reading a still image the agent's code made: ffmpeg was always called with -ss 0, which skips a still's only frame, so 13 reads of .jpg sheets failed with "Source frame could not be decoded". Stills and time 0 are read without a seek.
- The scene engine's runtime source (packages/scene-engine/src/runtime) was never in git: a broad `runtime/` ignore rule covered it. It is tracked from now on.
