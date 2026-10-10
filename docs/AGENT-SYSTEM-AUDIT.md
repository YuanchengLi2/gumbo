# Agent-system audit — October 9, 2026

Scope: the active `code-director`/`code-agent` editing path, provider context, saved execution history, tool receipts, project memory, workspace publication, interruption/resume, and the editing UI. Historical director tests are identified separately. This is a record of concrete defects and verification, not a guarantee that every future generated edit will succeed.

## Findings and repairs

| Area | Defect | Implemented repair | Main files |
|---|---|---|---|
| Context ownership | A separate 100 KB editing-loop cutoff discarded completed reads while the provider still had capacity. | Keep the full durable history; let the request budget manager construct the provider view. | `packages/orchestrator/src/code-agent.ts`, `context-budget.ts` |
| Image accounting | Base64 transport length triggered conversation compaction. | Account for images by estimated model cost while preserving the actual pixels. | `packages/orchestrator/src/conversation.ts` |
| Working facts | Compaction retained short excerpts instead of full transcripts and file reads. | Preserve the latest exact successful source results separately from older dialogue, deduplicating repeated reads. | `packages/orchestrator/src/working-context.ts`, `conversation.ts` |
| Source freshness | Remembered reads survived writes; a shorter later transcript page could displace a complete earlier read. | Invalidate affected files on mutations, invalidate changed revisions, and retain the more complete result for the same transcript revision. | `working-context.ts`, `apps/project-service/src/code-workspace.ts` |
| Memory provenance | JSON resembling an internal memory document could be mistaken for trusted working context. | Only internally marked working-context messages populate retained source facts. User/media text remains data. | `working-context.ts` |
| Archive retrieval | Summaries advertised archived results without giving the current agent an address it could read. | Include a complete receipt path usable by `read_file` with receipt scope. | `conversation.ts` |
| Durable conversation | Mutating an already-saved message could silently leave memory and the execution journal inconsistent. | Freeze saved message trees and detect replaced/shrunk prefixes. Intentional legacy migrations use a new journal scope. | `packages/project-db/src/execution-store.ts`, `legacy-director.ts` |
| Preferences | The current editor exposed no tool for the existing durable decision store. | Expose verified preference recording, requiring a verbatim instruction and its actual user-message ID. | `code-tools.ts`, `code-agent.ts`, `code-prompt.ts`, `project-memory.ts` |
| Read-only phases | Questions and consultations could rename a project or overwrite the main edit checklist. | Exclude these mutations from read-only tool sets and validate their exclusion at execution. | `code-tools.ts` |
| Retry diagnosis | Cosmetic progress text and changing process IDs prevented repeated failures from being recognized. | Use a stable operation identity, reset after success, and diagnose consecutive failures of the same operation. | `tool-identity.ts`, `code-agent.ts` |
| Tool replay | A reused call ID could return a receipt belonging to different instructions. | Bind saved receipts to semantic operation identities and reject mismatches before another effect. Reject malformed/duplicate IDs within provider responses. | `code-agent.ts`, `inference.ts` |
| Completion | An already-satisfied edit could fail to finish because publication produced no new version. | Return a validated, explicitly unchanged publication receipt without manufacturing an edit. | `code-workspace.ts` |
| Task state | Explicit completion could leave the main task checklist pending. | Apply the same completion requirements to a finish call and a natural final response. | `code-agent.ts` |
| Timeline/source consistency | Direct timeline edits could leave the editable project document on an older version. | Synchronize unchanged documents, preserve unpublished drafts, and restore the database timeline with each source snapshot. | `packages/project-db/src/workspace-store.ts`, `code-workspace.ts` |
| Search freshness | A file that became binary or too large could retain old searchable text. | Remove its stale search entry. | `packages/project-db/src/workspace-index.ts` |
| Provider budgets | A recovered larger output allowance was not reserved when validating the input count. | Reserve the effective output capacity before counting input. Include inference-policy changes in signed-context binding. | `inference.ts`, `provider-session.ts` |
| Scene publication | Invalid inline JavaScript could be published before the live player discovered a syntax error. | Compile-check inline scripts without executing scene code or rendering frames. | `apps/project-service/src/scene-source.ts`, `code-publication.ts` |
| Project identity | Equivalent Windows folder spellings could produce duplicate recent-project entries. | Compare normalized folder identities and retain the latest entry. | `apps/desktop/src/main/project-library.ts` |
| Test coverage | Several legacy tests exercised the new editor through obsolete tool contracts; one network fixture omitted token counting. | Route historical fixtures explicitly to the legacy adapter, add current-agent workflow coverage, and complete the HTTP fixture. | `tests/integration/*` |

