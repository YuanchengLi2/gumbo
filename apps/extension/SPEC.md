# Gumbo for Chrome: build spec

**Gumbo is an AI that lives in your browser, knows what you're working on, and helps in every app you use.** It finishes
what you are typing (**Tab**), rewrites or answers in place (**Ctrl+K**), remembers what you read, write and hear, and
later works for you in a sidebar (**the agent**). It is built first for its maker and friends; the bar is that it feels
like magic on every site, every day.

**Everything runs and stays on the computer except model calls.** The network carries only:
- the gateway (`supabase/functions/dream-gateway`), which holds every AI key and receives the snippets a request
  needs. For the extension's requests it keeps no text: only the request id, its status and its cost;
- Supabase Auth, to sign in and refresh the session;
- model weights downloaded once (Whisper, YAMNet, CAM++), which carry no data of yours, each checked against its hash.
  The embedding model (bge-small) ships inside the extension;
- when the user turns sync on, memory sealed with a key made from their passphrase (§6.1): the server holds only
  ciphertext it can't read.

There is no analytics, and no readable memory on a server. Telemetry (latency, acceptance, failures) stays local.

This folder (`apps/extension`, package `@dream/extension`) is the Chrome extension. It reuses Gumbo accounts, the
Supabase project and the gateway.

**Order of work:** the field engine, Tab for text, Ctrl+K, Tab for actions; memory and audio (meetings and videos); a
perfection pass; then the agent and its sidebar; connectors last (Gmail, Calendar, Drive, Docs, Slides, Supabase, Vercel,
Stripe). **Later, not in this build:** capturing other desktop apps, projects and the first-run screen, the website.

---

## 1. What "perfect" means

1. **The mechanics never fail, on any editor.** The ghost text sits exactly on the caret; accepted text always lands
   and Ctrl+Z undoes it; the page never breaks, shifts or loses its own shortcuts; a sensitive field is never touched.
2. **When it shows, it's right.** It shows nothing rather than something wrong. Precision is measured on your own
   typing and actions (§9), and the first ghost word appears within 500 ms (median) of a pause.

Both are measured, not judged by demos (§9).

---

## 2. The field engine: one engine for every site

There is no code written for one site. General readers find what matters on any page; a site-specific reader is added
only when the failure log (§9.4) shows the general one missing something, and a fix improves the general reader first.

### 2.1 Finding fields
- Every editable element: `input` (text-like types), `textarea`, `contenteditable` from any framework, inside open
  shadow roots. The content script runs in every frame; each frame handles its own fields.
- The editor kind is recognised so insertion and the caret are handled right: ProseMirror/TipTap, Lexical, Slate,
  Draft, Quill, CKEditor 5, TinyMCE (an iframe), CodeMirror 6, Monaco (a hidden textarea), plain contenteditable.

### 2.2 Reading context
- **What the field is for (intent):** its label (`label[for]`, `aria-labelledby`, `aria-label`, `title`, placeholder,
  the text beside it, the fieldset's legend), the form's other fields (never sensitive ones) and the words on the
  submit button ("Send", "Reply", "Post", "Search", "Comment"). Together these name the intent: email, chat message,
  search, comment or post, form answer, document, prompt to an AI, code.
- **The conversation above it:** the nearest scrolling container with repeated sibling blocks of the same shape (an
  author, a time, a body) gives the last messages and who wrote each. One reader serves Gmail, Slack, Discord, X,
  LinkedIn, WhatsApp Web, Teams, Reddit and GitHub.
- **The document:** in a long editor, its headings, the paragraphs before the cursor (~2,000 characters) and after it
  (~500).
- **The page:** its title, site, and main readable content (for replies to an article or post).

### 2.3 Showing the ghost
- `textarea` and `input`: a mirror element with the field's computed styles gives the caret's position.
- `contenteditable`: the caret's rectangle from a Range (with a zero-width probe when the Range has none).
- The ghost is an overlay that starts at the caret and wraps like the field's own text (same font, the block's width,
  `text-indent` for the first line). In the middle of a line, where inline text would cover what follows, it shows as a
  small chip under the caret instead.
