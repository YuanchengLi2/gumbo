# Roux and the code creation engine

This document describes the production engine as of October 25, 2026 (Roux 2): the agent (`packages/agent`), its workstation (`apps/project-service/src/workspace.ts` with `footage-library.ts` and `edit-review.ts`) and the scene engine (`packages/scene-engine`).

## The idea

Roux edits video the way a programmer works in a codebase with Claude Code:

- **One loop for every request.** A message joins the project's one continuing conversation; the model is called; the tools it asks for run; their results go back; and that repeats until it answers without asking for a tool. Its words are then the reply. Nothing classifies the request first, nothing gates how it finishes, and nothing nudges it along. A short request is a few calls; a long one is as many as it needs.
- **The footage is files.** Every source has a readable overview, transcript and shot list under `footage/`, so Roux finds moments with `grep` and `read` the way it finds code.
- **Few general tools, small results.** Every result is small by default and pages on request.
- **Verify the work.** `review` watches the whole cut like a viewer would; it is the "run the tests" of an edit.
- **Edits apply as they are written.** Writing `project.json` checks it and applies it live; a problem comes back like a linter's.

The harness keeps the loop safe, small and cached. It does not steer the model.

## The division of labor

| Roux writes | The engine provides |
|---|---|
| The edit (`project.json`): what plays when (clips and their ranges, speed, framing, grade, transitions, overlays, effects, scenes, music, sound, captions), changed with `edit`, `write` or a program it runs | Validation against the sources, checks of what changed (footage used twice, cuts inside words, long silences), versions and undo, the live player and Export |
| Scene components (React, Remotion timing, three.js through React Three Fiber, d3, SVG, Canvas, CSS) | One prebuilt runtime with those libraries, bundled fonts, project media and resources by name, frame-exact video, textures, fit-to-box text, safe areas and beat timing; compilation in milliseconds |
| Media it makes under `output/` | Hash-addressed storage and placement as `output:<id>` |
| Score files (`src/music/*.score.json`) and sound designs | Expansion, validation and synthesis into audio with beat times |
| What to look at and what to use | Import, proxies, transcription, the shot index and the footage files |

Nothing renders the edit during chat. The edit plays live in the player; only Export renders.

## The agent (`packages/agent`)

- `session.ts`: the `Agent`. One conversation per project (saved as `agent-session`), carried across messages, so a follow-up reads the earlier exchange from the cache and remembers what was just done. It runs the loop, the tools Roux runs itself (`todo`, `title`, `task`, `propose_plan`, web search), compaction and the harness limits.
- `prompt.ts`: one system prompt for every model and every request (about 2.5K tokens). How to work (understand, plan with a todo list, edit, check with `review`, reply), when to ask, the workspace map and the editing rules. A mode (plan, ask) rides on the message as a note, so the cached prompt never changes.
- `tools.ts`: the tools' schemas, descriptions and tolerant parsing (a quoted choice is unwrapped, a null dropped, over-long prose shortened, a number moved to its bound; paths and code are never changed).
- `transport.ts`: one model call through the gateway with a saved receipt per call, recovery through `/ai-status`, stall and idle watchdogs, retries with backoff, one larger allowance for a reply cut off with something visible, and a usage row per response.
- `compact.ts`: compaction. `plans.ts`: plan mode's records. `activity.ts`: the rows the chat shows.

### The tools

| Tool | What it does |
|---|---|
| `read` | A text file with line numbers, paged with offset and limit; an image comes back as a picture; scope computer reads the user's files; version reads a file as an earlier version had it |
| `grep` | A regular expression across the workspace, footage included, with context lines and paging |
| `list` | A folder or a glob |
| `write`, `edit` | Write a file or replace an exact piece of one. `project.json` applies live; a scene compiles at once (a scene not in the edit shows the user a live preview; one in the edit, or code it imports, updates live); score and sound files are checked |
| `run` | A shell command (Unix tools, Node, Python, ffmpeg, installs). Past four minutes it goes on in the background with its output so far; `run` with its processId waits again or stops it. A command that changes `project.json` applies it |
| `look` | Frames of a source at the times asked, or over a range with the words spoken there (and loudness on request), or of the edit as the player draws it |
| `listen` | Up to 90 seconds of a source or of the edit, heard by a model that can hear, with loudness |
| `review` | The whole cut: what is said in playback order, every shot with its source range and what the shot index measured, what plays over it, the checks, the errors scenes reported, and a frame of every shot on one sheet |
| `find` | Shots by what is visible, said and measured, with their frames on one sheet |
| `task` | A helper with its own fresh conversation that looks and reads (never changes anything) and reports back, so a wide investigation never fills the main conversation |
| `todo` | The task list the user watches |
| `media` | Media on the computer by capture time or folder, or free-to-use media online; imports them (or files code uses into `resources/`) |
| `web` | A web search (answered by a quiet Haiku call with server-side search, for every model) or a page read as text |
| `title` | Names the project |
| `propose_plan` | Plan mode's proposal |
| `propose_files` | Changes to files on the user's computer, and exporting, which wait for the user's approval |