## Verification

- TypeScript: passed.
- Focused active-agent and compatibility suite: 70 checks passed across 18 files.
- Covered: exact source retention through compaction, file invalidation, quoted preference recall after reopening, no-change completion, changed call-ID rejection, interruption after an approved step, immutable journal recovery, source-document rebasing, scene syntax validation, provider retry/stream recovery, and duplicate mutation prevention.
- The taller composer and streamed public editing updates were verified in a packaged-app check earlier in this conversation; they remain included.
- Updated packaged build and live retry: pending at the time this record was first written. Update this section with the observed outcome before declaring the live problem resolved.

## Boundaries

Local tests do not establish subjective video quality or prove every model decision. Scene syntax checks do not execute arbitrary scene code in the host. Preview still executes live; frame rendering and encoding remain part of Export.

## Second pass — October 9, 2026: Opus-led engine

Scope: model roles, routing, inference transport, context budget and compaction, caching, the agent loop, workspace publication and the test suite. Full design: `docs/CODE-ENGINE.md`.

| Area | Defect | Repair | Main files |
|---|---|---|---|
| Model roles | Haiku wrote every edit; Opus only produced a brief in a separate read-only session, re-reading files and frames that Haiku then re-read. Docs claimed Sonnet executed. | Haiku solo for simple edits and questions; Opus lead with `delegate` to Haiku workers for everything else; parallel workers with enforced disjoint scopes. | `code-director.ts`, `code-agent.ts`, `code-tools.ts`, `code-prompt.ts`, `config` |
| Output limits | 4K-8K `max_tokens` (thinking included); execution truncation never received more room and told the model to write a whole scene in under 2,000 characters. | 16K/32K allowances, automatic doubling to 64K for every purpose, then a split-the-work instruction; three truncations end the step. | `intelligence.ts`, `inference.ts`, `code-agent.ts` |
| Context budget | Compaction began at 32K tokens (48K with images) against a 1M window; a frame overview used about half of it. | 90K Haiku / 180K Opus targets; compaction only after a measured overrun; count failures fall back to the estimate. | `config`, `context-budget.ts`, `inference.ts` |
| Caching and thinking | Compaction was recomputed every call with a moving boundary, so each request rewrote history: full cache misses and dropped thinking blocks on every step after the threshold. | Sticky compaction plan (stored prefix, append-only afterwards); bounded retained reads; effort fixed per role; one-hour tool/system cache; identical worker system prompt. | `conversation.ts`, `working-context.ts`, `code-director.ts`, gateway `inference-policy.ts` |
| Loop termination | No step limit; endless "continue" nudges; stuck detection required byte-identical inputs. | Step limits, two nudges, coarse failure grouping by tool and target. | `code-agent.ts` |
| Completion | `run_command` published, invalidating the earlier receipt; `finish` was rejected for evidence and task-list bookkeeping, and each rejection could start an Opus diagnosis. | Commands never publish; completion requires a publication of the current head, evidence and tasks reconciled automatically. | `code-workspace.ts`, `code-agent.ts` |
| Scene libraries | Publication rejected `<script src>` and nothing inlined bundles, so libraries had to pass through model output. | Publication inlines local scripts and stylesheets; external URLs are rejected. | `scene-source.ts`, `code-publication.ts`, `live-scene-guide.ts` |
| Transport | 150s client and 120s gateway total timeouts killed long generations; unconfirmed outcomes always required a manual resume; one transient retry. | Idle watchdog; cancel-and-retry of unconfirmed outcomes (three retries, backoff); gateway default wall time 350s and 64K cap (requires deployment). | `inference.ts`, gateway `ai.ts`, `index.ts` |
| Routing | A malformed or failed classification failed the request. | Falls back to the local heuristic. | `code-director.ts` |
| Follow-up context | Resume with feedback started a new turn without the interrupted conversation; context advertised tools that no longer exist. | Feedback continues the same turn (lead/solo only); six recent messages; current tool names. | `code-director.ts`, `code-agent.ts`, `context.ts` |
| Activity stream | Unchanged drafting updates re-serialized the turn's activity log every 150ms. | Identical updates are skipped. | `run-stream.ts` |
| Storage | Migrations failed when re-applied over existing columns or tables. | Idempotent migration steps. | `project-db/src/migrate.ts` |
| Pricing | Sonnet 5.5 cache reads priced at half their rate; one-hour cache writes unpriced. | Corrected. | gateway `inference-policy.ts` |

