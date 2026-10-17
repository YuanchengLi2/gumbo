# usegumbo.app

Gumbo's website, a static site on Vercel served at `https://usegumbo.app`:

- `/` the homepage, built around one idea: type anything, get the edit. The hero demo types very different requests
  into a Gumbo window and applies each to 5-second loops of the Vietnam demo in `media/loops` (stills in `media/frames`,
  footage from Pexels). "Behind the Short" replays every step Gumbo took on the real Vietnam project, with times from
  its log and thumbnails in `media/making`. The prompt bars open an early-access email with the visitor's request filled in.
- `/signin/` the sign-in page the desktop app opens.
- `/privacy/` and `/terms/`, linked from Google's sign-in screen.
- `/dashboard/` the spending dashboard: every billed AI call by provider, model, day, account and request. Nothing links
  to it and it is marked noindex. The page holds no data: the gateway's `spend-dashboard` action checks the password
  (the `DREAM_DASHBOARD_PASSWORD` secret), refuses an address after 8 wrong tries in 15 minutes, and names accounts by
  label, never email. To try it before deploying, run `pnpm dashboard` and open
  http://127.0.0.1:4317/site-dashboard/?api=/spend-dashboard (password from `.env.local`).

Deploy from this folder with `npx vercel deploy --prod`. `vercel.json` keeps other sites from framing the pages and sends
no referrer (the sign-in page's address carries the app's one-time callback). Supabase needs `http://127.0.0.1:**/callback**`
in its redirect URLs, because Google and the emailed link return to the app there.
