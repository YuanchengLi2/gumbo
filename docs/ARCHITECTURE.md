# Desktop architecture

## Redesign architecture — October 7, 2026

The renderer routes between HomeScreen, AIWorkspace and ManualEditor. useProjectSession owns commands and subscriptions; the Zustand store rejects stale sequenced state and preserves mode-independent project data. ProjectPlayer owns Remotion transport listeners for both editors. AssistantTimeline compares committed stable item identities, suppressing animation on hydration.

Electron main owns ProjectLibrary, FileAccess and FileOperations. ProjectLibrary keeps an atomic projects.json index and cached thumbnails without opening each project database. Native picker grants and the explicit computer grant are recorded in file-access.json. The preload exposes individual typed methods; renderer Node integration remains disabled and IPC requires the main renderer frame.

The project utility process remains the project writer. ProjectBootstrap saves the initial request and imported asset IDs, copies/registers assets with stable request identities, awaits playable derivatives, and dispatches the prompt once. The agent (packages/agent, docs/CODE-ENGINE.md) keeps one conversation per project and stores its activity, the turn start version, file waiting state and its receipts through ProjectDB. Interrupted requests remain resumable.

File tools cross the utility/main boundary using file-client and ProjectService. FileOperations validates permission at execution, journals exact proposals and receipts, checks source/destination preconditions, stages writes/copies, and uses OS Trash. A waiting approval releases the request call and persists in project state; resume reuses the recorded tool call. Declined/failed changes are error receipts, not completion evidence. Media export proposals bind projectId and versionId to avoid rendering a different edit after approval.

The gateway validates an anonymous or existing Supabase identity and activates the appropriate account record. Guest status is read from authenticated identity, not a model/renderer assertion. Credential encryption and refresh remain in Electron main. Provider keys remain server-side.

Dream runs its packaged React interface locally in Electron. The renderer has no Node integration, uses context isolation and Chromium sandboxing, and receives only the application bridge in `src/preload/index.ts`.

## Process and data ownership

| Owner | Implementation | Responsibility |

| --- | --- | --- |

| Electron main | `apps/desktop/src/main/index.ts` | Native dialogs, window lifecycle, account credentials, model management, scoped media protocol, export and sharing |

| Project utility process | `apps/project-service/src/main.ts` | Sole application project writer; serialized commands, import scheduling, AI tool execution, version transactions |

| React renderer | `apps/desktop/src/renderer/App.tsx` | Editor, transport, timeline selection, approvals, conversations, library and dialogs |

| Analysis child | `apps/ingest-worker/src/dream_ingest/main.py` | Offline bounded stage requests; structured responses; no direct database writes |

| Export | `apps/desktop/src/renderer/engine/export.ts`, `apps/desktop/src/main/engine-export.ts` | One engine export for the Export button and the agent (`agent-export.ts`): the window draws and encodes with the shared WebGL compositor from WebCodecs-decoded frames; main mixes the sound (`export-audio.ts`), writes and joins the file |

| Supabase Edge | `supabase/functions/dream-gateway/index.ts` | Authenticated provider access, invitation enforcement, usage and finished-export sharing |

The cloud is not the project database. Original files remain linked or explicitly copied into a project. AI receives selected indexed text and rendered review images. Structural/build turns render a bounded frame packet locally; the gateway receives the resulting JPEGs and timing summaries, never original media files. Semantic source-shot logging remains unfinished. Explicit Share uploads the chosen completed MP4 only.

## Editing transaction

`ProjectDB.apply` checks request identity before the expected head, applies operations to a clone, snaps and validates the candidate, then commits the snapshot, operation log, action history and event in one SQLite transaction. Only the committed result is published. A repeated AI tool request returns its saved result. An unrelated newer head is rejected rather than silently overwritten.

The AI editor persists its provider response before tool execution and checkpoints each result. Tool mutation IDs are derived from the turn and provider tool-call ID. A crash between commit and checkpoint therefore reuses the committed result on resume. Cancellation stops future calls and leaves committed versions intact.

## Runtime packaging

`scripts/build-remotion.ts` builds the same composition used by preview. `scripts/prepare-package.ts` stages that bundle, the headless rendering browser, FFmpeg/ffprobe, Remotion compositor and public cloud configuration. Native binaries are outside ASAR. The editor does not build JavaScript or download a browser on first export.

The Python environment is pinned by `apps/ingest-worker/uv.lock`; its PyInstaller recipe is `build/runtime.spec`. Freezing the runtime and verifying it on a clean installation are distinct gates. Model manifests, verified downloads and redistribution terms are required separately from runtime binaries.

## Current boundaries still to complete

Broad generated-code quality, vector retrieval, all analysis models, sample-accurate final audio assembly, streamed provider inference, representative multi-round review quality, update installation, signed distribution and Mac journeys are not established by the current Windows smoke test.

## Visual review boundary

The utility process selects frames from a saved version and asks the main process to render them through a validated internal request. The main process snapshots its asset map, runs the trusted composition in the packaged rendering browser, and returns checksum-tagged images. Review packets use at most 16 frames and explicitly report incomplete visual coverage and the absence of an audio listening test. The reviewer returns schema-validated findings tied to supplied item IDs and frames. One repair pass may run before a second review; both passes share the turn budget and undo action. Cancellation aborts rendering and preserves committed edits.

Video render frames use Remotion OffthreadVideo instead of browser seek readiness. Export uses PNG intermediate frames and explicit BT.709 output. Untagged source color interpretation remains a compatibility area; the synthetic fidelity fixture now explicitly declares its actual matrix.

## One creative execution engine

The project service constructs one `EditingEngine`, and the director receives only its shared port. Timeline operations, original animations, arrangements, sound design and revisions all execute under the same project/version/turn identity. A single `CreationJobs` queue owns heavy creative work, cancellation, request receipts, progress and recovery. Media-specific adapters translate a creative document into validated assets and placement operations; they do not own separate job loops or chat sessions. Automatic score-binding regeneration also enters this queue.

Sonnet can choose any combination of editing and creation tools in one turn. Opus direction/review depends on the request's route and evidence needs. Distinct tool schemas describe different materials, while one local engine executes them. No user upload or manual Add action is needed after successful chat creation. All committed batches retain the same turn identity for Undo.

TSX parameter validation and transpilation run in a bounded worker. Generated code executes only in a fresh, sandboxed offscreen Chromium renderer without a preload, account state, editor IPC or external network. Selected media are served by scoped asset IDs. The main process captures immutable image frames at a fixed output scale; the trusted preview/export composition reads those frames. Sound synthesis runs in its own worker, with the same queue supervising its lifetime. These runtime boundaries separate privileges and workloads, not product workflows.

