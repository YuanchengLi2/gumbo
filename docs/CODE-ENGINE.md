# Code creation engine

This document describes the production engine in `packages/orchestrator/src/code-director.ts` and `code-agent.ts` as of October 9, 2026. `legacy-director.ts` is retained only for historical tests and older serialized projects; it is not the production director.

## Who does the work

| Request | Model | Role |
|---|---|---|
| Simple exact change (trim, split, mute, caption fix, a setting, a small scene tweak) | Haiku 5.5 | **solo**: inspects, edits and publishes alone. It can call `consult_director` (an Opus read-only consultation) when stuck or when the task turns out to need direction, and repeated failures of the same step request that consultation automatically. |
| Question | Haiku 5.5, or Opus 5.5 when routed `opus` | **readonly**: answers directly. |
| Anything creative, multi-part or open-ended, and approved plans (all steps in one continuing conversation) | Opus 5.5 | **lead**: inspects, decides, plans tasks, delegates, verifies and finishes. It cannot write files or run commands; it may call publish_project to publish what workers prepared or to confirm that nothing needs to change. |
| Work assigned by the lead | Haiku 5.5 | **worker**: one isolated conversation per task, starting from the lead's brief. |
| Explicit planning | Opus 5.5 | **readonly** planner returning an editable plan. |

Routing (`classify` in `code-director.ts`): exact local instructions skip the classifier; everything else is classified by Haiku with a provider JSON schema. A failed or malformed classification falls back to the local heuristic instead of failing the request. `intelligence: haiku` means solo, `opus` means lead.

## Delegation

The lead's `delegate` tool takes one to four tasks `{id,title,brief,writes,publish}`. A single task may set `publish:true`: it owns `project.json` and publishes. More than one task runs in parallel; parallel tasks must declare disjoint `writes` path prefixes, may not write `project.json` and may not publish (`validateDelegation`). The engine enforces each worker's scope at execution. Parallel tasks never publish because publication restores the workspace from the published snapshot, which would remove another worker's unpublished files. Commands and publication run one at a time within the workspace (`CodeWorkspace.exclusive`), so concurrent dependency installs cannot collide.

An approved plan runs as one lead conversation: each step is appended as a new message, so the lead keeps its project context and the prompt cache is read rather than rewritten. Publications from earlier steps cannot complete a later step. Plans are kept to one step per distinct user-visible change.

Workers do not receive the source-frame overview; their brief must be self-contained, and they can call `view_media`. Every worker uses the same system prompt, with its scope in the task message, so workers share a cached prefix. A worker that ends with text instead of `finish` reports that text. Worker errors other than cancellation, file permission, quota and authentication are returned to the lead as blocked reports, so the lead can re-delegate with a better brief.

## The agent loop

Each phase (lead, solo, worker, consultation) is a checkpointed conversation. Tool calls and results are persisted as complete pairs; a replayed call ID returns its saved receipt and never repeats an effect. The loop:

- stops at 60 model calls for the lead and 80 for other roles, reporting a blocker (or completion when the current revision is already published);
- nudges a text-only response at most twice, then completes if the current revision is published or reports the text as a blocker;
- treats repeated failures of the same tool on the same file or command as one problem (`coarseKey`), even when inputs differ, and stops after five;
- on truncation, inference first retries with double the output allowance (up to 64K); only then is the agent told to split the work, and three truncations end the step;
- completes only when the current head was published (or validated unchanged) in this phase, directly or by a worker. Unknown evidence IDs are dropped, the publication receipt is added automatically, and the task list is marked complete.

Nothing renders during chat. Publication validates and copies scene code, and the live player runs it immediately; only Export renders frames. `view_media` with `target: preview` returns timeline metadata. Because the agents never see frames, scenes size text relative to the frame, fit long text to its box and use flex or grid layout so elements cannot overlap, and the lead reviews the scene source for these. Files on the user computer are read with `list_files`, `search` and `read_file` (scope computer) and changed only through `propose_file_changes`, which pauses for the user's approval and resumes with the decision; workers cannot change computer files. The request's attached media and timeline selection are part of the first message's project context.

`run_command` never publishes. Only `publish_project` publishes; its result includes the refreshed `project.json` hash, because publication rewrites that file with the new `baseVersionId`. `edit_file` needs a unique match; its hash is optional. A stale `baseVersionId` error points to `context/published-project.json`.

## Context

The first message of a phase carries the request, project overview, the last six conversation messages, relevant indexed chunks and decisions. The lead, readonly and planning phases also receive the bounded source-frame and transcript map on their first request. When the project or media state changes, a state message is appended (never edited).