Calls that only look run together; anything that changes something runs on its own, in order. A result is cut at 20,000 characters with a note on how to read the rest.

### Plan mode, asking, and approval

- **Plan first**: the same loop, tools and prompt, with a note on the message. Changes are refused; Roux looks at what it needs and calls `propose_plan`. The proposal waits in `task_plan` with `ai_status` `awaiting_approval`; the user can change its steps in the card. Approving (the button, or a go-ahead such as "do it") adds the approved plan to the same conversation, seeds the task list with its steps, and Roux carries it out. Anything else typed while a plan waits asks for a changed plan.
- **Ask only**: the same loop; changes are refused and the reply is an answer.
- **Asking the user**: Roux replies with its question and stops; the answer comes as the next message. There is no separate ask-first step.

### The harness

- **Receipts**: each tool call's result is saved by its call id before the conversation goes on, and each model call has a receipt by its content. A stop, a crash or a closed app never runs a finished call twice; a resume runs only the calls that never finished (a command the stop cut short is reported as stopped, and the model decides).
- **Pauses**: a run pauses to check in after $0.50 of spending (`engineBudgets.requestSpendUsd`) or 30 minutes (`requestMinutes`), and after 150 steps. Each pause keeps everything; continue goes on with a fresh allowance.
- **Stalls**: a model that sends nothing for its limit (DeepSeek 60 s before its first token and 45 s between tokens; others 5 minutes) is cancelled and asked once more; a second stall on Roux 1 (Auto) hands the conversation to its other model, while a model the user picked is never switched.
- **Thinking-only replies**: a reply that spent its whole allowance thinking gets a short note and is asked again, twice at most.
- **Server tool calls** a provider left without a result are dropped, and a paused web search is sent back to carry on.

## The conversation and its cache

The first message has two blocks. The first is the session start, marked for caching and never changed after: `GUMBO.md`, the footage index, the creator profile from Settings, what the user wanted in their other projects, and the computer and installed packages. The second is the request with its context: the time, the edit in one line, what is selected and attached, what its @ references are, scenes that crashed while playing, what the user changed by hand since Roux's last edit, and footage that arrived since the conversation last heard about footage.

Everything after is appended. The system prompt and tools are identical in every mode and on every call (helpers included), so every call reads the same cached prefix; Anthropic models get breakpoints on the system prompt, the last tool and the session start, DeepSeek caches the prefix by itself, and OpenAI gets a `prompt_cache_key`.

**Compaction**: when the conversation passes 90K tokens (60K on Haiku), a Haiku call summarizes the older part (requests, decisions, the edit so far, footage learned, what is open), carrying an earlier summary forward. The session start stays exactly as it was; the summary joins the first message, and the recent exchanges stay verbatim. Saved messages are an append-only journal; a rewrite starts a new journal epoch.

**Models**: Roux 1 (Auto) runs the loop on DeepSeek V4.1 Flash (GPT-6.1 Sol, then Claude Sonnet 5.5, stand in without a DeepSeek key) and does the background work on Claude Haiku 5.5: shot descriptions, footage overviews and compaction summaries. A model the user picks runs the loop instead, and helpers run on the conversation's model. The effort is the composer's choice (Auto is medium).

## The workspace

```
GUMBO.md                       the project's memory: lasting wishes, decisions, notes on the footage
HISTORY.md                     the edit's versions, newest first, with what was asked for each
project.json                   the edit, applied live when written
footage/INDEX.md               every source: id, name, length, a one-line summary, how far its analysis has got
footage/<name>-<id>/overview.md     what it is, who is in it, its scenes with times, its moments
footage/<name>-<id>/transcript.txt  what is said, a sentence a line: [start-end] text
footage/<name>-<id>/words.json      every word with its times, a word a line, for code
footage/<name>-<id>/shots.txt       every shot: what is visible, tags, measured facts
footage/assets.json            ids, paths and facts for code
guides/editing.md guides/project.md guides/engine.md   the references, read when the work needs them
src/  output/  resources/
```