- It follows scrolling, resizing, zoom, CSS transforms, right-to-left text and iframe offsets, and is drawn in a shadow
  root that never changes the page's layout.

### 2.4 Inserting
In order, until the text reads back right:
1. `document.execCommand('insertText')`, which keeps the field's undo history and is what React, ProseMirror, Lexical,
   Slate, Draft and Quill listen for;
2. a `beforeinput`/`input` pair with `setRangeText` for plain fields whose framework ignored step 1;
3. a synthetic paste (`ClipboardEvent` with `text/plain`, and `text/html` for rich text).

Every insertion is **read back**; a partial one is undone and tried the next way. A failure that survives all three is
logged (§9.4) and the text is left on the clipboard with a short note.

### 2.5 Never
In password, card, one-time-code, PIN or ID fields (by type, `autocomplete`, name and label), inside payment frames,
on blocked sites (banking and health by default), in incognito, while paused, or while an input method is composing.

### 2.6 Canvas editors
Google Docs, Slides and Figma draw their own text, so the page holds none of it. Docs exposes its text to screen readers
when its screen-reader support is on (Ctrl+Alt+Z); Gumbo reads that and types into Docs' input frame. Elsewhere an
opt-in mode uses the Chrome DevTools Protocol (`Input.insertText` and the accessibility tree); Chrome shows a bar while
it is on.

As built (October 26), Tab for actions and Ctrl+K see any page drawn as pixels, so they work on more than these editors:
- **When:** canvases cover more than a fifth of the view.
- **What the model gets:** a picture of the view with the guess or the question (at most 1280 px wide, one shared within
  0.7 s, since Chrome allows two a second).
- **Moves point at spots:** `"at":[x,y]` in the picture's pixels, and `"to_at"` for where a drag ends; they are scaled
  back to the page. Tab acts there with real pointer events and marks each spot with a dot. Typing that lands in an
  editor's own input frame is handed to that frame.
- **Not reused:** a guess about a drawn page is never kept, because the drawing changes while its elements don't.
- **Real input:** for pages that ignore synthetic events, the popup's "Use real clicks in drawing apps" asks for the
  `debugger` permission; Tab then clicks and types through `Input.dispatchMouseEvent` and `Input.insertText`.

**Editors that type through a hidden box.** Google Docs takes keys through an EditContext in a frame one pixel tall at
the caret; the box holds none of the words. A field nobody sees (it, or its frame, a line or less; Monaco and CodeMirror
excepted) is never treated as a field:
- **Ctrl+K** opens in the page itself, below the caret. The picture is taken as the key is pressed, while the selection
  is still highlighted, and the model is told highlighted words are the selection. A kept edit goes in once through
  the box (a paste the editor takes), since it can't be read back.
- **Tab for text:** at a pause, the model reads a picture with the caret drawn in red and what was just typed (so the
  words meet it exactly). The words show under the caret; Tab types them through the box.
- **Tab for actions** in the box's frame never guesses: the page around it does.

---

## 3. Tab for text

Grey ghost text at the cursor. **Tab** accepts it, **Ctrl+→** accepts one word, **Esc** dismisses, typing on ignores it.
Typing the same characters as the ghost keeps the rest showing; Backspace brings it back. Tab is taken only while a
suggestion shows; otherwise it does what it always does.

### 3.1 What the model sees
- Fill in the middle: the text before the cursor, a cursor mark, the text after it; the field's intent; the
  conversation or document; the page title and site.
- From memory (§6): two or three pieces of your own writing from similar fields (to match your voice and sign-off),
  suggestions you accepted on this site as examples, and pages, meetings or notes that match what you are writing.
- It answers with only the text to insert, at most one sentence or line, and **with nothing when it is unsure**.

### 3.2 Checks on every suggestion (code, not prompts)
- Remove any preamble, quotes, code fences or repeated prefix.
- Join cleanly: the right space (or none) where it meets your text, and a half-typed word finished, not restarted.
- Trim what overlaps the text after the cursor; drop what repeats text already there.
- Cut at the first sentence end; no newline in single-line fields.
- Same language as the field.
- **Facts guard:** a number, email, URL, date, price or name that appears in none of the context, your writing or
  your profile facts ends the suggestion just before it.