Working targets: 90K tokens for Haiku (its price tier changes above 100K) and 180K for Opus; the hard limit is the 1M context window minus output. The estimate only decides whether to measure. Compaction happens only after a real token count exceeds the target (count failures fall back to the estimate). Compaction is sticky: the chosen boundary and summary are stored, and later requests reuse the identical prefix and only append, so prompt-cache reads and thinking-block bindings survive between compactions. Exact file and transcript reads are carried through compaction, newest first, within 40% of the target; older results stay archived and readable through `read_file` with scope `receipt`.

## Inference and caching

Requests stream through the Supabase gateway. Tools and system carry a one-hour cache breakpoint; the conversation uses automatic five-minute caching. Effort is fixed per role for a whole conversation, because changing effort mid-conversation invalidates the message cache. Output allowance is 16K at low effort and 32K otherwise (`max_tokens` includes thinking).

The client uses a 90-second idle watchdog (the gateway pings every five seconds) instead of a total timeout. Confirmed transient failures and unconfirmed outcomes (dropped connection, gateway timeout) are cancelled server-side and retried up to three times with backoff; recovery first tries to reclaim the original response by request ID. Exhausted retries raise code `unavailable`. Quota, authentication and request conflicts are never retried.

The gateway changes (64K output cap, 350-second default wall time, one-hour prefix cache, Sonnet cache-read price) take effect only after `supabase functions deploy dream-gateway`.

## Workspace and publication

`Workspace/project.json` is a version-1 `dream-workspace` document with `baseVersionId`, the timeline and `outputs`. Scenes are HTML defining `window.renderFrame(frame,fps)`. Local `<script src>` and stylesheet references are inlined at publication, so libraries bundled with `bundle_scene` never pass through model output; external URLs are rejected. Output declarations use `{id,path,kind,width,height,fps,durationInFrames}` and timeline references use `output:<id>` until publication. Source media is materialized into the read-only sibling `Sources` directory. Credentials and the project database remain outside the process write boundary.

Publication validates the document, copies scenes and media into hash-addressed storage, resolves asset references, and saves the timeline, source snapshot, assets and receipt in one SQLite transaction. Replaying a completed call cannot create another version.

Undo, redo, restore and branch changes persist a source-restoration intent in the same transaction as the version change; restoration is replayed before any subsequent workspace execution. Dependencies are reinstalled from restored lockfiles when their fingerprints differ. Collection and editable export include authored files and lockfiles, excluding reinstallable dependencies, caches and scratch media.

## Runtime

The Windows host uses an AppContainer with project-specific identity, read-only runtime/source access, an explicit environment without account credentials, and a kill-on-close Job Object. Node 24.19.0 and Python 3.13.16 are pinned. The upstream Node distribution contains libuv 1.52.1, whose anonymous child-process pipe names are incompatible with AppContainer. `patches/node24-libuv-appcontainer.patch` backports the production change from [libuv #5181](https://github.com/libuv/libuv/pull/5181). Staging uses `scripts/patch-code-node.ts` to replace the single pipe-name format constant without changing PE layout. The official archive is checksum-verified before modification, and the modified executable receives its own manifest hash. `DREAM_CREATION_NODE` can instead supply a source-built backport. Do not substitute host execution when qualification fails.

`pnpm stage:code-runtime` stages and hashes the runtimes, their licenses and the native host. `pnpm qualify:code-runtime` exercises actual Node/Python programs, package downloads, native dependencies, FFmpeg, browser rendering, private-storage denial and process-tree cancellation. Packaging checks the qualification against the exact runtime manifest. macOS has no qualified creation executor yet.

Opus and Sonnet requests carry the server-side refusal fallback (`fallbacks: "default"`). If the provider rejects a request carrying it, the gateway retries once without it and stops sending it on that instance. When a response falls back mid-stream, only the declined attempt's text is kept: its tool calls never execute and its thinking is not echoed back. Haiku has no server-side fallback; a refusal ends the step with a clear blocker.

## Verification

`pnpm exec tsx scripts/smoke-engine-local.ts` runs a simple Haiku edit and an Opus-led creative build against the real Anthropic API, through this repository's gateway code served on localhost (no Supabase project or deployment). It reads ANTHROPIC_API_KEY from the environment, .env.local or .secrets/anthropic.env and stops at `--budget` (default ). Results are recorded in docs/ACCEPTANCE.md.

Verification status belongs in `docs/ACCEPTANCE.md`; passing focused tests alone does not establish release readiness.
