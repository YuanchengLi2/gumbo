# Roux 1 deep dive, October 2026

A stress run of Roux 1 (Auto: DeepSeek V4.1 Flash with Claude Haiku) on the packaged 0.2.3 app, with no window
(`DREAM_HEADLESS=1`), plus the October 21 ad run's own log. Harness: `tests/desktop/roux-stress-live.spec.ts`, which runs
only with `DREAM_ROUX_STRESS=1`. Each case gets a throwaway account capped at $1 a day.

**Coverage.** Four of the twelve cases ran:
- Cases 3 and 4 found the main problem. Case 3 ran to the harness limit. Case 4 was cut off at 23 minutes when the session ended.
- Cases 5 to 12 have not run: skate follow-ups, undo and ask again, photos, 4K vertical, a 9-minute highlight, 12 short clips, an impossible ask, and Japanese.
- Total live spend was $0.14.

Each case's project folder (with its database, `session.json` and logs) is kept locally under `artifacts/roux-stress-*`.

## Results

| Case | Request | Ending | Cost | Model calls | Time | Problem |
|---|---|---|---|---|---|---|
| Talking head (JFK speech) | "Add captions and some quiet background music under the speech." | complete | $0.027 | 25 | 98 s | none: real caption track and music, export plays at full length |
| Talking head, Spanish | "Quita los silencios y pon subtítulos grandes en el centro." | complete | $0.076 | 45 | 358 s | captions are 8 images Roux's code rendered, laid over the video, not on the caption track |
| Gameplay, 3 × 3 min AV1 | "make it better" | never finished (harness closed it) | $0.031 | 42 | 42 min | 6 of its own commands ran out of time; no clip placed |
| Gameplay, 3 × 3 min AV1 | "Make a 30-second montage of the funniest fails with captions and music." | cut off at 23 min | $0.007 | 12 | 23 min | same pattern: 3 commands ran out of time, nothing placed |

Model cost per edit stayed low throughout. The failures cost time, not money.

## Findings, ranked

### 1. AV1 footage is slow to read, and Roux runs out of time on it (engine, open)
The Roblox clips are AV1 at 1080p60, as YouTube downloads usually are.
- **Slow decoder:** the bundled `ffmpeg-static` has no fast AV1 decoder (libdav1d), only libaom. One frame grab at 90 seconds took 31 seconds while the machine was busy.
- **No proxy:** import makes a fast H.264 proxy only when the original cannot play in the browser (`media.ts`, `canPreviewOriginal`). Chromium plays AV1, so these files get no proxy.
- **Every read crawls:** `view_media`, the shot index and Roux's own scripts all decode the original. Roux said it itself: "The rainbow source is slow to seek through the player… Direct decoding of these 1080p60 files is too slow."
- **What Roux did instead:** it wrote ffmpeg and Python scans of the whole files. Its time limits (300 to 600 s) ran out one after another.

**Proposed fix:**
- Give every source whose codec this ffmpeg decodes slowly (AV1, and likely VP9) a working H.264 proxy at import, in the background, whether or not the browser can play the original.
- Point frame reads (`source-frames.ts`, the shot index, `view_media`) and the paths the workspace offers the agent at that proxy.
- Or bundle an ffmpeg with libdav1d.

This needs care in the media pipeline, so it is left for its own change.

### 2. A run could go on without limit while costing little (engine, fixed in d33f8e3)
The spend pause (50¢) and the step limit never tripped on case 3: 42 minutes for $0.03.
- An edit now pauses after 30 minutes of one run (`engineBudgets.requestMinutes`), like the spend pause. "Continue" starts the clock again.
- The second command that runs out of time brings a budget reminder that points at `find_shots`, `view_media` and the shot index.

### 3. A hung DeepSeek call left Roux on "Reconnecting to AI" with no fallback (engine, fixed in 1fcd387)
The October 21 ad run's title step shows three "The AI provider stopped sending data." failures about 65 seconds apart.
- **Cause:** the engine's watchdog was reset by the gateway's 5-second pings, so a hung model never tripped it. Recovery then polled the request's status for minutes.
- **Detection:** a stall is now measured on the model's own tokens. DeepSeek gets 60 s to the first token and 45 s between tokens; models that think silently get 5 minutes.
- **Recovery:** the call is cancelled and asked once more. A second stall hands the same conversation to Auto's other model, which stays pinned for resumes.
- **User's pick:** a model the user picked is never switched; they are told instead.
- **Network outages:** if the gateway itself cannot be reached, it is a lost connection, not a stall, and no model is switched.

### 4. Resume after a network drop (engine, fixed in 1fcd387)
In the ad run, the two resumed music steps ended "Stopped." about 4 seconds after sending. That is the Stop path: the send button turns into Stop under the cursor (see the UI list). Two real defects were found while tracing it:
- A call left unsent by a failed connection check kept its spent retries, so the resume's first network hiccup ended the request at once.
- A bare "continue" was added to the conversation and invited a one-line reply that ended the edit. Now a go-ahead adds nothing, unrun tool calls run, and the first reply after a resume that only talks is nudged on.

### 5. Captions sometimes come out as rendered images (agent, open)
In the Spanish case, Roux drew the captions with its own code as 8 overlay images instead of using the timeline's caption track. They look right in the export, but the user cannot edit the words or restyle them. The English case used the caption track.

**Next step:** find what led it there (Spanish text, "big and centred" styling the caption track may not offer, or the timing source) before changing anything.

## For the editor session (UI)
- The send button turns into Stop under the cursor as a request starts, so a quick second click stops the run. This happened twice in the October 21 ad run ("Stopped." four seconds in). Delay the swap, or move Stop away from where the user just clicked.
- Captions Roux renders as images cannot be edited (finding 5). If that is ever the intended path, the editor should at least say why the text cannot be changed.

## Harness notes
- Fresh checkouts no longer read as unpublished gateway changes. `assertCurrent` counts unchanged files from their last commit.
- For a shipped build (`DREAM_LIVE_SHIPPED_BUILD=1`), the gateway is checked as of when that build was made.
- A case that fails softly no longer skips the rest (no serial mode).
- AV1 cases can hold a run for up to 45 minutes each until finding 1 is fixed. Expect that, or leave them out with `DREAM_ROUX_CASES`.