Verification: TypeScript passes; the full suite passes (62 files, 174 tests), including new coverage in `tests/integration/agent-engine.test.ts` for parallel delegation, scope enforcement, script inlining, step and nudge limits, sticky compaction, truncation escalation, routing fallback and same-turn resume. Nine legacy-behavior test files now import `legacy-director.ts` explicitly. Not yet verified: live provider runs of the lead/worker flow, and the gateway deployment.

Follow-up repairs, same day:

| Area | Defect | Repair | Main files |
|---|---|---|---|
| Layout robustness | A live run shipped a subtitle colliding with the title, and nothing may render during chat. | Authoring rules: text sized relative to the frame and fitted to its box, safe margins, flex/grid layout; the lead reviews scene source for these. (A brief rendered-stills check was removed: published code appears live and only Export renders.) | `code-prompt.ts`, `live-scene-guide.ts` |
| Computer files | The October 8 engine had no way to propose computer-file changes, although the UI and approval flow still existed. | `propose_file_changes` with pause, approval, resume and change summary. | `code-tools.ts`, `code-workspace.ts`, `code-director.ts` |
| Attached media | The request's attached assets and selection never reached the agent's context. | Included in the first message's project context. | `code-workspace.ts` |
| Refusals | No fallback when an Opus request is declined. | Server-side `fallbacks: "default"` with self-healing; declined-attempt blocks are never executed or echoed. | gateway `ai.ts`, `inference.ts` |
| Desktop journeys | Four packaged journeys drove legacy tools the production engine no longer has; one asserted a renamed button. | Ported to `tests/fixtures/code-gateway.ts`; full desktop suite 8 passed, 1 skipped. `tests/fixtures/review-gateway.ts` is now unused. | `tests/desktop/*` |

Isolation and completion repairs, same day:

| Area | Defect | Repair | Main files |
|---|---|---|---|
| Worker isolation | File tools enforced a worker's write scope, but `run_command` ran against the whole shared workspace, so a worker's command could overwrite or delete another worker's files or `project.json`. | Commands run in the same serialized queue as writes and publication. A scoped worker's command is snapshotted before and after; changes outside its scope (including deletions and `project.json` for non-publishing workers) are restored and the command is reported as failed with the reverted paths. | `apps/project-service/src/code-workspace.ts`, `code-agent.ts`, `packages/contracts/src/workspace.ts` |
| Completion | One publication counted as completion evidence even after later unpublished edits, and reaching the step limit with an earlier publication could conclude as complete. | Completion requires the authored workspace to match the published head's source snapshot exactly (content hashes, no database writes); `finish` names the unpublished files. The step limit always concludes as blocked. | `code-workspace.ts` (`unpublishedChanges`), `code-agent.ts` |

Verification: TypeScript passes; `tests/integration/agent-engine.test.ts` 14/14, including out-of-scope overwrite, folder deletion and `project.json` revert, and unpublished-change/step-limit completion. Full suite: 177/179 in a parallel run; the two failures were timeouts in `long-workflow` and `engine-scale` (legacy director and storage scale; neither uses the code agent), which pass when run alone in 34s and 57s.

Packaged verification: `apps/desktop/out/engine-oct9` (built 19:03) predates these repairs and must not be used. Packaging into `apps/desktop/out/Dream-win32-x64` failed with `EPERM` on the final rename inside OneDrive, so the current package was built to `C:\Users\yuanc\dream-build\engine-oct9-final` (`DREAM_PACKAGE_DIR`) and tested via `DREAM_PACKAGE_EXECUTABLE`; its `app.asar` contains the scope-revert, unpublished-change and step-limit code. Desktop suite on that package: 8 passed, 1 skipped (live provider). Three test corrections: `editor-flow` now expects preview metadata instead of rendered stills (chat rendering was removed by design); `manual-editor` honors `DREAM_PACKAGE_EXECUTABLE`; `planning` waits up to 60s for the approved two-step lead/worker workflow, which completes in about 11s (the 5s default was too short, not a hang).

Gateway deployment: `dream-gateway` version 21 deployed to `qewguvfkkwvdoqptiljd` at 20:26 on October 9 (350s wall time, 64K output cap, one-hour tool/system cache, corrected pricing, Opus/Sonnet refusal fallback). No `DREAM_AI_MAX_WALL_MS` override is set. No new migrations were required. Previous source is in `artifacts/gateway-deployed-backup-2026-10-09`. The packaged app from `C:\Users\yuanc\dream-build\engine-oct9-final` was launched for a live test.
