# usegumbo.app — Figjam sign-in

A static site of its own on Vercel, served at `https://usegumbo.app`. It holds only Figjam's sign-in page
(`/signin/`), which the desktop app opens; the homepage stays at usefigjam.com (`site/`).

Deploy from this folder with `npx vercel deploy --prod`. `vercel.json` keeps other sites from framing the page and sends
no referrer (the page's address carries the app's one-time callback). Supabase needs `http://127.0.0.1:**/callback**`
in its redirect URLs, because Google and the emailed link return to the app there.