### 3.3 Confidence
Nothing shows unless: the model gave an answer; it passed the checks; there is enough context; and its length and the
site's record clear that site's threshold, which rises when suggestions there are ignored and falls when they are
accepted.

### 3.4 Speed (§9.1 measures it)

| Step | Budget |
|---|---|
| Debounce after the last keystroke | 120 ms |
| Content script → service worker | ~10 ms |
| Network and gateway | ≤ 120 ms |
| Model's first token | ~250 ms |

- Keystrokes that match the ghost, and a local cache keyed by the text before the cursor, need no request.
- The next keystroke cancels the request in flight, which stops the model too.
- Focusing a field wakes the service worker and opens the connection, and a pre-warm caches the stable start of the
  prompt (system prompt, profile, style).
- The answer streams; the first word that passes the checks shows at once and the rest follows.
- If the median is over 500 ms after the gateway's fast lane (§7), a Groq-hosted model is the next step.

---

## 4. Ctrl+K: edit, ask, write, act

Select text (or place the cursor), press **Ctrl+K**, type an instruction. Ctrl+K is taken only in an editable field or
when text is selected; on sites whose own Ctrl+K you keep (links in Gmail or Docs), **Alt+K** opens Gumbo instead.

- **Edit in place** ("more formal", "shorten", "bullets", "translate"): the rewrite streams into a card at the
  selection, old text struck through and new text in green, as Cursor's Cmd+K does; when it ends, an exact word diff
  replaces the stream. **Enter** keeps it, **Esc** restores the original, typing again refines it.
- **Ask** ("explain this", "where did I read about Groq latency?"): the answer shows in a bubble beside the selection,
  with links to the pages, notes or meeting moments it comes from.
- **Write from nothing:** in an empty field, "reply saying I can't make Friday".
- **Act on it:** a date → a prefilled new event in Google Calendar; a name → a mail search; an address → Maps;
  "save to my notes" → a local note. Anything irreversible waits for Enter.

How it stays accurate and fast:
- The selection is saved the moment Ctrl+K is pressed, because the instruction box takes focus.
- The prompt is ordered system, context, selection, instruction, and a pre-warm fires as the box opens, so by Enter the
  long part is already cached. Haiku runs on the fast lane, with room for about twice the selection.
- Rich text goes to the model as light Markdown (bold, italics, links, lists) and comes back as HTML, so formatting
  survives; spaces at the selection's edges and the language are kept; the model returns only the replacement, after
  a first word naming the mode (`edit`, `answer`, `act`).
- Applying restores the selection, checks the original is still there (finding it again by its text if the page
  changed), inserts it so Ctrl+Z undoes it, and reads it back.

As built (October 26): Ctrl+K opens on any page. With nothing selected and no field it uses the whole page, after the
page's own Ctrl+K has had its turn. The card opens with what the user most likely wants: ideas from the selection at once
(a date → calendar, an address → map), then the model's, from the page, the conversation, memory, what they copied
and their open tabs. ↑↓ choose, Tab puts an idea in the box, Enter runs it. Besides editing, answering and links, it can
**do something in the page** (`{"do":"page"}`): the agent's loop runs there, with its steps in the card and Enter for a
final step. Keys typed while the card is still loading are held and handed to it, so none is lost and none reaches the
page. Memory, what was just copied and the open tabs come with every request.

---

## 5. Tab for actions

When you are not typing, Tab can offer your next step as a small chip near the focused element: "Tab: open this week's
AP Calc assignment", "Tab: Supabase → gateway logs", "Tab: take notes" when a meeting starts. Tab runs it, Esc
dismisses it (Tab then works normally on that page). A chip never shows while a text suggestion does, or while you are
moving through a form.

- **Candidates** (local and instant): sequences you repeat (three or more times in a similar context: site, page kind,
  previous step, hour); your usual next page from your history's chains; routines by hour and weekday; the page's own
  main action (a form's next step, a dialog's main button); things on the page that map to a link (a date, a tracking
  number, an address); a meeting or video starting.
