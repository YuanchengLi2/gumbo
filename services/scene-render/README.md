# Quick render (Modal)

Draws an export's coded scenes (titles, backdrops, motion graphics) in many cloud browsers at once, so they don't
take a fifth of a second a frame in the user's browser. Only the scene's code and the small files it uses are sent;
the footage stays on the user's computer, and the editor puts the drawn scene over it as it exports.

- `render.mjs`: draws frames of one scene with Playwright's Chromium and encodes them as a transparent WebM.
- `app.py`: the Modal app. `POST /` with a pass from the gateway splits the frames over up to 24 containers.
- The gateway hands out passes (`scene-render-pass`, `supabase/functions/dream-gateway/scene-render.ts`) to the owner
  and the plans in `DREAM_SCENE_RENDER_PLANS` (Pro and Max unless set).
- The editor asks for a pass when an export has scenes (`apps/web/src/bridge/cloud-scenes.ts`) and draws a scene
  itself whenever quick render isn't available or fails.

## Setting it up

1. Create a Modal account, then on this computer: `pip install modal` and `modal token new` (opens the browser).
2. Make a shared secret: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
3. `modal secret create gumbo-scene-render SCENE_RENDER_SECRET=<the secret>`
4. `modal deploy services/scene-render/app.py` prints the app's URL (`https://<workspace>--gumbo-scene-render-web.modal.run`).
5. `supabase secrets set DREAM_SCENE_RENDER_URL=<that URL> DREAM_SCENE_RENDER_SECRET=<the secret>`.

## Testing without Modal

`tests/web/cloud-scenes.spec.ts` runs `render.mjs` on this computer against the dev server and checks the frames.
