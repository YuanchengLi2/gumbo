# usegumbo.app

Gumbo's website, a static site on Vercel served at `https://usegumbo.app`:

- `/` the homepage. The kitchen animation, the bento and the phone Short use `media/` (frames and clips from the
  Vietnam demo, footage from Pexels). The prompt bars open an early-access email with the visitor's idea filled in.
- `/signin/` the sign-in page the desktop app opens.
- `/privacy/` and `/terms/`, linked from Google's sign-in screen.

Deploy from this folder with `npx vercel deploy --prod`. `vercel.json` keeps other sites from framing the pages and sends
no referrer (the sign-in page's address carries the app's one-time callback). Supabase needs `http://127.0.0.1:**/callback**`
in its redirect URLs, because Google and the emailed link return to the app there.
