# What's new in Gumbo

Everything that changes in Gumbo, newest first, in the words people using it would use. Each `##` entry is published
to usegumbo.app/community as an update people can reply to and upvote (`npx tsx scripts/publish-changelog.ts`), so
write one for every change people will notice, the day it ships. The heading is `## YYYY-MM-DD · Title`; keep a
title once published, since it names the entry.

## 2026-10-30 · Gumbo for Chrome: memory brings what you read, and leaves out what's merely like it
Ctrl+K and the sidebar now find what you read when Chrome has just opened or you've been away for a while. Before, a
question asked while Gumbo's memory was still waking up could miss the page you read, and keep missing it for as long
as you asked the same thing.

New memory is found by its words too. With only a little in memory, as when you've just started using Gumbo, a page you
read could fail to come up for a question that named it. Now a page that shares your question's words, or names it in
its title, comes up.

The sidebar now looks for memories about what's on your screen as well as what you typed. "Reply to Dana that I'll be
there" on a chat about the planning meeting now brings back your notes on that meeting.

Memory is pickier about what it brings. It used to pass along almost anything a little like what you were doing, so
Tab, Ctrl+K and the sidebar could be handed a page about something else entirely. Now Ctrl+K and the sidebar get one or
two other memories with the right one instead of nearly ten, and Tab about half as many, without losing the ones that
matter.

Memory also keeps each page you read once, records only what's new when you come back to a page, and makes room by
letting go of the oldest things it saw first, never more than it can search.

## 2026-10-30 · Gumbo for Chrome: Tab sees all of big apps, and knows when a click did nothing
Tab now sees the whole page in big apps like inboxes, boards and dashboards. Before, it could stop reading a large page
partway, so the list or board you were working in might never reach it.

It also sees controls that only act like buttons: an email row, a card or an icon the app makes clickable without
marking it as a button. Icon buttons with no words get a name from their tooltip or their icon (trash, star, archive),
so Tab can offer them and tell them apart.

Tab can now tell when a step really did nothing. Busy apps change all the time on their own (a clock, a status dot, a
counter), and Tab used to take any change as its click working. It now looks for what the step should do: the button's
state changing, a menu opening, a row going, the page saying "Sent". When nothing happened, it tries once more another
way, and it never presses a toggle twice.

## 2026-10-29 · Gumbo for Chrome: Tab brings what you saw, fills empty fields, and offers one thing at a time
Tab now brings in what you saw a moment ago. Writing "My flight lands at" with the booking open in another tab, or
answering "how much was the invoice?" after reading it, Tab's words carry the time or the amount, and say where they
came from.

An empty field is filled from what you saw: click into one and Tab offers what goes there when something you read holds
it, like the total from the invoice in an "Amount" column or the order number support asked for.

Tab offers one thing at a time, the one most likely right. When it is much surer of a move (Send, Submit, the next
field) than of the words it was about to suggest, the move shows instead, and a move that would only type into your
field shows as words there, taken with Tab like any suggestion.

Memory is now a recording of what's on your screen. As you scroll, switch tabs or a page changes, what comes into view
is kept, inside embedded frames too, along with the words in images and on pages drawn as pictures. Tab pulls from it
whatever matches what you're doing, however long ago you saw it, while the text around your cursor decides how the
words go. Moves use it too, show up more readily, and never offer to type again what's already on the page.

PDFs you read are remembered too: an invoice, a reading or a handout open in Chrome's viewer is read from the file once
you've looked at it for a moment, its totals, dates and numbers kept as facts Tab can bring back.

What you just saw is findable right away, by what it means and not only by its words. Before, memory could stop
working out what new pages meant for the rest of the session, so Tab missed things you had just read.

On a page drawn as pictures (a design tool, a sheet, a whiteboard), Gumbo says once, in a small note in the corner, that
it reads that page from images, so Tab is slower and less exact there.

Memory keeps only what you saw: pages that were on your screen, what you copied and wrote, what you heard. Titles from
your history, bookmarks, tabs you never opened and emails the agent read for you are no longer kept as memory (your
history still teaches Tab where you usually go next).

## 2026-10-25 · Roux, rebuilt: it reads your footage, watches its own cut, and remembers the conversation
Roux, the editor inside Gumbo, is rebuilt from the ground up to work the way the best coding agents do.

It reads your footage. Every video you add gets a written overview of its story, people and scenes, a transcript
sentence by sentence and a list of every shot, so Roux finds "where she says the price" in a long stream in seconds,
and a short cut of a 20-minute episode keeps whole sentences in story order, ending included.

It knows more than what's said. Gumbo listens to every video on your own computer and notes who is speaking, so in a
podcast or interview each line says which voice it is. It also notes laughter, applause, cheering, bangs and where the
music is, with the music's tempo and every beat, so a montage can cut on the beat and the moment the crowd goes up is
easy to find. Every few seconds of footage gets a note of what happens in it and any text on screen, like a score or a
slide title, so the play you want in a game or a match is found, not only what someone said.

It can follow someone or something through a shot. Ask for a vertical version, or for the camera to stay on one
player, and the framing moves with them instead of staying put while they walk out of frame.

It watches its own cut before it says it's done: what is said, in order, and a frame of every shot. It fixes what is
off, like a cut in the middle of a word or a story told out of order, before it tells you.

One conversation runs through your project, so "make it shorter" after a first cut remembers what was just done, and
replies come faster. Effort fits the request: yellow captions take a few steps, a first cut of long footage takes as
long as it needs, and when a request could mean very different edits ("follow Steve") it asks one short question
first. It notes down what you like for each project, Plan first still shows you the plan before anything changes, and
Undo takes back a whole request in one step, as before.

## 2026-10-25 · Speech in long videos is heard while they're still being added
When you drop or pick a long video, Gumbo plays it before it has finished copying in. Hearing its speech at that moment
could fail partway ("network error"), leaving the video with no transcript, so Roux couldn't find what was said. Now
transcription carries on from Gumbo's own copy, and a 10-minute video is transcribed in under a minute while it copies.

## 2026-10-24 · Videos are ready the moment you add them
Videos you add now play, go on the timeline and export straight away, instead of showing "Preparing…" while Gumbo
made a copy it could play. MP4s were already quick; now iPhone and Android videos (where Chrome or Edge can play them,
on most Windows and Mac computers), OBS recordings (.mkv) and camera files (.mts) are too. A 30-second OBS clip that
took 20 seconds is ready in about 4. Long recordings no longer wait to be copied into your browser first: a 600 MB
video plays the instant you drop it, and the copy finishes in the background. A file Gumbo can't open in the browser
(like .avi) now says so plainly.

## 2026-10-24 · Try Gumbo without an account, with sample clips
You can now try Gumbo before signing up: click "Try it free" on usegumbo.app. Add your own clips, or pick one of the
sample clips (a skate session, travel shots or a Roblox run) if you don't have any handy, say what you want, and Gumbo
makes your first edit. To keep editing or to export, sign in with Google or your email. Your project stays where it is.

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