- **Ranking:** a strong match from your own patterns (seen at least five times, chosen seven times in ten) shows with no
  model call. Otherwise Haiku picks **one of the candidates or none** and words the chip. It can never invent an action.
- **Running:** the action vocabulary (§8). Each step is checked and retried once another way; short chains show their
  progress in the chip; anything irreversible (send, submit, post, delete, pay) shows the action and waits for **Enter**.
- **Learning:** an accepted chip strengthens its pattern; an ignored one weakens it and raises that site's threshold.

As built (October 26), Tab for actions is the user's **next move**, as Cursor's Tab is the next edit. It is one general
predictor with no code for any particular site, and no plan to read first. Longer jobs belong to the agent: Tab never
hands off to it.
- **A move** is one thing a hand does in a browser:
  - click, double-click or right-click;
  - point at something to open its menu;
  - drag (a card onto a column, a row to a new place, a slider);
  - choose an option, press a key, scroll to something, go back, open a page;
  - or fill in the fields of the form the user is in;
  - on a page drawn as pixels, any of these at a spot in the picture of it (§2.6).
- **Then:** with each move comes the one most likely after it, shown the moment the move is done. It can name an
  element that only appears after the move (a menu's item). So Tab, Tab, Tab goes as fast as the user does, one visible
  move at a time; the guess that follows replaces it if it sees better.
- **Guess:** a fast model reads the page's text and every element on it, each with an id. When the page has things to
  drag, that includes where they can be dropped. It also sees:
  - what the user just did here (clicks, choices, typing, drags, double- and right-clicks), the pages before this one
    and what they copied there, their other open tabs;
  - their profile, memory about this, their habits here, what they took and turned down from Tab on this site.
- **Checks:** every step must name an element on the page, and typed text may hold no fact that is not visible
  somewhere. Each site has its own bar (0.5 to 0.85, 0.6 to start): it rises as guesses are turned down and falls as
  they are taken.
- **Timing:** it guesses the moment the page settles after a click, a choice, a new route or a dialog opening (not after
  a fixed wait); a newer guess cancels the older one. The reply streams, and the first complete steps show while the rest
  is being written. A strong habit or the user's own details for a form show at once, before any model answers.
- **Speed:**
  - as a page opens (or, opened in a background tab, as it comes into view), the guess for its first empty field is
    asked at once, and memory warms while the page loads;
  - coming back to a tab is a new moment, with what was done in the tab just left;
  - when the pointer rests on a field, the guess for it is asked then, so the click finds it ready;
  - a press on a field starts a guess at once, and a finished sentence is answered sooner;
  - a move shows the moment its step is whole.
- **Running it:** Tab does the move, finding its element again by its role, name and surroundings if the page
  re-rendered it. Drags send the native drag events, or a press, moves and a release; a slider is set where the drag
  leaves it. A move that sends, buys or deletes waits for Enter.
- **Esc:** dismisses it; that guess isn't offered again on that page for ten minutes, and the model is told.
- **Menus that open on hover by CSS alone:** their hidden items (in a nav, header or menu bar) are listed with their
  menu, the ring goes on the menu's trigger, and the move hovers the trigger, then clicks the hidden item.
- **Saving credits:** on the Free plan, or with less than a sixth of a plan's credits left, nothing is guessed ahead of
  the user (the first field, a resting pointer, typing not yet paused, coming back to a tab); guesses come once they
  act, and Tab for text over a drawing waits for a longer pause. The popup says so.

---

## 6. Memory

Everything is in IndexedDB on the computer, **sealed**: each record is encrypted (AES-256-GCM) under a data key made
once per account, wrapped by a key the gateway derives from the account (`memory-key`), so a copy of the browser
profile is unreadable without signing in. Sites and addresses are stored only as keyed hashes. The unwrapped key lives
in memory only (the worker, `chrome.storage.session`) and is gone when the browser closes or the user signs out. Each
account has its own database. The popup shows what is kept and deletes it by site or by time. Memory stays light: an
hourly budget trims the oldest page passages first when it grows past its share of the disk, and embedding runs in
small batches with pauses.

| What | Kept |
|---|---|
| Your writing: each field's final text, with site, label, intent and time | Until deleted |
| Suggestions: shown, accepted (and how much) or ignored | Until deleted |
| Actions: clicks and navigations as (site, page kind, element role and name), and the history import | Until deleted |
| Pages you read: title, URL, time spent, main text, highlights and copies | Until deleted |
| Meetings and videos: transcript with speakers and times, sounds, notes | Until deleted |
| Voices you have named, as voice prints | Until deleted |
| Profile facts you set (name, sign-off, email) and notes you save | Until deleted |

- **Never captured:** password, payment and ID fields; blocked sites; incognito; anything while paused. Other people's
  messages (an email thread, a chat) are read live for a request and never stored.
- **History import:** `chrome.history` for the last 60 days, with each URL's visits (time, transition,
  `referringVisitId`), gives navigation chains and routines. Since October 29 none of it is searchable memory (a title
  and an address are not a page the user saw), and bookmarks are not brought in.
