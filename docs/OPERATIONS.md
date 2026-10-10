# Development, recovery and distribution

## Guest desktop and file permissions — October 7, 2026

Deploy 202610070002_guest_access.sql and the dream-gateway function before shipping the redesigned desktop. Enable anonymous sign-ins in Supabase Auth. Existing daily account budgets and suspension behavior remain active. Do not place provider/service-role credentials in desktop configuration. A fresh guest signup and /account call must succeed; the live edit/export smoke provides the separate provider proof.

New projects default to Documents/Dream/Projects/<stable-id>. Development/acceptance launchers may set DREAM_DOCUMENTS_DIRECTORY to isolate generated projects. Project-library entries cache metadata and thumbnails; opening an older recent project refreshes its summary. Existing linked originals are not migrated automatically.

Computer access can be revoked in Settings. Native picker grants cover selected files separately. OS permission errors must be resolved through the operating system; the app does not elevate or bypass protected folders. Search work is bounded, cancellable and on demand.

File changes are journaled outside timeline undo. A process interruption during a file mutation is reported for review rather than blindly replayed. Overwritten text/media has an installation-local recovery copy. Trash restores are handled through the OS. No permanent-delete fallback is allowed. For a cross-volume move where source Trash fails, the destination copy can exist while the source remains; the receipt reports that partial outcome.

Build the shared composition before packaging. Use the affected integration tests and Windows desktop journeys; avoid running unrelated benchmarks for UI changes. macOS permission/signing behavior needs a Mac acceptance run.

## Reproducible local build

Use Node 24, pnpm 10.14.0 and the lockfile. Install with `pnpm install --frozen-lockfile`. Build the shared composition, stage the platform runtime and public configuration, then run `pnpm package`. Only run the maker against a package built from the intended source revision. `electron-forge make --from-package` deliberately reuses an existing package and does not include newer source edits.

For Python, run `uv sync --locked` in `apps/ingest-worker`, then `uv run pyinstaller --noconfirm runtime.spec` in its `build` folder. Stage the resulting directory as `resources/staged/ingest`; test the frozen executable before packaging it. Windows TorchCodec requires the bundled FFmpeg shared-library directory supplied by the main process, not a user's PATH installation.

## Secrets and cloud

`.env.local`, `.secrets/`, model caches and staged binaries are ignored. Desktop public configuration contains only the Supabase URL and anon key. The Anthropic credential belongs only in Supabase function secrets. Do not log routine provider prompts, source transcripts or account tokens.

Apply checked-in Supabase migrations before deploying the gateway. Validate account invitation activation, usage accounting and storage policies after deployment. An HTTP health result proves service configuration, not authenticated editing or sharing.

## Recovery

- Preserve the project folder before manual repair. Do not copy a live SQLite database without its backup/checkpoint API.

- An interrupted edit keeps committed batches. Use Resume to continue its saved tool response; do not manufacture a new instruction to replay the entire turn.

- An interrupted derived file is disposable. Retry the affected stage, retaining source files and completed stage results.

- Missing externally linked originals require relinking or collection. Do not delete originals as part of cache cleanup.

- If a lock reports a live writer, close that writer. Never remove its lock just to force a second database writer.

## Release gates

Current Windows builds are development artifacts. Signing credentials, Mac build hardware, notarization, approved model-distribution terms, a production companion URL, account/email configuration and full acceptance evidence are required before beta distribution. Use the verification ledger to distinguish unit checks, packaged checks, installed checks and human quality evaluation.

## Focused AI review checks

Run `pnpm exec tsx scripts/smoke-review.ts` to render local evidence and compare the opening against the tagged fixture. `pnpm exec tsx scripts/smoke-ai.ts --review` exercises a real authenticated edit/review; `--build` includes outline approval. These cloud checks incur provider usage, create a temporary invited test identity in the dedicated project, and remove it in `finally`. Use them when editing intelligence changes, not for routine styling. Evidence files under `artifacts/` exclude authentication credentials. The packaged editor test uses a local provider protocol fixture while rendering actual local frames; do not confuse that with real provider evaluation.

Rendered evidence caches live in application data, keyed by composition bundle contents and version/index inputs. Cached JPEGs are validated against their hashes and can be discarded; the project remains authoritative. Review reports retain sampled-frame hashes, reviewed version IDs and unresolved findings. A second review can report remaining problems without claiming they were repaired.

## Original animation checks and recovery

`pnpm exec tsx scripts/smoke-sandbox.ts` exercises the packaged browser runtime through actual Electron: selected-video seek timing, alpha, fixed pixel dimensions on a scaled display, frame hashes/cache reuse, runtime failures, network denial and runaway cancellation. It does not use a cloud model. `pnpm exec tsx scripts/smoke-ai.ts --visual` additionally exercises real authenticated code authorship, automatic placement and composited-frame inspection; it incurs provider usage and cleans its temporary identity. Reserve it for tool/prompt changes. The packaged editor journey uses a local inference fixture but real compilation, sandbox capture, project persistence and MP4 rendering.

