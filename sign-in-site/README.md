# usegumbo.app — Figjam sign-in

A static site of its own, served at `https://usegumbo.app`. It holds only Figjam's sign-in page
(`/signin/`), which the desktop app opens; the homepage stays at usefigjam.com (`site/`).

Publish this folder as its own static site (for example a GitHub Pages site from a repository containing just this
folder, with `CNAME` set to usegumbo.app and HTTPS on; `.app` domains only work over HTTPS). Supabase needs
`http://127.0.0.1:**/callback**` in its redirect URLs, because Google and the emailed link return to the app there.