- **Only what the user saw:** memory's pages, and the tabs every surface is told about, are pages that were on their
  screen. A tab opened behind and never brought forward, and what the agent read through a connector for them, are not
  kept.
- **Search:** meaning (bge-small sentence embeddings, 8-bit, run in the offscreen document) fused with keywords (BM25,
  stop words left out) by reciprocal rank, filtered by site, intent and time. Pages are kept whole, split into
  passages. Nothing leaves the computer to be searched.
- **Bringing in what the user has:** history (for habits only) after the first sign-in; the Gumbo profile (name, what they
  make); settings through `chrome.storage.sync`, so a reinstall restores them; another assistant's memory, pasted on the
  welcome page, kept as notes and facts (a fact the user set is never overwritten).
- **Every surface works with an empty memory** and gets better as it fills: Tab (style, facts, recent reading and
  hearing), Ctrl+K (answers with sources, context for edits), the sidebar (search with citations).
- **Recall is measured:** a fixed set of pages, meetings and notes with known answers must come back in the top five
  (41 of 41 now, in Node and inside the extension).
- Every record has a `source`, so other apps can feed memory later.

### 6.1 Sync between computers (end-to-end encrypted)

Off until the user turns it on in the popup. Then memory is the same on every computer signed in to the account, and
the server can't read any of it.
- **The key is the user's.** They set a passphrase (or take a made-up one); PBKDF2-SHA256 (600,000 rounds, a random salt)
  turns it into a key on the computer, and HKDF makes from it the keys that seal records (AES-256-GCM), name them (an
  HMAC) and check a passphrase. The passphrase and the key never leave the computer; the key is kept sealed in memory's
  own database. A recovery note is shown before anything is made: the passphrase can't be recovered. "Start over" sets a
  new one (the synced copy is made again from that computer; the others ask for it and keep what they have).
- **What syncs:** writing, notes, the sidebar's conversations, named voices, meetings and videos, pages read. Passages
  are cut again and embeddings made on the computer a record arrives on; the logs (suggestions, actions, timings,
  failures) and the habits learned stay on their computer.
- **The server sees** per record an opaque id, a stamp (time, a random computer id, version) and the ciphertext; per
  account the key's id, salt, how it was made and a check value. The id and stamp are sealed in with each record, so the
  server can't move, re-date or invent one, deletions included. Room: 256 MB per account (`dream_limits`).