The visual recipe cache is disposable and lives under application data. A successful render has a content-addressed frame directory and a small recipe index. A pixel revision hashes both its recipe and ordered frame hashes. Copying individual verified files before publishing the index avoids Windows/OneDrive directory-rename failures; interrupted unpublished directories are not completed cache entries.

Project-owned `Media/Generated/<revision>/` frames and their manifest are part of saved edit versions. Do not delete them as application-cache cleanup. Collection copies the frame assets so existing visual revisions remain playable after the source project moves. Resume unfinished visual jobs through their existing request IDs; do not rerun completed timeline placement under a new request ID. A concurrent manual edit leaves a newly rendered visual saved in the library and returns a placement warning instead of replacing the newer head.

Custom visuals are rendered by a sandboxed offscreen Chromium window with scale 1 and an exact composition rectangle. Never set the application's global display scale to compensate for export dimensions, and never enable Node or attach the editor preload to this renderer. Compile and validate only in the bounded worker. Preview and export read immutable captured frames, not executable generated source.

## Planned and interrupted workflows

Use Plan first in the existing composer, or request a plan in chat. Planning reads project context without changing the timeline. The approval card can be edited; approval must still match the version from which the plan was proposed. A stale approval requires a refreshed plan. Repeated approval IDs do not start another execution.

Approved workflows store their step cursor and completed version receipts. Resume continues the interrupted step, reuses saved tool responses and preserves earlier committed mutations. One Undo groups the turn's steps. A tool-limit checkpoint is interrupted work, not successful completion; explicit Resume grants the next execution allowance. Do not reset checkpoints or start the entire brief again to recover a connection failure.

Director consultations are persisted reads keyed by turn, step and tool identity. Routine calls retain low effort; diagnosed difficult decisions use the gateway's bounded consultation policy. `pnpm exec tsx scripts/smoke-ai.ts --workflow` verifies a real plan/approval/editor-director/review workflow and records actual usage. `tests/desktop/planning.spec.ts` separately verifies the packaged composer and approval UI. Use the documented calibration results as functional proof only; they do not replace long-task or human quality evaluation.

A paused plan stays on its unfinished step. Correct the missing condition and choose Resume, or type the needed clarification in the same composer with Continue saved request checked. Uncheck it to start a separate request. Plan first resets after sending a planning request. A blocked report is not a completed step, even when some changes were committed. The restored checklist distinguishes completed receipts, the paused current step and queued later steps. Do not delete completed versions to unblock the workflow.

Structured completion requires successful tool receipts exposed in result content. Their IDs are internal evidence, not information users should need to provide. Missing or fabricated evidence must be corrected by the editor; two text-only responses pause at a saved checkpoint. Provider output alone is not proof of creative quality.

## Inference receipts and compacted context

A confirmed temporary provider failure gets one automatic retry with bounded backoff. Account quota exhaustion, duplicate IDs and configuration failures are not transient. If a connection closes without a received outcome, the app preserves the edit and waits for explicit Resume; the provider may already have processed the request. A completed response saved locally is reused after a crash without another provider call. Never clear inference receipts to force recovery.

The gateway retains reserved allowance for uncertain requests instead of treating unknown usage as free. Provider request IDs and error/status metadata are available in `dream_usage`; prompts and footage are not application logs. Reconcile uncertain usage with provider evidence before adjusting allowance records.

Compaction changes only the conversation sent to the provider. Original local checkpoints and archived tool results remain in the project database; history tools are scoped to the active turn. Older image payloads are omitted from compacted requests, so ask for fresh rendered evidence when current visual verification matters. Tool excerpts are explicitly incomplete. A project migrated to SQLite schema 3 requires this build or newer.

`pnpm exec tsx scripts/smoke-ai.ts --recovery` checks real inference, cached response reuse, gateway duplicate detection and quota classification using a temporary invited account. It incurs provider usage and removes the account after the test.

The project service obtains credentials through a dedicated main-process request before inference, including retry attempts. The account manager refreshes expiring sessions and stores refresh tokens with OS encryption. Do not reintroduce a token snapshot tied only to command submission; a long-running turn can outlive that token. Credential request cancellation does not discard committed edits.

### Streaming and large creative definitions

The AI route accepts `stream: true` and returns provider SSE plus a final `dream_request` record. Clients must assemble a complete message before executing tools. Partial JSON and a `max_tokens` response are never executable work. `inference-attempt:` receipts retain each paid truncated attempt and its usage. `output_capacity:<turn>:<model>` remembers a successful capacity increase for subsequent requests in that turn. Automatic capacity increases are separate from the one allowed confirmed-transient-failure retry.

The output ceiling is 32,768 tokens, with a 135-second provider deadline. Larger definitions currently need smaller reusable parts; a streamed connection is not an unlimited request. A connection failure after streaming starts is recorded as uncertain and preserves the budget reservation, since partial work may have incurred provider cost. Explicit Resume requests a new response while all completed local operations remain protected by their durable request identities. Signed thinking blocks are passed back unchanged and are never rendered in the chat UI.