`footage/`, `guides/`, `HISTORY.md` and `GUMBO.md` are not part of a version: an undo never takes the memory back. The footage files follow the project (`FootageLibrary.refresh`, every few seconds and before Roux reads them): a transcript grows while it is heard, and a stretch not heard yet is marked so it never reads as silence. An overview is written once a source's transcript and shots are in: in one Haiku call for a source of up to about 48K characters, otherwise in parts of five minutes read four at a time and then combined.

### Applying the edit

Writing `project.json` runs `publishWorkspace`: it validates the document against the sources, compiles scenes, synthesizes music and sound, copies media into hash-addressed storage, resolves `output:<id>` (also to what an earlier write made from that output), and saves the timeline, the source snapshot and the assets in one SQLite transaction. The result says what changed, what each output became, what the checks found and what the shot index measured in the clips placed. A document based on an older version (the user changed the edit since Roux read it) is refused with a note to read it again. Each request is one undo checkpoint.

The checks (`edit-checks.ts`) use the timeline and the transcript only. Must fix: the same footage used twice (over a second of overlap), a cut more than 0.05 s inside a spoken word, more than three seconds of silence between words inside a clip. Notes: slow motion below half speed, one clip over 40% of a video of 15 seconds or more.

## Scenes

A scene is a default-exported React component in `src/**/*.tsx` (or `.ts`, `.jsx`, `.js`), declared in `project.json` outputs as `{id, path, kind:'scene', durationInFrames, ...}` and placed as `output:<id>`. Size and frame rate default to the project's; `props` lets one component serve many shots; `transparent` makes it an overlay. The reference Roux reads is `guides/engine.md` and `guides/project.md`, from `packages/scene-engine/reference/api.md`.

- **Runtime**: five chunks (core, three, d3, icons, noise) built by `scripts/build-engine.ts`, sharing one React, Remotion and three.js through a module registry.
- **Determinism**: a frame is acknowledged only after React commits, 3D roots advance and media finish loading; randomness is seeded and clocks report frame time.
- **Isolation**: each scene runs in its own sandboxed document with no network.
- **Compilation**: esbuild, in milliseconds; installed packages are bundled; files under `resources/` are served by name.
- **Errors**: nothing runs scene code in the background. A scene's runtime errors come from the player or a chat preview, mapped through its source map to `src/file:line`, and reach Roux in `look`, `review` and the next message's context.

Music is a score file in compact notation or a full score document; sound effects are a sound design file or a preset. Synthesis runs in the procedural audio worker, cached by content; music carries beat times that a scene reads with `useBeats(name)`.

## Media from the computer

`media` with action find looks for photos, videos and audio by capture time (today, yesterday, this week, the last 7 days, or dates) in camera rolls, synced phone folders, Videos, Downloads, Desktop and memory cards, reading capture time from each file's metadata. Results are grouped by folder, a line a file, marked with what is already imported. Action import brings up to 100 files at once (an unchanged file once); the files' transcripts and shots fill in as their analysis runs. Into resources copies folders and archives that code uses into `resources/`. Changes to the user's files go through `propose_files` and the user's approval.

## What the user sees

Roux says in a sentence what it will do, adds brief updates when something changes the plan, writes out scripts and copy before building them, and ends with a short recap. Each tool call is a row with Roux's own few words for it; a helper is one row. Applied edits show their changes, scene drafts show as live previews, and the task list shows Roux's todo list. The edit log of each request (`turn-log.ts`, version 3) holds its part of the conversation and every tool call with its input and result.

## Runtime

Without computer access, the Windows host runs commands in an AppContainer with project-specific identity, read-only runtime and source access, the app's own ffmpeg and ffprobe, internet access and no account credentials. With computer access granted, commands run on the user's computer with the bundled Node, Python and ffmpeg ahead on PATH and the app's own secrets removed. On the web, commands run in the browser sandbox (`packages/web-sandbox`): a POSIX shell with the usual tools, Python (Pyodide), ffmpeg in WebAssembly and esbuild.

## Verification

`pnpm typecheck` and `pnpm test` cover the agent end to end against scripted gateways: `tests/integration/roux-agent.test.ts` (the loop, the conversation across requests, plan mode, asking, helpers, footage search and review, pauses, stop and resume, compaction, hand changes, the edit log), the tools' suites (publication, scenes, commands, media, transcripts, the shot index, history) and the transport's (recovery, streaming, stalls). The browser tests (`npx playwright test -c tests/web/playwright.config.ts`) run Roux in the web app against the scripted gateway in `tests/fixtures/code-gateway.ts`. `tsx scripts/prefix-tokens.ts` counts the cached prefix exactly. Results of live runs are recorded in `docs/ACCEPTANCE.md`.