- **Merging:** each synced record has a change in a change log (database version 5), written in the same transaction
  as the record. Last write wins per record; a stamp always comes after the version it replaces, so a computer whose
  clock runs ahead doesn't win over a later edit. A deletion is a tombstone and wins or loses the same way; what the
  user forgets on one computer is forgotten on all of them. Room made by the budget is not a deletion. Notes brought in
  (bookmarks, another assistant's memory) are named by their words, so each computer's import is one set of notes.
- **When:** pulled when the browser starts and every 15 minutes; pushed in batches of a hundred when the computer is
  idle and plugged in (on battery at most every six hours, never on a low one), what the user made first; at once for
  Sync now and for forgetting; after turning sync on, the first thousand records at once and the rest when idle.
- Gateway: `memory-sync` (the key profile), `memory-sync-setup`, `-push`, `-pull`, `-reset`
  (`supabase/migrations/202610260001_memory_sync.sql`, row-level security per account).

---

## 7. Meetings and videos

Gumbo hears what plays in a tab and what you say in a call, and turns it into text on the computer. It is on by
default (the user asked for memory of everything heard), off per site or everywhere, and never on blocked sites.

- **Sources:**
  - the page's own media (`captureStream()` on video and audio elements, and the streams of web-call audio elements,
    all of a call's voices mixed), read with `MediaStreamTrackProcessor` from a copy of the track, so what plays is never
    touched; it needs no permission prompt and starts once something with sound has played for a moment and a half;
  - the whole tab (`chrome.tabCapture`), started from the toolbar, the Alt+Shift+L command or the side panel; the tab's
    sound keeps playing;
  - the mic for your side of a meeting, shown as "You" (permission is granted once on an extension page);
  - a video's own captions (`textTracks`) when it has them, since they are exact.
- **Recognition:** 16 kHz mono; Whisper (`@dream/web-ml`, on WebGPU when there is one) in live windows of 8 s with 2 s
  of overlap, merged at the seams; words become lines at a sentence end or a pause; YAMNet and CAM++ (`@dream/sound`)
  for sounds and who speaks. Name a voice once ("Speaker 2 is Sarah") and the next meeting knows it. The mic's copy of
  what the speakers played is dropped. A video's lines carry the video's own time (seeks and speed included). When the
  computer cannot keep up, quiet seconds are skipped first, then speech, and the next listen uses the smaller model.
- **What shows:** a small pill in the page (the latest line, Stop, "Not here"), a dot on the toolbar icon; when a page's
  sound cannot be heard (another site's or protected media), the pill says to press Alt+Shift+L.
- **What you get:** live captions with names in the side panel; "what did she just say?" at any moment; when it ends,
  notes (summary, decisions, action items with owners) written by the model and saved in memory, so Tab and Ctrl+K use
  them in the follow-up email; citations that jump the video to that moment (YouTube's `t=`, elsewhere `#gumbo-t=`, or a
  seek in the open tab from the side panel).
- **Rules:** a visible indicator while listening; never on blocked sites; audio is never stored, only text; only the
  snippets a request needs go to the model.

---

## 8. Act: one small vocabulary

| Action | What it does |
|---|---|
| `open(url, newTab?)` | Navigate or open a tab |
| `switchTab(id)` | Bring a tab forward |
| `click(element)` | Pointer events on the element's centre (pointerdown, mousedown, pointerup, mouseup, click) |
| `type(element, text)` | Focus, then insert as §2.4 does |
| `key(combo)` | Keyboard events (Enter, Escape, shortcuts) |
| `select(element, option)` | Choose in a select or listbox |
| `scroll(element or page, by)` | Scroll |
| `wait(condition)` | Until an element appears, the URL changes, or the page settles |
| `read(element or page)` | Text or the page model |

Targets are remembered by role, accessible name, nearby text and path, and found again on the next visit. After every
action the engine reads the page again and checks the expected change (text present, URL changed, dialog open); a
failed check is retried once another way (another target, the keyboard instead of a click), then reported. Each action
is tagged **safe** or **irreversible**; irreversible ones always wait for Enter. Page text is data, never instructions.

---

## 9. Measuring magic

### 9.1 Latency meter
Every suggestion records the time from the pause to the first ghost word, and the gateway's own `Server-Timing`
breakdown (auth, reservation, the model's first byte). The popup shows the median and the 90th percentile.

### 9.2 Accuracy meter
Moments are replayed from your own captured writing: the text before a point goes to Tab, and its suggestion is scored
against what you actually typed next (exact words, same meaning, wrong, or nothing shown). It runs on demand and costs
a fraction of a cent per moment. Every change to the prompt, the context or the checks is judged by it.

### 9.3 Action meter
Your own event log is replayed: at each step, was the chip Tab would have shown your real next step, and how often
would it have shown something wrong?

### 9.4 Failure log
Every ghost that missed the caret, insertion that did not read back, or action check that failed is logged locally with
the site and editor kind. The fix goes into the general mechanism.

---

## 10. Models (each a setting)

| Surface | Default | Gateway id |
|---|---|---|
| Tab, Ctrl+K, action ranking | Claude Haiku 5.5, thinking off, low effort | `claude-haiku-5-5` |
| Meeting notes, memory answers | Claude Haiku 5.5 | `claude-haiku-5-5` |
| Agent and sidebar chat | DeepSeek V4.1 Flash; Sonnet 5.5 or Opus 5.5 for hard jobs | `deepseek-flash`, `claude-sonnet-5-5`, `claude-opus-5-5` |

**The gateway's fast lane** (`purpose`: `tab`, `inline`, `action`, `prewarm`): Haiku with thinking off and low effort;
the session and access checks cached in memory for a minute (never past the token's expiry); the usage reservation run
alongside the model call; no request store, so no text is kept and closing the connection stops the model; output
limits down to 16 tokens, and 0 for a pre-warm; a `Server-Timing` header.

Rough heavy personal use: 500 Tab suggestions a day on Haiku with a cached prefix is about $1–2 a month.

As built (October 26), the defaults above stand (a switch to DeepSeek and Terra was made and taken back the same night).
Any model can be picked per surface in the popup, GPT-6.1 Terra (`gpt-6.1-terra`, $1 and $5, cached input $0.05) among
them once the gateway that lists it is deployed. When a quick call goes to a model other than Claude, it sends
`dream_thinking:'off'` (DeepSeek otherwise thinks at length), and no cache warm-up is sent (a call that writes nothing is
Claude's alone).

---

## 11. Architecture

```
┌──────────────────────────── Chrome ─────────────────────────────┐
│ Page (every frame)                       Side panel (React)       │
│ ┌──────────────────────────────┐        ┌──────────────────────┐ │
│ │ content script               │        │ captions · notes     │ │
│ │  fields: find, read, insert  │        │ agent · chat (later) │ │
│ │  capture: writing, actions   │        └──────────┬───────────┘ │
│ │  act: click/type/key/…       │                   │             │
│ │  UI: ghost, chips, Ctrl+K    │                   │             │
│ └──────────────┬───────────────┘                   │             │
│        ┌───────▼───────────────────────────────────▼────────┐    │
│        │ service worker: the engine                          │    │
│        │  Tab · Ctrl+K · actions · memory · learner · agent  │    │
│        │  gateway client → dream-gateway                     │    │
│        └───────────────────────┬────────────────────────────┘    │
│        offscreen document: embeddings, audio (Whisper, YAMNet)    │
└────────────────────────────────┬─────────────────────────────────┘
                                 │ HTTPS, the user's token
                    dream-gateway /ai (Anthropic, DeepSeek, …)
```

- **Manifest V3.** Permissions: `storage`, `tabs`, `scripting`, `history`, `offscreen`, `alarms`, `sidePanel`,
  `tabCapture`; host access `<all_urls>`. `debugger` is optional, asked for only for canvas editors.
- **Content script:** in every frame, a small script with no framework; its UI lives in a shadow root.
- **Service worker:** the engine. MV3 workers sleep; while work is running, traffic and a light call every 20 s keep it
  awake, and everything that matters is in IndexedDB so work resumes after a restart.
- **Offscreen document:** the embedding model and the audio pipeline (they need WebAssembly, WebGPU and workers).
- **Side panel and popup:** React (TypeScript, Vite), in Gumbo's black-and-white design.
- **Build:** `pnpm --filter @dream/extension build` produces `dist/` to load unpacked.

---

## 12. Accounts
- The extension signs in with the Gumbo account through the existing sign-in page. It opens
  `usegumbo.app/signin/?web=https://usegumbo.app/app/?ext=1&challenge=…`; Google or the emailed link returns to
  `usegumbo.app/app/?ext=1&code=…`, where a content script that runs before the page's own scripts takes the code and
  removes it from the address. The service worker exchanges it with its own PKCE verifier. The extension keeps its own
  session (never the site's, so their refresh tokens never collide) and refreshes it a minute before it expires.
- Credits and plans are the existing ones (`dream_*` tables, Stripe), so billing, gifts and limits work unchanged.

---

## 13. The sidebar agent (after the above)
The same loop as Roux, applied to the browser: the job, the page, and memory go to the model with the action vocabulary
as tools; it acts, checks and repeats until done, then says what it did with links. Irreversible actions pause for Enter
(and highlight the target on the page); limits on steps, minutes and spend; stop at any time.

The sidebar streams the way Cursor's does, built from Gumbo's own chat:
- each text delta arrives over a port and is revealed smoothly, a little behind the stream, with new words fading in;
- markdown is parsed one block at a time, so only the open block re-renders; links and citations open their page; code
  is highlighted and copyable;
- thinking shows as a shimmering "Thinking" that folds into "Thought for 4s"; each tool call is one line (an icon, a
  verb, its target) that fills in as its input streams, shimmers while it runs and opens to show details; consecutive
  reads group into one line;
- irreversible steps show a card that Enter confirms; a to-do list sits on the composer; a finished run folds into
  "Worked for 1m 05s · 12 steps";
- Stop takes the place of Send; messages sent during a run queue; the view sticks to the bottom unless you scroll up.

As built: the loop runs in the service worker (`background/agent.ts`) with `read_page`, `click`, `type`, `key`,
`select`, `scroll`, `wait`, `open` (also in a background tab), `tabs`, `switch_tab`, `close_tab`, `history`,
`reopen_tab`, `search_memory` and `todo`. Page text and memory reach the model inside `<page>` fences, and the system
prompt says such text is never an instruction. Final steps ask in a card. Limits: 40 steps, ten minutes or 50 cents a
request, then "continue". The gateway keeps no text of it (purpose `browser`).

Every message carries memory that matches it (never only when the model searches) and the user's whole browser as it
is now (`background/workspace.ts`):
- every open tab in every window, with its id, group, when it was last looked at, and what the recent ones hold;
- the tabs closed lately;
- today's trail of pages (with time spent) and searches;
- what they just copied and wrote.

Only the latest copy stays in the conversation. A tab that is asleep is read from memory without waking it.

The panel has Chat, Heard (captions and notes) and History. There is no Memory tab: memory works by itself on every
surface. Conversations are sealed in memory. In Chat each request shows its work then its answer: an "Explored" row for
reads and lookups, a row per action (icon, target, other site's icon, duration), memory cards, a live screenshot of the
page with what it touched outlined, a plan, an Allow/Deny card, then the answer with source chips, Copy, time, steps and
cost. The composer shows the page Gumbo works in; @ adds other tabs.

## 13a. Connectors (last)
Google (Gmail search, read and drafts; Calendar events and new events; Drive search; Docs and Slides read) signs in with
Chrome's own Google account (`chrome.identity`, an OAuth client made for this extension's id, given to the build as
`GUMBO_GOOGLE_CLIENT_ID`). Supabase (projects, SQL), Vercel (deployments, build logs) and Stripe (balance, charges,
customers, subscriptions, invoices, payouts) take a token the user makes and pastes in the popup; it is tried once,
then kept sealed and sent only to that service. The agent sees a service's tools only once it is connected. Writes (a
draft, an event, SQL that changes anything) ask first. An email or document the agent reads is not kept in memory (memory
is what the user saw).

---

## 14. Testing
- **Unit tests** (`tests/unit/extension`): context reading on saved pages, the suggestion checks, Ctrl+K's Markdown round
  trip and diff, the learner, the gateway's fast lane, the agent loop.
- **Headless Chromium with the unpacked extension** (`apps/extension/test/e2e`), against local test pages built from
  every editor library in §2.1 and a stand-in gateway that streams scripted replies with set delays, so tests cost
  nothing and open no windows.
- **The meters (§9)** on your own data, and a short live latency run.
