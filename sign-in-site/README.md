# usegumbo.app

Gumbo's website, a static site on Vercel served at `https://usegumbo.app`:

- `/` the homepage, built around one idea: type anything, get the edit. The hero demo types very different requests
  into a Gumbo window and applies each to 5-second loops of the Vietnam demo in `media/loops` (stills in `media/frames`,
  footage from Pexels). "Behind the Short" replays every step Gumbo took on the real Vietnam project, with times from
  its log and thumbnails in `media/making`. The prompt bars open an early-access email with the visitor's request filled in.
- `/signin/` the sign-in page the desktop app opens.
- `/privacy/` and `/terms/`, linked from Google's sign-in screen.

Deploy from this folder with `npx vercel deploy --prod`. `vercel.json` keeps other sites from framing the pages and sends
no referrer (the sign-in page's address carries the app's one-time callback). Supabase needs `http://127.0.0.1:**/callback**`
in its redirect URLs, because Google and the emailed link return to the app there.
