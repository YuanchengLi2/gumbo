# What's new in Gumbo

Everything that changes in Gumbo, newest first, in the words people using it would use. Each `##` entry is published
to usegumbo.app/community as an update people can reply to and upvote (`npx tsx scripts/publish-changelog.ts`), so
write one for every change people will notice, the day it ships. The heading is `## YYYY-MM-DD · Title`; keep a
title once published, since it names the entry.

## 2026-10-24 · Share how you made a video
After exporting, click Share link to get a page you can send anyone. It shows your video next to the requests you
typed and a few stills of the footage it started from ("3 clips · 1:36 of footage"), so people can see how you made
it. A button there lets them try Gumbo themselves, with your first request already filled in.

## 2026-10-24 · "Stumped or broken? Let me know" under the chat box
If a prompt fails or something doesn't work, click "Stumped or broken? Let me know" under the box you type requests
in. Write a few words about what went wrong and, if you like, your email so I can tell you when it's fixed. You don't
need an account. Gumbo sends what it was doing along with your note, so you don't have to explain the details.

## 2026-10-24 · Free plan videos end with "Edited with Gumbo"
Videos exported on the free plan now show a small "Edited with Gumbo" in the bottom-right corner for their last couple
of seconds. It fades in and stays out of the way of your edit. Paid plans export without it. The export window says
when your video will have it.

## 2026-10-24 · Community: what's new, a board for ideas, and replies
There's a new Community page at usegumbo.app/community. It shows everything that changes in Gumbo, and has a board
where you can post an idea, a bug or a question, reply to other people, and upvote what you'd like next. You'll see
which ideas are planned, being built, or shipped.

## 2026-10-24 · Exports with titles and motion graphics are about 3× faster
Videos with Gumbo's coded titles, backdrops and motion graphics took a long time to export in the browser: about 15
seconds for every second of video. Each frame now takes a third of the time. Videos without motion graphics export as
quickly as before (a minute of 720p video in about 45 seconds).

## 2026-10-24 · @ points at what's on your timeline
Type @ in the chat box to point Gumbo at a clip, a piece of text, a scene or the music, listed by where it is in the
video ("Clip 3 · beach.mp4 · 0:12–0:18"). It joins the selected items above the box, and the preview jumps to it.
Media picked with @ is attached, the same as adding it with +.

## 2026-10-24 · Upload from the homepage, screen recordings, and phones
- The + in the homepage's request bar now adds your videos. They open in Gumbo with your request, even if you sign in
  first.
- Chrome screen recordings import and play. Some failed to make their preview and stuttered.
- On phones, the project name no longer runs under the Gumbo/Editor switch, and the Editor lays out the picture, tools,
  settings and timeline one above the other.
- The project's header is slimmer, with less empty space above the name.
- Clicking a clip on the timeline shows it in the preview.
- Scrolled sideways, the timeline's ruler stays lined up with the clips.

## 2026-10-24 · Roux 1 is faster and checks its work less
Roux 1 thinks less before each step and stops re-checking an edit that's already done. Simple requests that took
minutes now take one or two (adding keyframes and restyling captions took 81 seconds), at about a cent each.

## 2026-10-24 · Commands that hang no longer stop an edit
When one of Gumbo's background commands got stuck, every command after it failed until the page was reloaded. A
stuck command now stops after 3 minutes and Gumbo carries on.

## 2026-10-24 · Edits by hand are instant
Moving, trimming and deleting on the timeline takes about a tenth of a second in the browser, down from up to two
seconds.

## 2026-10-23 · Music and sound effects in the browser
Gumbo's own music and sound effects now work in the web app. Before, a request that needed them could keep trying for
20 minutes and fail.

## 2026-10-23 · Media appears the moment you add it
Files show up in your project as soon as you pick or drop them, and a large clip imports about four times faster.

## 2026-10-23 · Gumbo on the web
Gumbo now runs in your browser at usegumbo.app/app, in Chrome or Edge, with nothing to install. Your projects and
footage stay on your computer. Speech is transcribed in seconds, you can give Gumbo access to several folders, and
the basics work on Android phones.

## 2026-10-22 · Open beta
Anyone can sign up and start editing; there's no waitlist anymore.

## 2026-10-22 · Gumbo 0.2.4 for Windows
A smoother editor and preview, fixes to the chat box, edits that survive a hung AI model or a dropped connection,
and a library of creator styles to edit like.

## 2026-10-21 · Effects, speed ramps, caption styles and new looks
- 25 effects, including punch-in zoom, handheld, camera shake, freeze, light leak and film burn.
- Speed curves (montage, hero, bullet, flash in and out) that keep a clip's length.
- 12 caption styles, title presets and lower thirds, with new text animations.
- 30 looks, from B&W punch and film stock to dreamy, lo-fi and bright & airy.
