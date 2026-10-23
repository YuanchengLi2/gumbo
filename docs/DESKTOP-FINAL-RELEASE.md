# The desktop's final release

Gumbo moves to the web (usegumbo.app/app). The Windows app gets one last version that tells its users about the move.
After that, no more versions ship. The app keeps working for as long as the gateway still serves it.

## Order

Each step waits for an explicit go-ahead.

1. **The web app goes live.** Stage it with `npx tsx scripts/stage-web.ts`, deploy the staged folder (see
   sign-in-site/README.md), and push `supabase/config.toml`'s redirect URLs so sign-in can return to `/app/`.
2. **Desktop 0.3.0**, the last version (details below). It's built signed and published with `scripts/publish-release.ts`.
   Installed apps update to it on their own within four hours.
3. **`/download` points at `/app/`.** Every link already shared (outreach emails, Reddit, X) then lands in the web app,
   not on a 400 MB installer. `/download/windows` keeps serving the last installer for anyone who still needs it.
4. **The gateway stays desktop-compatible** until no desktop turns arrive for 60 days. Edit logs say which platform each
   turn came from (`web …` or `win32`), so the end of desktop use shows in the logs. Only then are desktop-only paths
   removed, such as the `127.0.0.1` sign-in return.

## What 0.3.0 changes

- **A notice on the home screen**: "Gumbo now runs in your browser", with "Open Gumbo on the web" (it opens
  usegumbo.app/app/ in the default browser). The notice can be closed, and nothing is taken away: the app still edits,
  exports and runs Roux.
- **Updates**: the update check stays, but no newer release ever appears, so it stays quiet. "Restart to update" never
  shows.
- **Projects stay where they are**, in Documents\Dream\Projects. The notice says how to bring one over (next section).

## Bringing a desktop project to the web

This isn't built yet; it's about a day of work. It should land before or with 0.3.0.

- On the web home screen, "Open a desktop project" picks a project folder (`showDirectoryPicker`). The folder is copied
  into the browser's storage under /Dream/Projects and opened. The project service is the same, so its database,
  timeline, scenes and Roux's history open unchanged.
- Footage inside the project folder comes along. Footage the project linked from elsewhere on disk shows as missing,
  and the existing relink flow fixes it (drop or pick the file again).
- Big projects run up against the browser's storage quota. The copy checks `navigator.storage.estimate()` first and says
  how much room is needed.

## Launch-day checks on the live site

Headless Edge runs these against the deployed address:

- `/app/` loads cross-origin isolated, its service worker registers, and sign-in returns to `/app/` signed in.
- A scene address (`/app/engine/app/scene/<id>/index.html`) is served by `engine/host.html` with the engine's headers
  (CORP cross-origin, ACAO `*`, frame-ancestors `'self'`). Vercel's local dev server applies no headers to rewritten
  paths, so this can only be checked on a real deployment (a preview first).
- Import, playback, export, Roux on a short request (this spends AI credits, so it needs approval first), and a scene
  still.

## Known gaps at launch

- Chrome and Edge only. Safari and Firefox lack the File System Access and OPFS features the app needs, and the app
  says so.
- Granted folders need allowing again on each visit. The browser asks on the next message, file browse or export, and
  Chrome can remember "Allow on every visit".
- `bundle_scene` and coded visuals (`renderVisual`) aren't available in the browser yet. Legacy HTML scenes can't be
  captured.
- Pyodide, ffmpeg.wasm and esbuild-wasm load from the jsDelivr CDN on Roux's first command that needs them.
