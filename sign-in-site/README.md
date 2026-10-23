# usegumbo.app

Gumbo's website, a static site on Vercel served at `https://usegumbo.app`:

- `/` the homepage, built around one idea: type anything, get the edit. The hero demo types very different requests
  into a Gumbo window and applies each to 5-second loops of the Vietnam demo in `media/loops` (stills in `media/frames`,
  footage from Pexels). "Behind the Short" replays every step Gumbo took on the real Vietnam project, with times from
  its log and thumbnails in `media/making`. The prompt bars open an early-access email with the visitor's request filled in.
- `/signin/` the sign-in page the desktop app opens.
- `/privacy/` and `/terms/`, linked from Google's sign-in screen.
- `/billing/` where Stripe sends people back after Checkout or the customer portal: it says what happened (`?status=`
  subscribed, credits, portal or cancelled) and to go back to Gumbo, which shows the new plan or credits.
- `/dashboard/` the spending dashboard: every billed AI call by provider, model, day, account and request. Nothing links
  to it and it is marked noindex. The page holds no data: the gateway's `spend-dashboard` action checks the password
  (the `DREAM_DASHBOARD_PASSWORD` secret), refuses an address after 8 wrong tries in 15 minutes, and names accounts by
  label, never email. To try it before deploying, run `pnpm dashboard` and open
  http://127.0.0.1:4317/site-dashboard/?api=/spend-dashboard (password from `.env.local`).

- `/app/` Gumbo itself, the web app (apps/web), built into the deploy. It is not kept in this folder.

Deploy with `npx tsx scripts/stage-web.ts`. It builds the web app for production, copies this folder (with `.vercel/`)
and the build into `app/` of a git-free folder outside the repo, because Vercel won't deploy from this repo's git
author. Then run `npx vercel deploy --prod --yes` there, as the script says. `vercel.json` keeps other sites from framing
the pages and sends no referrer (the sign-in page's address carries the app's one-time callback). Under `/app/` it also:

- makes the app cross-origin isolated (COOP same-origin, COEP credentialless), for SharedArrayBuffer;
- serves `engine/host.html` at every scene and draft address, which the app's own pages may frame and read;
- never caches the page or its service worker, and caches the hashed assets forever.

Supabase needs these in its redirect URLs, because Google and the emailed link return there:

- `http://127.0.0.1:**/callback**` for the desktop app;
- `https://usegumbo.app/app/**` and `http://localhost:**/app/**` for the web app (supabase/config.toml).

`https://usegumbo.app/download` is the link to share: `vercel.json` sends it to the newest Windows installer on the
gumbo-releases repo (the same releases the app updates from), so it never needs changing when a version ships.
