# Dream decisions

## October 26, 2026 — Gumbo for Chrome's memory syncs between computers, end-to-end encrypted

- **The user holds the key.** A passphrase they set (or a made-up one, 20 random letters and digits) becomes a key on
  the computer with PBKDF2-SHA256, 600,000 rounds and a random salt. PBKDF2 rather than Argon2: it runs in WebCrypto
  off the worker's thread with nothing to ship. The profile on the server records how the key was made, so it can move to
  Argon2id later. The passphrase never leaves the computer and is never kept; the key is kept sealed in memory's own
  database, so it is there after a restart and gone with sign-out like the rest.
- **The recovery note comes first.** The popup shows it (the passphrase, the account, how to use it on another
  computer) before anything is made, because the popup closes easily and the passphrase can't be shown again. A lost
  passphrase loses nothing: memory stays on each computer, and Start over makes the synced copy again under a new one.
- **The server only ever holds ciphertext.** Per record: an id that is an HMAC under the user's key (so one page read
  on two computers is one record, and the server can't tell what it is), a stamp (time, a random computer id, version)
  and the sealed body, store name included. The id and stamp are the AES-GCM additional data, so the server can't move a
  record, change its stamp or invent a deletion. Deletions are sealed like records, so the server can't tell them apart.
- **Last write wins per record, with tombstones.** A change's stamp is always after the version it replaces, so a
  computer whose clock runs ahead can't beat a later edit; at the same millisecond the higher computer id wins,
  everywhere the same way. The gateway keeps a version only if it is newer (the same rule in SQL), and takes an
  account's pushes one at a time under a lock, so a pull, which goes by the order records were taken in, never skips one.
- **What syncs:** writing, notes, conversations, named voices, meetings and videos, pages. Passages and embeddings are
  made again where a record arrives (smaller to send, and they follow the computer's own model). The logs and the habits
  learned stay with their computer. Forgetting on one computer forgets everywhere; the disk budget making room is not a
  deletion. Imported notes (bookmarks, another assistant's memory) are named by their words, since every computer
  imports the same ones.
- **It respects the computer.** Pull at browser start and every 15 minutes; push in batches of a hundred when the
  computer is idle and plugged in (on battery every six hours at most, never on a low one), what the user made first.
  Sync now and forgetting push at once; turning sync on sends the first thousand records at once and the rest when idle.
- **Storage:** a table, not a storage bucket: records are small once compressed, and a table gives the ordering and the
  newer-wins check in one transaction. Row-level security per account (a user can read only their own ciphertext;
  only the gateway writes), 256 MB per account in `dream_limits`.
- Tested: the crypto and merge cases in unit tests, the SQL in Postgres (PGlite), and two browser profiles end to end
  against the stand-in gateway (a page and notes cross both ways, a wrong passphrase is refused, a forgotten site is
  forgotten on both, the server holds no readable text).
- **Not deployed yet:** the migration and the gateway routes wait for the user's go-ahead. Until then the popup says
  sync isn't available.

## October 26, 2026 — Gumbo for Chrome reads your mind: Tab acts on any page, memory everywhere, the agent knows your browser

- **Tab is autocomplete for actions on every site.** One general predictor, with no code for particular apps and no plan
  shown first. Tab does what the user was about to do: text, clicks, choices, keys and pages, chained as far as the
  model is sure. When the job needs more than the page shows, the agent carries on.
- **The guess shows sooner:**
  - it is asked when the page settles after what the user did, not after a fixed wait;
  - the older request is cancelled;
  - the reply streams, and its first complete steps show while the rest is still being written (the model writes its
    confidence and label first).
- **What it knows:** what the user did just before, in other tabs: the pages, and what they copied (kept in session
  storage, gone when the browser closes). Also their other open tabs, memory, habits, and what they turned down.
- **Turned-down guesses:** a guess turned down on a page isn't offered there again for ten minutes. Each site's bar
  moves with what the user takes and turns down (0.5 to 0.85).
- **Ctrl+K** opens anywhere, offers what the user most likely wants, and can do things in the page. Keys typed while
  its card loads are held and handed over: before this, they reached the page, where they could replace the selection.
- **Memory is automatic everywhere** (Tab, Ctrl+K, the agent), never left to the model's choice. The Memory tab is gone:
  the user wanted memory to just work, not to be browsed.
- **On disk:** records of 512 bytes or more are compressed before sealing. When room runs short, the pages used least
  recently go first, and pages memory keeps bringing up are kept longest.
- **The agent knows the browser the way Cursor knows a codebase.** Each message carries every open tab in every window
  (id, group, when last looked at, what the recent ones hold), the tabs closed lately, today's trail of pages and
  searches, and what the user just copied and wrote. Tabs on sites where Gumbo is off show only as that. New tools:
  `history` (searches visits) and `reopen_tab` (brings back a closed tab). Older copies of the browser are dropped
  from the conversation, so it doesn't grow with every message.
- **Live captions:** words not yet in a finished line are shown at once, in a lighter shade, in the pill and the
  side panel. Before, a line waited for its sentence to end and for Whisper's 8-second window. On a GPU, every 1.5
  seconds the sound since the last settled word (up to 14 seconds) is also heard on its own and shown as a guess.
  Real lines replace the guesses. The guess pass runs only while Whisper keeps up and the computer is plugged in.
  It turns itself off for the session if one guess takes over 1.2 seconds.
- **Battery:** work nobody is waiting for (embedding what memory kept, the sounds around speech, caption guesses) rests
  six times longer on battery, and waits for the charger below a fifth. Searches and caption lines always run.
  Embedding, Whisper and the sound models already run in Web Workers.
- **Syncing across computers** with end-to-end encryption and a key the user holds came next (the entry above).
- **Like Cursor's Tab:**
  - **Asking ahead:** when the pointer rests on a field for 150 ms, the guess for "the cursor is in that field" is asked
    then. The engine shares it with the identical guess the click makes, so the click finds it ready.
  - **Learning from you:** the last guesses you took and turned down on each site go with the next guess, as examples
    of this person.
  - **Less waiting:**
    - a guess starts on mouse-down;
    - a finished sentence is answered after 0.45 s instead of 1.3 s;
    - the page settles for a beat, not up to 1.5 s, after a click into a field;
    - memory waits at most 0.12 s;
    - a one-step guess shows the moment its step is whole.
- **Measured live** (the deployed gateway's code with the real model, `test/e2e/live.spec.ts`, GUMBO_LIVE=1; 11 of 11
  pass; $0.09 spent in all):
  - with the pointer resting on the field, the guess (street and city split from a copied address) showed 10 ms after
    the click;
  - a Google search from copied notes showed in 0.17 s;
  - a cold click with no rest first took 1.9 s, and a reply's Send 1.7 s after typing stopped (the model's first token
    is about 0.6 s at the median);
  - on pages with no obvious next step (Wikipedia, GitHub, Hacker News, MDN) it rightly offers nothing.
  - Ctrl+K explained a Wikipedia paragraph plainly, rewrote a message formally, and opened with fitting ideas.
  - The agent found the tab about a drink and switched to it, reopened a closed tab, read a tab without leaving the
    current one, and wrote and sent a reply after Allow.
- **The agent's prompt was wrong:** with Haiku it typed the reply, then asked in words whether to send. The prompt now
  says the tool itself asks (the Allow card), so it clicks Send when told to.
- **The gateway** was deployed (version 78) with the agent's no-text lane and the old answer formats.
- **Later the same day the user set Tab's scope:** short bits, not chains. Tab is the next move: where you will click,
  what you will fill in, what you will drag. The agent does chains.
  - The plan of up to eight steps and the hand-off to the agent ("more") are gone. Each move is one action, or the
    fields of one form.
  - Each move comes with "then", the likely next move, shown the moment this one is done. Tab, Tab, Tab is one visible
    move at a time; live, the next move showed 210 ms after Tab.
  - Moves now cover what a hand does: double-click, right-click, hover, drag (to an element or by an offset, with native
    drag events or mouse ones, sliders set), scroll to something, and back.
  - The page model lists things to drag and where they can be dropped, and the user's own drags, double-clicks and
    right-clicks are context for the next guess.
  - A background "work it out first" layer for Tab (the agent preparing values before Tab) was started and reverted
    before commit: that is agent territory.
- **Tab has the agent's memory:**
  - the same snapshot of the browser (every tab with what the recent ones hold, closed tabs, today's pages and searches,
    copies, writing), a little shorter and kept for 3 s between guesses;
  - memory searched as deep as the agent's (five passages);
  - the words of the tab the user just left, read live (its start and its end, where a chat's newest answer is; 0.35 s
    at most), which also count as known facts.
- **Tab works in every frame:** a lesson, quiz or editor embedded from another site is guessed about on its own, with
  the page around it named. A frame asks only once the user has pressed, focused or typed in it, so ads never cost a
  call. A move hides when focus leaves its frame.
- **Live** (the user's case: an assistant chat in one tab, a course's quiz in a cross-site frame in the other, nothing
  copied): clicking the quiz's box offered the chat's Spanish answer 0.26 s after the click, Tab typed it, and "Check
  answer" was the next move. All live runs so far: $0.10.
- **Esc now stops the guess still on its way,** and that move stays away on that page for ten minutes: before, a late
  answer could bring it straight back.
- **Speed and memory, measured live:**
  - **Tab asks ahead at three more moments:** for the first empty field 0.8 s after a page opens; for the next field
    when the user moves into one; and while they type (as a sentence ends, and every 1.5 s). At the pause, a move asked
    ahead that types nothing into the field (the send, the search) shows at once.
  - **Results:** a cold click on a field a few seconds after the page opened showed its move in 0.02 s. Send after a
    reply shows 0.77 s after typing stops (was 1.6 s). The quiz in a frame showed in 0.26 s (a pointer resting on a
    field now counts as working in that frame).
  - **Tab's memory follows the moment:** each guess waits briefly for the search for its own moment (0.15 s, or 0.7 s
    when asked ahead). An answer made while that search was still running is not reused. Live, trip notes read and
    closed earlier filled a check-in form's flight number and date, previewed in both fields, in 0.13 s.
  - **Ctrl+K never waits long on memory:** its search starts as the card opens. At Enter the question's own search gets
    0.15 s, and up to 1.5 s only when nothing is in hand yet. Ctrl+K also gets the agent's view of the browser and the
    tab just left, taken once per card and kept inside the warmed prompt. First words come about 1.1 s after Enter.
    Asked about a flight it answered from the notes.
  - **Ctrl+K reads, not rewrites:** text selected on a page, with "explain" or "simplify", is answered, not rewritten.
  - **Moves are marked on the page:** every element a move touches is outlined (a drag's drop dashed), and the words it
    would type show faintly in each empty field it fills.
- **Pages drawn as pixels, and the first second:**
  - **Tab and Ctrl+K see drawn pages:** a board, a whiteboard, a design tool, a map or a document drawn on a canvas has
    no elements to read. When canvases cover more than a fifth of the view, a picture of the view goes with the guess
    (`chrome.tabs.captureVisibleTab`, at most 1280 px wide, one shared within 0.7 s). A move can point at a spot
    (`"at":[x,y]`, and `"to_at"` for where a drag ends). Tab clicks, double-clicks, right-clicks, drags and types there
    with real pointer events, and its spots show as dots. Typing that lands in an editor's own input frame is handed to
    that frame. A guess about a drawn page is never reused, since the drawing changes while the elements don't.
  - **Real input, opt-in:** a page that ignores synthetic events can get real ones through `chrome.debugger`
    (`Input.dispatchMouseEvent`, `Input.insertText`). It is a link in the popup that asks for the optional permission,
    and Chrome shows its bar while it is attached.
  - **Live on a drawn board:** after the user picked a note by hand, Tab offered "Drag Write tests into Done" with
    points from the picture, and Tab moved it. On Excalidraw's empty canvas it offered nothing, which is right.
    Excalidraw keeps Ctrl+K for itself when nothing is selected, as any site's own Ctrl+K is kept.
  - **The first second:** the first empty field's guess is asked the moment the page is ready (it waited 0.8 s). A page
    opened in a background tab is guessed when it comes into view, and coming back to a tab is a moment too. Memory
    warms as a page starts loading. A guess made before a copy is not reused after it. Live: a click 0.5 s after the
    page opened showed its move 0.8 to 1.0 s later, usually (1.1 to 1.3 s after the page opened: about 0.3 s for memory,
    0.6 s for the model's first word, 0.2 s for the first whole step). Before, the test harness loaded the gateway's
    code on the first call, which made first guesses look 1 to 1.5 s slower than they are.
- **Google Docs, and editors that type through a hidden box:**
  - **How Docs works now:** its words are drawn on canvases, and the keys go to an EditContext ("Document content")
    inside a frame one pixel tall that sits at the caret. That box holds only "_". Ctrl+K pressed there used to open
    its card inside the one-pixel frame (invisible), and asked about an "empty field".
  - **Ctrl+K:** a field nobody sees (the box, or the frame it is in, a line or less; Monaco and CodeMirror excepted)
    hands Ctrl+K to the page itself. The card opens below the caret. The picture is taken as Ctrl+K is pressed, while
    the selection is still blue (it fades once the card has the focus), and the model is told highlighted words are the
    selection. A kept edit goes back in through the box, once, as a paste the editor takes. It can't be read back, so it
    is never tried twice. Live, on a public Doc: "explain this" on a double-clicked word explained that word in context
    (it had said nothing was selected).
  - **Tab for text over a drawing:** at a pause in typing, the engine reads a picture with the caret drawn in red, with
    what was just typed so the words meet it exactly (the same overlap checks as any Tab suggestion, except the facts
    guard, since the facts are in the picture). The words show under the caret, and Tab types them through the box.
    Live on a stand-in document: "First, we will open the beta to" got " a small group of users", 1.0 to 1.5 s after
    the pause (0.65 s of it the pause). Not tried on a real Doc yet, since editing needs a signed-in account.
- **Menus that open on hover by CSS alone:** no event a page sends opens them, so Tab never saw their items. Hidden
  items of a nav, header or menu bar are now listed with their menu ("in the Products menu, shown on hover"), the ring
  goes on the menu's trigger, and running the move hovers the trigger, then clicks the hidden item (a click works on it).
- **Models (later the same night, at the user's request):** DeepSeek V4.1 Flash replaces Haiku 5.5 for Tab, Ctrl+K,
  next moves and notes; GPT-6.1 Terra (released that day, made for computer use) runs the agent. Quick calls tell
  DeepSeek not to think, and cache warm-ups go only to Claude. Models nobody picked follow the new defaults. Not yet
  measured live: this computer has only an Anthropic key, and Terra needs the gateway deployed. DeepSeek's list price is
  above Haiku 5.5's, and its speed for Tab is the open question.
- **Saving credits:** on the Free plan, or on any plan with less than a sixth of its credits left, Tab guesses nothing
  ahead of the user: not the first field as a page opens, not a field the pointer rests on, not while they type, not on
  coming back to a tab. It still guesses the moment they act. Tab for text over a drawing (a picture each time) waits
  for a longer pause. The popup says so. The plan and credits come from the gateway's billing route, every ten minutes.

## October 25, 2026 — Gumbo for Chrome's sidebar agent, and connectors last

- The agent is one loop, as Roux is: the message joins the conversation, the model (the Agent setting, DeepSeek V4.1 Flash by default) gets the browser's tools, the tools run in the user's tabs through the same checked action vocabulary Tab's chips use, results go back, until it answers without a tool. A final step (send, post, buy, delete, submit) asks in a card; a no is passed back so the model says what is ready instead. Limits: 40 steps, ten minutes, 50 cents per request, then "continue".
- Page text, memory and connector results reach the model inside `<page>` fences, and the system prompt says such text is never an instruction. Hidden text is not page text (innerText). Older page reads are left out of the conversation after the latest two, which keeps steps small.
- The gateway gets a `browser` purpose: it thinks as an agent does but, like Tab's fast lane, keeps no request text, so pages the agent reads stay off the server. Conversations are sealed in the extension's memory (database version 3 adds `chats`).
- The panel streams as Cursor's does, from the editor's chat: the whole turn is sent at most every 40 ms; text is revealed a little each frame (faster when far behind); thinking folds into "Thought for Ns"; each tool is one row filled in from its streamed arguments (a tolerant parser closes what has arrived); more than three in a row fold into "N steps"; a to-do list; "Worked for…"; Stop (or Esc); messages sent meanwhile wait their turn; it sticks to the bottom unless scrolled up.
- Later the same day the user found the first sidebar "too simple". Redone after looking at how Cursor, ChatGPT's agent, Comet and Dia show work: each request is its work, then its answer. Reading and lookups fold into one "Explored" row with the sites' icons (Cursor folds exploration the same way); each click, keystroke or write has its own row with an icon, what it touched, where (a site icon only when it is another site) and how long; thinking folds into "Thought for 4s"; memory the agent used shows as cards (kind, title, when, the matching words); a live look at the page (a small screenshot after each step, never kept or sent, with what it touched outlined) as ChatGPT's agent shows its browser; a step that can't be undone asks in a card (Enter allows, Esc denies); a plan ticks off with a bar; the answer ends with source chips, Copy, how long it worked, its steps and its cost. The composer shows the page Gumbo works in and takes other tabs with @ (as Dia does); before the first message the panel shows what it sees and suggests questions from memory ("What was decided in …", "Remind me what … said").
- (Removed on October 26: memory now works by itself on every surface.) Memory got its own tab: one box searches everything kept (by meaning and words, as every surface does), filters by kind, marks the matching words, and with nothing typed lists what was kept lately, day by day; any result can become a question for the agent. The panel warms memory and its embedding model as it opens, so the first search answers at once. Gumbo's own pages (its welcome page) are no longer remembered.
- Connectors come last: Google through Chrome's own account (`chrome.identity`; the build needs `GUMBO_GOOGLE_CLIENT_ID`, an OAuth client for this extension's id), Supabase, Vercel and Stripe through a token the user pastes, tried once and kept sealed. Their tools show only once connected; writes ask first; an email or document read is remembered like a page.

## October 25, 2026 — Gumbo for Chrome hears what plays, and remembers it

- Listening is on by default (the user asked for memory of everything heard), off per site or everywhere, never on blocked sites or in incognito, with a pill in the page while it listens (the latest line, Stop, "Not here") and a dot on the toolbar icon. The audio itself is never kept, only the words.
- A page's own sound is tapped from a copy of its track (`captureStream()` on video and audio elements, a call's streams mixed), read with `MediaStreamTrackProcessor`, so nothing the page plays is touched and no permission prompt is needed. Sound that can't be heard that way (another site's or protected media comes out as digital silence) gets a hint to press Alt+Shift+L, which hears the whole tab through `tabCapture` and plays it back. A video's own captions are used instead of Whisper when it has them.
- In the offscreen document: Whisper in 8-second windows with 2 seconds of overlap; words become lines at a sentence end, a pause of 0.9 s or 18 s; who said it from a CAM++ voice fingerprint matched against voices the user named (0.6) and this session's voices (0.55); YAMNet sounds every 10 s. The microphone joins only in calls once allowed, as "You", and its copy of what the speakers played is dropped (a held line that the call's feed also said). A video's lines carry the video's own time, through seeks and speed changes, so citations jump to the moment (YouTube's `t=`, elsewhere `#gumbo-t=`, or a seek in the open tab from the side panel).
- When Whisper falls behind, quiet seconds are skipped first, then speech once it is over 8 pushes behind (the skipped time is kept so later times stay right), and the next listen uses the smaller model. A page that went away silently stops being heard after 90 s. Starting is atomic: if memory cannot keep the recording, nothing starts, and that media is tried again a minute later rather than on every scan.
- When it ends, Haiku writes notes (summary, decisions, to-dos with owners, key points with times) for a meeting with a minute of speech or a video of a few minutes; they are kept with it. Speakers can be named in the side panel, during or after; the voice print is kept for next time.
- Tested end to end in headless Chromium with a stand-in for Whisper (a page's audio, a call, a site turned off, a moment link, notes and naming in the side panel); the real models run on the Gettysburg Address with GUMBO_REAL_AUDIO=1 (word error rate, speakers, caption lag). A test profile must sit on a short path: past Windows' 260 characters IndexedDB cannot open.

## October 25, 2026 — Memory that finds things by meaning, and what the user already has

- Memory search runs in an offscreen document (it outlives the service worker's naps): everything remembered (passages of pages read, the user's writing with what it replied to, notes, meetings) is opened once and indexed two ways, keywords (BM25 without filler words) and meaning (sentence embeddings made on the computer), fused by rank. A question about what the user said leans toward their writing; one about what someone said, toward meetings.
- The embedding model ships inside the extension (bge-small-en-v1.5, 8-bit, 34 MB, pinned and checked by hash): on the recall test (41 questions asked in other words than the ones stored, with distractors) it put the answer in the top five 41 times, against 40 for MiniLM and 37 for keywords alone. Inside the extension, 23 of 23 page questions came back in the top five. Vectors are 8-bit and sealed like everything else; new memory is embedded in batches of sixteen with rests between them.
- The offscreen document has no chrome.storage, so each request from the worker carries the account and its unwrapped memory key, kept in memory only there as in the worker.
- What the user already has comes in: Chrome history and bookmarks (since Phase 5), the Gumbo profile at sign-in, settings through Chrome sync (a reinstall has them back), and another assistant's memory pasted on the welcome page, kept as notes, with its facts (name, sign-off, email) filled in only where the user set none.

## October 25, 2026 — Tab for actions: the user's own habits, offered as a chip

- Every click on something actionable (by its role, name and the words around it, never what was typed) and every page a tab opens is a step. The learner counts which step follows which on the same kind of page (an address with its ids replaced, so every project's logs page is one kind), by hour, with habits fading over a month. It is sealed in memory with everything else.
- When a page settles, and a moment after each click, the usual next step is offered as a chip near what was just clicked. A habit seen five times and taken seven times in ten is offered with no model asked; a weaker one is offered only if Haiku picks it from the known candidates (it cannot invent one). Tab runs it (a click, checked and retried another way, or the page it opens); a final step (send, delete, pay…) asks for Enter; Esc dismisses. No chip while a field has the focus or a text suggestion shows.
- Chrome's last 60 days of history (links followed between pages, typed addresses by hour) teach the learner on the first sign-in, and titles, addresses and bookmarks become searchable memory, in idle-time batches.
- The action meter replays the user's own steps; on the test habit it showed the next step and was right more than 80% of the time. Package tracking numbers in formats that cannot be anything else become "Track package".

## October 25, 2026 — Ctrl+K: edit, ask and act in place

- Ctrl+K (Alt+K on sites where the user keeps the site's own) opens only in a field or over selected text; otherwise the site's shortcut works as before. The selection is saved before anything takes the focus.
- The card is an extension page in a frame inside Gumbo's closed shadow root, paired with its content script through the service worker by a session id only they know: the page never sees what is typed in it, and its own shortcuts (Gmail's single keys) never fire while typing there.
- One model call names its mode on the first line: EDIT (only the new text), ANSWER (short, citing memory items by number, returned as links), ACT (one JSON object turned into a prefilled Google Calendar event, a mail, map or web search, a link, or a local note: no connector needed). The cache is warmed with the page, field and selection while the instruction is typed.
- An edit streams as old text struck through above the new and becomes a word diff when done. Enter puts the selection back, checks it still holds the same text (or finds it again by its text), replaces it with the field's own undo, and reads it back; Esc changes nothing and restores focus and selection. Rich text goes to the model as light Markdown and comes back as HTML (a paste for editor libraries, insertHTML for a plain editable element), so bold stays bold.
- Checked live on Haiku 5.5: formal rewrite, shortening, an answer, a calendar event, a reply written from nothing, a translation and a mail search each came back in the right mode and clean.

## October 25, 2026 — Tab for text, and memory sealed on the computer

- Tab asks after a pause (30 ms after a word ends, 120 ms inside one; longer on sites where suggestions are ignored), shows the first whole word as it streams, keeps a suggestion through matching keystrokes and Backspace with no new request, and stops the model when a sentence ends or when the request is no longer wanted. Tab takes all, Ctrl+→ a word, Esc dismisses; Tab is the page's again when nothing shows.
- Two predictions run at once and only the words both begin with are shown; they stop when they part. On the development writing set (36 samples, 60 moments, Haiku 5.5) this took "right when shown" from 25% to 43% at a 62% show rate, the first word right 68% of the time. A single Sonnet 5.5 prediction was 32% right with the first word at about a second, too slow for Tab. Numbers on the user's own writing come from the popup's check.
- The model restates the word at the caret before continuing (it finishes a half-typed word, and its own spacing says where the next word starts), and checks in code drop preambles, notes about the task, echoes, overlap with the text after the caret, other scripts, and any number, date, name or link the user cannot see.
- Memory is sealed: every record is AES-256-GCM under a data key made once per account, stored wrapped by a key the gateway derives from the account (memory-key, from DREAM_MEMORY_SECRET; a key in the extension's own storage stands in until that is deployed, then the data key is re-wrapped). Sites and addresses are stored only as keyed hashes; the unwrapped key lives in memory only. Each account on a computer has its own database.
- Memory stays within 2 GB (or a fifth of Chrome's quota): logs are capped and the pages read longest ago go first, hourly, only while the computer is idle.
- The gateway gets a Groq route (`groq-fast`, Llama 3.3 70B on its existing key) for Tab if the first word through the deployed fast lane stays above half a second.

## October 25, 2026 — Gumbo for Chrome's field engine: one engine for every editor

- Fields are found and read with no code for any one site: inputs, textareas, contenteditable from any framework, open shadow roots, every frame, and editors driven by Chrome's EditContext (Monaco). Passwords, card numbers, one-time codes, login forms and payment frames are never fields.
- Ghost text is drawn on the line box of the caret in the field's own font, wrapping at the field's own edges; editors that wrap by their own rule (Monaco) get a one-line ghost and a chip when it would wrap. The test that holds it: on every editor library (textarea, input, contenteditable, a scaled field, shadow DOM, right-to-left, ProseMirror, Lexical, Slate, Draft.js, Quill, CodeMirror 6, CKEditor 5, TinyMCE, Monaco) the ink of the ghost and of the text after accepting must match within a pixel.
- Insertion tries the browser's insertText (the field's own undo), then setRangeText, beforeinput and a paste, reading the field back each time; EditContext editors get a paste first, because Monaco undoes a paste in one step but splits typed text at word boundaries. Ctrl+Z after accepting undoes it as each editor undoes typing.
- Actions (click, type, key, select, scroll, wait, read) find their target by name, role and the words in its row, are checked afterwards (the page, the address or a value changed; a click focusing its own button is not a change) and retried another way once. Sending, posting, removing, paying and the like are held until confirmed.

## October 25, 2026 — Gumbo for Chrome's foundation: its own sign-in, and a fast lane in the gateway

- The extension signs in through the existing sign-in page with its own PKCE verifier and returns to usegumbo.app/app/?ext=1, the address Supabase already allows; a content script that runs before the web app takes the code out of the address and hands it over. No change to the site or to Supabase, and the extension keeps its own session, so its refresh token never collides with the site's.
- The gateway has a fast lane for the extension's quick calls (`purpose` tab, inline, action, prewarm): thinking off at low effort, no request store (no text kept, and closing the connection stops the model), the usage reservation running alongside the model call, output limits down to 16 tokens (0 to warm the cache), and only the cache points the client marks. A session let in during the last minute is let in again without the three database round trips. Every /ai answer carries Server-Timing (auth, reserve, provider) for the extension's latency meter.

## October 25, 2026 — Gumbo for Chrome: Tab and Ctrl+K first, everything local except the AI

- A Chrome extension (`apps/extension`, spec in its SPEC.md) puts Gumbo in every site: Tab finishes what you type and offers your next step, Ctrl+K edits, answers, writes and acts in place, memory keeps what you read, write and hear, and an agent comes last.
- Tab and Ctrl+K come first and must feel like magic on every site. There is no code for one site: general readers find a field's intent, the conversation above it and the document around it, and one insertion engine is tested against every major editor library. "Perfect" is measured: the mechanics never fail, and what shows is right, scored on the user's own typing.
- Everything runs and stays on the computer except model calls. For the extension's requests the gateway keeps no text, only the id, status and cost.
- Meetings and videos are heard on the computer (Whisper, YAMNet, CAM++), and their notes feed Tab and Ctrl+K.
- Not in this build: connectors, capture of other desktop apps, the website. The video editor at /app stays.

## October 18, 2026 — Onboarding, plans and the welcome to a plan, after Claude's

- The first time Gumbo opens on a computer it shows Claude-style onboarding, one question per screen: welcome, account (or "Skip for now": editing by hand needs none), what to call you, what you make, how much you have edited, how you found Gumbo, the plans (Free to carry on with), and starter requests fitted to the answers. Computers that saw the old welcome skip it, and so do test runs (DREAM_HEADLESS) unless DREAM_ONBOARDING asks for it.
- The name and what you make go into Settings > Profile, which the agent already reads with every request. All the answers go to the account (`dream_profiles`, gateway `profile`), so a second computer skips the questions. Answers given before sign-in wait locally and are sent at sign-in. Privacy says so.
- The plans show as Claude's do: Free (while it is yours), Pro, and Max with a 5x/20x switch. Moving between paid plans still goes through Stripe's confirm page, which starts the change right away and charges only the difference.
- The welcome to a plan opens when the account's plan actually goes up, not when Stripe's window says "subscribed". So it also covers Pro to Max through the portal, and it waits for the webhook. The first plan a computer sees for an account is only remembered. A first purchase gets three screens (what's yours, three habits that save credits, starter requests); a bigger plan gets the first screen only.
- Public sources describe Claude's signup and plan screens but not its post-purchase screen; that screen follows Claude's pattern, not a documented copy.

## October 9, 2026 — Opus orchestrates, Haiku works; every message is routed

- Every message is a new request. The "Continue saved request" option and the resume card are gone. After a stop, the router decides whether a message continues the stopped request (`continue`) or starts a new one. A request for something to read (a script, ideas, feedback) is a reply, not an edit.
- Haiku alone is the default working mode. Opus is used only to orchestrate multi-part creative work. A request can switch between the two modes at most twice, carrying a written handoff each time.
- The Opus lead does no work. It cannot inspect, write, run, publish or propose file changes. Haiku research workers report findings, Haiku build workers implement, and a Haiku review worker checks layout against a checklist. Opus consultations and Opus replies have no tools. The lead runs at medium effort.
- The cost driver this addresses: in the October 9 Minecraft run, Opus was 98% of a $0.97 cost because it explored files itself.
- The stream shows the models' own progress notes, including Opus update-display thinking blocks, which hold notes only, never reasoning. Worker activity nests under its task. Every finished request ends with the agent's short recap.
- The editor's composer starts at two lines.

## October 7, 2026 — Prompt-first desktop and computer files

This entry supersedes earlier editor-first and mandatory-beta-account decisions for the desktop experience.

- Home is the default fresh-launch surface. Project creation uses a stable request-derived folder identifier and a prompt-derived editable display name. New imports are copied; old linked projects are not silently collected.

- First-draft readiness is persisted independently of the current clip count. First generation hides the AI timeline; subsequent AI edits retain a seek/select timeline. Full gestures remain in manual mode.

- One project engine, composition and undo history serve both workspaces. CapCut's layout and core interactions inform manual mode; advanced masks, tracking, speed curves and keyframe authoring are outside this revision.

- Anonymous authenticated sessions replace the desktop login requirement. Existing account/session compatibility, suspension, usage limits and administrator checks remain in place.

- Main-process file grants govern external filesystem access. Whole-computer access is an explicit local grant subject to OS restrictions. Existing-file operations need an immutable reviewed proposal. Timeline undo does not undo external files.

- A first edit waits for proxy/thumbnail/playback-audio readiness, not optional waveform/transcription/vision/audio-feature completion. This prevents optional analysis from blocking creation.

- Desktop is local-first: SQLite owns projects; Supabase owns accounts, AI usage, shares, and server secrets.

- Supabase Edge Functions host the authenticated AI gateway so the supplied Claude credential can live in Supabase secret storage.

- A committed op batch is immutable; batches from the same turn form one undoable action.

- Word anchors identify a clip occurrence as well as a source word.

- The UI is packaged locally; it never loads a hosted editor.

- The source screenshot is a design reference, not synthetic project footage.

- Model-dependent stages report missing runtimes/models honestly and remain resumable.

- Structural/build reviews use bounded rendered evidence from a saved version, followed by at most one repair pass and a second review. Audio timing data is not described as an audio listening test.

- Routine AI prompts contain a compact catalog. Models obtain exact source words through project-scoped local search/read tools, allowing long sources without uploading their full transcripts in every request.

- Rendered video uses frame extraction through Remotion OffthreadVideo; final MP4s declare BT.709. Color-fidelity fixtures must declare their actual input matrix rather than relying on ambiguous decoder defaults.

- Long-project engine: retain lexical retrieval with model-expanded queries; no new embedding runtime is bundled. Exact IDs, revisioned source reads and explicit user provenance take precedence over generated summaries.

- Routing separates requested mutations from requested approval. Director consultation does not itself request a plan or approval. A read-only route can hand work back to the executor in the same turn.

- Adaptive Sonnet effort is low for isolated exact edits, medium for ordinary implementation and high for difficult work or substantive repeated failures. Opus supplies medium/high targeted direction. Missing resources and account failures do not trigger creative escalation.

- Source-backed project decisions quote actual user messages. A model's design recommendation cannot be promoted to a user requirement. Superseding a decision requires the same scope and preserves its source history.

- SQLite content blobs are compressed and checksum verified. Execution checkpoints reference immutable journal scopes; compaction rotates the active scope while preserving archived results and durable tool receipts. Timeline deltas describe actual documents, with canonical integrity hashes and at most 49 deltas between full checkpoints.

- Reusable visual modules are pinned by content hash. Parameter revisions reuse all module hashes. Exact patches require matching draft/module revisions and one unambiguous match; generated modules remain isolated from Node, external packages and the filesystem.

- Desktop history and library browsing are paginated. State updates carry revision/sequence information and document deltas; missing update sequences trigger a fresh snapshot. Playback reads only source words used by the current timeline.

- The disposable visual cache has a 5 GiB target; recent ten-minute leases can temporarily exceed it. Cache cleanup never deletes retained project media, module source, undo history or interrupted requests.

- Large timeline validation allows a 32 MiB document now that storage and transport use deltas. This is a processing bound, not a guarantee that arbitrary projects up to that size meet the measured latency targets.

- Source understanding is a separate resumable background queue; it never blocks local playback or mutates the timeline. Normal source windows cover six seconds with a half-second look-behind, approximately 2 fps and at most 16 resized images. Uncertain temporal actions may trigger up to two 3.75-second motion inspections at approximately 4 fps. A source-frame tool also supports direct inspection before timeline placement.

- Visual observations preserve absolute source times, actual supplied frame hashes, confidence, uncertainty and denser refinement evidence. Speech is contextual evidence and cannot prove a visual event. Model descriptions are not face identities, exhaustive playback or audio-listening proof.

- Hierarchical narrative summaries reference saved observation/summary nodes; the latest-window description is not presented as the whole-video summary. Source observations and their searchable index survive project collection through the existing SQLite backup path.

- Sampled frames and transcript excerpts are sent through the existing account-gated provider gateway. Missing authentication, quota or uncertain network outcomes leave the scan resumable and its completed observations available.

- Manual editing and AI editing use the same immutable timeline versions, source assets, generation library and grouped undo engine. Mode switching does not translate to a second project format or fork the project. Manual mutation controls pause while an AI turn is active.

- OpenCut Classic's MIT-licensed interaction algorithms are pinned and vendored with notices. Dream owns the UI and adapters; the upstream Rust rewrite is not substituted for the existing renderer or database.

- Manual requests use frame-precise timing. Automatic speech snapping only applies to timing operations on the clips actually being changed, never unrelated pre-existing manual cuts.

- Optional track settings store names, visibility, mute and locks. Locks are enforced at the shared operation boundary. Free manual layers opt into content-derived duration; legacy timelines retain their previous primary-track duration behavior until this feature is used. An explicit minimum duration supports fixed-length canvases.

- Project schema revision 9 marks manual-timeline feature compatibility so older binaries reject newer project features rather than silently dropping them.


## Reliability and workspace revision — October 7, 2026

- Keep existing Sonnet/Opus/Haiku routing and Groq speech. Codex is the reference for plan/progress presentation, not a new provider.
- Thinking signatures carry exact-prefix provenance. Provider-session epochs separate changed prompts/tools/models and compacted messages while local exchanges remain append-only.
- A server-side request/result record owns one provider generation and usage reservation. Subscriber loss does not cancel it; result recovery and explicit cancellation are separate authenticated operations. Results expire after 24 hours and expired records are pruned during request claims.
- Tasks are a dock above the composer; public commentary and actual actions form the chronological conversation. Full-document plan saves are deterministic local operations with revision-checked approval.
- Media readiness is capability-based. Compatible original audio/video can play before collection, normalized audio, speech, and visual context complete. Legacy observer/model jobs no longer gate the current pipeline.
- Editable export uses stable track identities, independent overlap lanes, linked stereo audio, shared preview/export gain envelopes, and isolated rendered graphics when interchange cannot represent an effect. Manual UI is disabled while shared project/timeline code is retained.
## October 8, 2026 — General code agent

One creative agent uses a stable general capability catalogue. It authors workspace files and installs compatible local packages; successful command receipts gate atomic publication. The old editing/generation catalogue remains only in historical compatibility code. Source snapshots and dependency locks follow timeline undo/redo. Public progress and actual file/process/media events share stable IDs and monotonic revisions; private reasoning signatures are excluded from the UI.

Automatic execution uses Windows AppContainer plus Job Object supervision. Node 24.19.0 requires the upstream libuv #5181 pipe-namespace backport; the pinned Python distribution includes an AppContainer temporary-directory ACL adapter. These changes address general runtime compatibility, not individual creative recipes. The packaged environment must pass native qualification before release. No new execution, package-install or spending approval dialogs are introduced. Existing file grants and account limits still apply.

Opus executes subjective/complex work directly; Sonnet executes exact local work. Execution uses an executor profile even after plan approval. Media metrics and sampled frames remain distinct from listening/continuous-motion evidence. Runtime acceptance and product acceptance are reported separately.

## October 9, 2026 — Opus leads, Haiku executes

_Partly replaced on October 11, 2026 by "One agent owns the edit": the lead, its relay to workers and the integration task are gone. The loop limits, commands that never publish, retries and migrations still hold._

This entry supersedes earlier statements that Sonnet executes or that Opus executes subjective work directly.

- Haiku 5.5 completes simple exact edits and questions alone. Opus 5.5 leads all creative, multi-part and approved-plan work: it inspects, decides, delegates to Haiku workers through `delegate`, verifies and finishes. The lead has no write or command tools; it may publish what workers prepared or confirm no change is needed. Sonnet is not used by the engine.
- Parallel workers declare disjoint write scopes and never publish; one integration task owns `project.json`. Publication restores the workspace from the published snapshot, so concurrent publication would discard other workers' drafts.
- The agent loop is bounded (60 lead / 80 other model calls, two text nudges) and reports a blocker instead of looping. Completion requires a publication of the current head in the phase; evidence bookkeeping and task lists are reconciled automatically rather than rejecting `finish`.
- Commands never publish. Scenes may reference workspace scripts and stylesheets, which publication inlines.
- Context targets are 90K tokens for Haiku and 180K for Opus. Compaction requires a measured overrun and is sticky (stored prefix, append-only afterwards) to preserve prompt caching and thinking-block bindings. Retained exact reads are bounded to 40% of the target.
- Inference retries unconfirmed outcomes after cancelling them server-side (up to three times). Generations have no side effects; tools execute only after a complete response is saved.
- Effort is fixed per role for a conversation. Tools and system prompts use a one-hour cache breakpoint; worker system prompts are identical across tasks.
- Migrations are idempotent.
- Chat never renders (October 8 rule, reaffirmed after a brief stills experiment): published code appears in the live player immediately and only Export renders. Layout robustness comes from authoring rules (relative sizing, fit-to-box text, flex/grid layout) and source review by the lead.
- Approved plans run in one continuing lead conversation rather than a new conversation per step (per-step cache writes roughly halved in live measurement). Earlier steps' publications do not satisfy later steps.
- Computer-file changes are proposed through `propose_file_changes` with the existing review and resume flow; the October 8 rewrite had dropped this capability.


## October 10, 2026 — Chat, core engine, cost and file system upgrade

- Chat answers and streamed notes share one markdown renderer (tables, lists, quotes, code). Terminal text streams as a note and hands over to the formatted answer, so nothing blinks out at the end of a run.
- A sent message appears immediately (optimistic) and the chat pins to the bottom; a failed send returns the text to the composer.
- The composer chooses the permission mode (Edit automatically, Plan first, Ask only) and the effort (Auto, Low, Medium, High). Ask only routes every request to an answer; a chosen effort applies to every model of that request except the router. Approving a plan leaves plan mode, as in Claude Code.
- The task dock monitors the running request (current step, elapsed time, tasks, latest activity).
- Compaction has hysteresis: an overrun compacts to half the target from the current sticky view, carrying the earlier summary forward, so following steps append to a stable cached prefix. Only real user direction, the two latest Opus advice messages and the newest project-state snapshot survive; engine nudges are dropped and early media images become a note.
- Haiku compacts at 80K and is never sent more than 96K input tokens (newest large tool results shrink to receipts first), keeping it below the 100K long-context price tier.
- The last response's real prompt size calibrates the byte estimate; the token-count endpoint is called only without a calibration or within 5% of the target. Implausible usage reports are ignored.
- A response cut off while only thinking never raises the output allowance: the agent is told to act in one concrete step and that phase's effort steps down. A cut-off with visible content doubles the allowance once. Raised allowances belong to one phase and are cleared after a complete response.
- Effort by role: research and timeline-integration workers low, build workers medium, the lead medium (high after two consecutive worker failures). The composer's choice still overrides. The lead requests a one-hour conversation cache, and every agent role sends a task budget; both are optional gateway features.
- Over-long prose fields (summary, query, brief) are shortened instead of failing the tool call. Paths and code are never trimmed.
- Every provider response records phase, worker, tokens, cost, duration and visible size in an append-only ai_usage table, priced by a client mirror of the gateway formula (parity-tested).
- Activity events are rows (one upsert per stream update). Publications record changed files as hashes and line counts; text is read on demand through file_diff, and older events page in through activity_page.
- Gateway (requires deployment): `cacheTtl:'1h'` makes every breakpoint of a lead conversation one hour; task budgets are forwarded with their beta and switched off for the instance if the provider rejects them; Haiku thinking is summarized (same cost) and shown as transient progress on the worker's row; receipts carry `costUsd` and `dream_policy.features`. Every feature is optional, so the app works unchanged against an older deployment.
- Scene engine: one prebuilt runtime runs every engine scene, so the agent writes only the code for the video and may install packages for anything else. Scenes are React components using Remotion APIs (frame, interpolate, spring, Sequence, transitions, shapes, paths), three.js through React Three Fiber, d3, icons, noise and bundled OFL fonts. Engine helpers cover the plumbing: project media and resources by name, frame-exact video, textures, a ready 3D scene (camera, lights, studio reflections), fit-to-box text, safe areas and beat timing. Nothing in the engine is specific to a prompt or a kind of video.
- The runtime ships as five chunks (core, three, d3, icons, noise) sharing one React, Remotion and three.js through a module registry. Each scene document mounts the scene through Remotion's Thumbnail one frame at a time; a frame is acknowledged only after React commits, 3D roots advance to the frame time, and textures, files, fonts, images and video seeks have finished (suspended resources count until the component that read them commits). Randomness is seeded by the revision and clocks report frame time, so frames are identical in any order.
- Scenes run in their own sandboxed document: dream-engine:// in the player and the loopback render server during export, with the same relative routes and a CSP that allows only that origin plus data and blob URLs. 3D export finds a working WebGL backend on first use (ANGLE, then SwiftShader) and remembers it. Legacy HTML scenes are unchanged.
- Publishing compiles .tsx/.ts/.jsx/.js scene outputs with esbuild (no code runs in the host): engine modules resolve to the shared runtime, packages installed in Workspace/node_modules are bundled, and a package that is neither provided nor installed fails with an install hint. Imports stay inside src/, resources/ and installed packages. Files under resources/ (authored, 24 MB per file, 96 MB total) and files imported from src/ are copied to a content-addressed store (Media/Engine/files) and served by name. Engine scenes default to the project frame size and rate, take props (one component for many shots) and can be transparent. Any input change recompiles and refreshes scenes on the timeline; compile errors name file, line and column and block publication.
- No background test runs. Scene errors come from scenes playing in the visible player or a chat preview: the stack is mapped through the scene's source map to src/file:line, stored per scene revision or draft, added to the agent's project state, and a request cannot finish complete while a scene changed in it reports errors. Writing scene code returns a compile check, and check_outputs compiles drafts that the user sees live under the worker's row before anything is published.
- The agent's default tools for solo and build work are list_files, search, read_file, write_file, edit_file, run_command (package installs stay available), import_resources, check_outputs, read_transcript, publish_project, view_media and, when allowed, propose_file_changes. bundle_scene and the HTML scene guide exist only in advanced mode (DREAM_AGENT_ADVANCED_TOOLS=1). The engine reference (packages/scene-engine/reference/api.md, mirrored into the cached system prompt and drift-tested) is identical for every worker; the lead gets a short capability summary instead. The first message carries the capabilities, and view_media no longer copies computer media into Sources/.
- import_resources reads folders, archives (only matching entries are extracted) and single files directly in the project service under the existing computer permission, writes them to resources/<name>/ with an index of paths, sizes and image dimensions, and respects the 24 MB per file and 96 MB total limits. It replaces copying, extracting or encoding files with commands.
- Music and sound effects are written as data and synthesized by Dream, never as audio code. A music output is a score file (src/music/*.score.json) in compact notation (drum step patterns, note strings with durations, chord progressions, arpeggios, sections and repeats) or a full score document; Dream expands and validates it, naming the field and token at fault. Sound effects are a sound design file or a named preset. Rendering uses the procedural audio worker and is cached by the sound's content, so republishing unchanged sound is instant. Music assets carry their beat times; a scene output that lists a music output reads them with useBeats(name).
- A delegate call is a task graph: tasks name dependencies with after and run as soon as those complete, at most maxWorkers at once; dependents of a blocked task are skipped with that reason. One publishing task must depend on every build task; build tasks that can overlap in time need disjoint writes. The graph and its reports are saved, so a resumed request does not rerun finished tasks.
- Every worker of one call starts from the same project snapshot (overview, media, capabilities, decisions; no query search or conversation), marked for caching, followed by its task, scope and attached context files. Later workers start after the first worker's stream begins (at most 5 s) so they read that cache instead of each writing it.
- A blocked worker is retried once with the reason, unless the block needs the user. Reports carry changed files, outputs, scene errors, attempts, duration and cost. The lead keeps plan notes through compaction, has 100 steps, and verifies from receipts and errors instead of dispatching code-reading review workers.
- Agent media context: a one-line-per-source catalog (capture order when known), one 4x3 contact sheet per shown source instead of separate frames, and a catalog sheet with one frame per source for nine or more sources.
- The run monitor shows the request's running cost, tokens and time per caller (director, Dream, each worker), loaded from ai_usage and kept current by live ai.usage events.
- Computer media is found by when it was captured: find_media scans camera rolls, phone sync folders (OneDrive, iCloud), Videos, Downloads, Desktop and memory-card DCIM folders for a local-time window (today, yesterday, this week, last 7 days, or dates), reads each file's own capture time (QuickTime creation date with time zone, MP4 creation time, EXIF DateTimeOriginal in JPEG/HEIC/TIFF) without decoding, and returns a capture-sorted catalog. Phones connected over MTP are not file paths and are reached through their synced folders.
- import_media imports up to 100 files in one call, four at a time with one state update. An unchanged file (same path, size and modification time) is imported once whatever request brings it. Assets record their source path and capture time. Ids and contact sheets return immediately; proxies, thumbnails and speech continue in the background, with transcription limited to two sources at a time and skipped for clips under two seconds.
- With computer access granted, the agent imports automatically; changes to computer files still go through proposals. A dropped folder grants a read-only subtree. The agent's context states whether access is allowed, the familiar folders, and the local date and time zone that today refers to; media lists are in capture order.
- Media drags straight onto the assistant timeline: Media-tab cards and files from the computer land at the drop time on that row (footage and photos join the story, audio goes to music, other visuals become overlays), several files go in capture order as one undoable change, and a clip crossing the drop point is split there. The timeline appears as a drop zone as soon as a project has media. While Dream is editing, a drop is attached to the next message instead, because history cannot change during a run. The placement code is shared with the manual editor through @dream/timeline.
- Attachments, timeline selections and message media show as media tiles: kind icon, the exact frame at a clip's in point (or the thumbnail), a muted preview of the range on hover, live scenes, audio waveforms and length. A message stores the timeline selection it referred to, so the conversation shows what was selected.

## October 10, 2026 — Fixes from the first live comparison run

- The first live run of the comparison request finished in 5.5 minutes for $0.32 (39 model calls), against 34 minutes and $2.14 before. Its transcript showed where calls were still wasted, and these fixes target only those causes:
  - The engine reference now has a complete, publish-tested example of every timeline item (scene clip, overlay, sound effect, music) and the anchor rules, and says it is complete, so workers stop searching the schema and the workspace for formats.
  - Invalid project documents are reported one line per problem (field, what is wrong, accepted values); an item that cannot be placed says why (missing clip, missing word, no length).
  - check_outputs also checks score and sound files: length in bars and seconds, sections, each track's loop length, and tracks that drift against the bar line. Workers no longer write their own scripts to count bars.
  - The workspace README and environment note no longer point at the retired HTML scene guide; older projects get the new README.
  - Review renders always receive the engine runtime, so a renderer without it fails loudly instead of timing out on scene frames.
- The lead's conversation cache is five minutes until a wait for workers in the request outlasts that (four minutes), then one hour. Live runs showed short requests where the one-hour write (twice the five-minute price) was most of the cost and never paid back. System prompts and tools keep their one-hour cache across requests.
- Scene3D treats a missing, "transparent" or "none" background as a see-through canvas. three.js reads unknown colour names as white, so a live run's teaser came out with white text on a white canvas; unreadable colours are now scene errors that reach the agent.
- The lead finishes once a publication succeeded, no errors are reported and the reports cover the request, instead of dispatching workers to confirm what a report states. A live run spent a third of its cost on such a confirmation.
- Build workers stay at medium effort: a live run with low effort was slower (its large scene write hit the smaller output allowance and was redone) and did not lower the thinking share. DREAM_BUILD_WORKER_EFFORT exists only for such measurements.
- Publishing keeps the project's own timeline ID when a project.json based on the current version carries a different one; the base-version check already proves the document belongs to this project. In a live session a worker rewrote project.json from scratch with a made-up ID and every publish failed with an unhelpful "belongs to another project" error. The engine reference also says to edit project.json in place and keep its identity fields.
- tests/desktop/agent-workflow-live.spec.ts runs a real editing session in the packaged app against the deployed gateway on footage found on this computer: find and cut, reorder and trim, a gloomy grade, motion graphics, music, captions, transitions and speed, swapping a clip, a question, and Export. It runs only with DREAM_LIVE_WORKFLOW=1 on a temporary account with a capped daily allowance.
- Routing favours Haiku: Opus directs only requests that build several new pieces at once (two or more new scenes, new visuals plus new music, a whole video from nothing) or when the user asks for the director. Footage edits that need taste (best moments, montage, reordering, grading and mood, captions, titles, music, transitions, swaps) go to Haiku alone, which sees the footage and can still ask the director one question or hand over. A live editing session showed the Opus lead at about 83% of each step's cost while Haiku workers did the work for a few cents.
- The lead no longer receives contact-sheet images (workers look at the footage), and its briefs state only what is specific to the task, since workers already have the engine reference, the document format and the project snapshot.

## Export renders JPEG frames at machine concurrency
Opaque exports render JPEG frames (quality 90) instead of PNG and run half the CPU cores at once (2 to 8) instead of a fixed 2; transparent ProRes layers keep PNG; DREAM_RENDER_CONCURRENCY still overrides. Measured on the 30 s live session project (1080p60 sources, grade, transitions, scenes): 483 s before, 214 s after, with no visible difference. scripts/benchmark-export.ts times the export path for any project.

## October 10, 2026 — Request safety limits

- Every request has a spending limit, $2 by default (DREAM_REQUEST_BUDGET_USD). It is checked before each model call from the request's recorded cost; at the limit the request stops as interrupted with the work so far saved, and each resume allows the same amount again. Before this only the account's daily allowance applied, so one stuck request could use most of a day's budget.
- The same failing tool call three times (or a similar one four times) ends the request as blocked, one attempt sooner than before; the second failure still asks the director or hands over first.
- Spending-limit, quota and sign-in errors from workers end the request instead of being returned to the lead as task errors to retry.
- When the router fails, the request starts with Haiku (which can still call the director) instead of falling back to the local guess, which sent every open-ended request to Opus without notice.
- Every time Opus takes part in a request is recorded as an ai.escalation event with its kind (route, switch, consult, plan) and reason, so live runs show how often it happens and why.

## October 10, 2026 — Timeline actions for the agent

_Replaced on October 11, 2026 by "The agent edits through code; the timeline actions are gone"._

- The agent changes the timeline with edit_timeline: the same typed operations the manual editor uses (insert, trim, split, move, delete and replace clips, speed, framing and grade, clip audio, transitions, overlays and sound effects, captions, music, settings), plus outputs to declare new scenes, music and sound so actions can place them as output:<id>. Live sessions showed most failures and much of the cost came from the agent reading and rewriting the whole project.json for every edit, including a run that invented a new timeline ID.
- Actions apply in order and nothing applies unless every action passes. Each is checked as it is applied; an error names the action and the problem, with the IDs that exist when it named one that does not. The result is then checked against the sources: every asset or declared output exists, every range lies inside its source, every changed item has a length and a clip to stand on, and a deleted clip may not strand items anchored to it.
- The call publishes in the same step (publish:false defers to publish_project, for changes that go with new code), and returns a compact list of what changed instead of the document. A repeated or resumed call replays its saved document and publication instead of applying its actions twice.
- Code is written only for new visuals, music and sound. project.json is edited directly only for what no action expresses. Only the solo editor and a publishing worker get the tool; the director still never edits.

## October 10, 2026 — Smaller agent context

_Partly replaced on October 11, 2026: the director it mentions is gone (see "One agent owns the edit"). Change-only state messages and the tiled frames of view_media still hold._

- Project-state messages report only what changed. The first message already carries the project and its media, so no full state follows it; after that, each change sends the changed fields, and for media and decisions only the records added, changed or removed. The full state is saved locally under the message, and compaction restores it when it drops the earlier messages a change report builds on. A worker whose snapshot describes an older version still gets the full state first. Measured on the saved live sessions, state messages shrink by 87 to 89 percent.
- A look at footage (view_media) with five or more frames returns them tiled on 4x3 contact sheets instead of separate images, about a quarter of the image tokens; a range of a second or two still returns full-size frames for close checks. Looks at footage were the largest results in the live sessions.
- The first message carries at most six code excerpts of 2,000 characters (was twelve of 5,000), and 9,000 characters of related project records (was 14,000). Transcript words carry only id, text, start and end, plus a speaker or an uncertainty flag when there is one.
- Not changed: the Opus compaction point (180K tokens) was never reached in the live sessions, and the Haiku editor already starts without footage images; the director's start is text only.

## October 10, 2026 — Old director removed; session numbers per request

_review-packet and footage-tools were deleted on October 11, 2026 with the footage map (see "The agent looks at footage itself; nothing pre-interprets it")._

- The old tool-based director (legacy-director.ts) and the modules only it used (read-loop, director-consult, design, review-loop, presentation, tool-registry, tool-context, visual-tools, media-tools) are deleted. The app had not used them since the code engine; about a fifth of the integration tests still exercised them, so a passing suite said less about the shipping app than it seemed. Each behavior those tests covered (resuming without repeating effects, file approval, truncated responses, plan approval, transient retries, compaction, undo) has a test against the current engine; tests in mixed files that did not use the old director are kept. review-packet and footage-tools stay for the smoke scripts.
- scripts/session-report.ts reads a project's database read-only and reports each request: status, time, cost, calls per model, the largest context sent, the share read from cache, moves to Opus with their reasons, compactions and spending-limit stops; --compare puts an older session's numbers beside it. The live session test records these numbers for every step and writes session-report.txt, compared with DREAM_LIVE_COMPARE when set. The last live session before these changes: $0.70 for nine requests, $0.57 of it Opus in the first three.

## October 10, 2026 — Haiku first, then Sonnet, then Opus

_Replaced on October 11, 2026 by "One agent owns the edit": a failing request continues in the same conversation on a stronger model, and there is no director._

- Haiku starts every request that changes or questions an existing project. When the engine sees it fail (the same tool error twice, the step limit, or repeated output cut-offs), Sonnet takes over working alone, with the same tools and a handoff of the request, Haiku's latest notes and what is published. When Sonnet fails the same way, the Opus director takes over. Before this, Haiku's second repeated failure went straight to Opus.
- An editor that asks for direction (switch_to_orchestrated: several new pieces built together) gets a Sonnet director with Haiku workers. A Sonnet director whose workers keep failing (two or more failed tasks) and that finishes blocked hands the request to Opus once. A consultation goes one step above the model asking: Haiku asks Sonnet, Sonnet asks Opus.
- The router chooses haiku, sonnet (one request that builds several new pieces) or opus (a whole new video from nothing, or when the user asks for Opus or the director). The app enforces that rule itself: an Opus route on a project that already has a timeline, or for a question, becomes Sonnet unless the request names Opus or the director, so it also holds with a gateway whose routing schema only knows haiku and opus. The gateway schema now also accepts sonnet; it takes effect when the gateway is next deployed. Script and concept replies are written by Sonnet.
- A plain follow-up edit (an instruction such as "make it warmer" or "add crossfades", not a question, a plan, a script or a call for a stronger model) on a titled project with a timeline goes straight to Haiku without a router call, which saves a round trip before work starts.
- Every move to a model above Haiku is an ai.escalation event with its kind and reason, and each mode switch records the models on both sides.
- Planning requests (plan first) and approved plans still run with Opus, since the user asked for them explicitly.

## October 10, 2026 — Project notes and timeline outline

- Every request starts with an outline of the video in order: one line per clip with its place on the timeline, source and range, speed, framing, grade and transition, then overlays, sound effects, music and captions. Follow-ups such as "the middle clip" or "the title" can be acted on without reading project.json or looking at the footage again. Workers get the same outline in their snapshot.
- The editor or director keeps project notes: finish takes optional notes (what the user wants for this video overall, such as mood, style, pacing, likes and dislikes, and lasting decisions), which replace the previous notes and appear as projectNotes in every later request. They are written in the call that already ends the request, so they cost no extra model call. Workers and consultations never write them. Verbatim user preferences still go through remember_decision.

## October 10, 2026 — What the agent saw stays with the project

_Partly replaced on October 11, 2026: the notes travel as sourceNotes in the request block (see "The cached briefing actually stays the same"), and the visual-understanding job it mentions was deleted with the footage map._

- The plan assumed footage descriptions were already saved; they are not (the visual-understanding job is not wired into the app and its jobs are retired when a project opens). Instead, finish takes optional sourceNotes: one short line per source the agent looked at, saying what it shows and where. They are saved per source (a new note replaces the old one) and listed as seen in the media list of every later request, so follow-ups like "swap the last clip for one that fits the mood better" can choose from what was already seen and look with view_media only for what the notes do not cover. The notes are written in the call that already ends the request; nothing scans footage in the background.

## October 10, 2026 — Reads in one response run together

- When one response asks for several reads (read_file, view_media, read_transcript, search) before any other call, they start together and their results are still recorded in order. read_transcript waits up to two minutes while a source is still being transcribed, so transcripts of several clips just imported, which used to wait one after another, now overlap; looks at several clips extract their frames in parallel. A read that comes after a write in the same response still runs after it.
- The editor is told transcription runs in the background, to ask for several transcripts or looks in one step, and to skip transcripts of sources whose speech does not matter to the request, so a first cut on visuals does not wait for speech.

## October 11, 2026 — A second live session aimed at the new behavior

- tests/desktop/agent-editing-checks-live.spec.ts (only with DREAM_LIVE_EDITING=1, capped like the first) runs ten follow-up requests on footage found on this computer: a first cut, a mood stated once ("calm and dreamy... keep that in mind"), swapping the second and third clips, making the first clip exactly 2 seconds, extending the last clip by 30 seconds (which most clips cannot give), music that fits without restating the mood, a title scene, replacing the shakiest clip, removing the music, and a question about the mood and length; then Export. Every check reads the project state (exact order, exact length, ranges inside their sources, an honest reply when the footage runs out, the mood recalled), nothing is judged by a model.
- Steps also carry targets for the cost and speed goals: simple follow-ups without a router call, on Haiku only, under $0.05 and a minute; no Opus anywhere; the mood in the project notes; notes on what was seen after the first cut; at most two looks at footage when replacing a clip. Problems and missed targets are both soft failures, so the whole session always runs and the report shows each.
- The first session stays as it was, so it can still be compared with the run before these changes. The shared setup is in tests/desktop/live-session.ts. The session report now also shows whether a request used the router and how many looks at footage it made.

## October 11, 2026 — First live run of the editing checks, and three more sessions

- The editing-checks session ran live against the packaged app with every change through October 10: all ten requests passed their checks and Export produced the video, for $0.066 in total with no Opus call, in 225 seconds of requests (the previous full session, with different requests, was $0.70 with $0.57 of Opus, 498 seconds). Simple follow-ups (swap, exact length, remove music) took 6 to 8 seconds for $0.002 to $0.005 each, without a router call. The mood stated once was saved in the project notes, used for the music without being repeated, and recalled when asked. Evidence: artifacts/live-editing-checks-1791691366159.
- Two targets were missed. "Extend the last clip..." went through the router because extend was not a plain-edit verb; extend, stretch, shrink, rotate and flip now are. Replacing the shakiest clip took eight looks at footage: the first cut was built from import contact sheets and transcripts without looking closely, so no note said which clip shakes. Finding shake needs looking, so that target is now at most eight looks.
- Three more live sessions share tests/desktop/live-session.ts: a long video (DREAM_LIVE_LONG: a two-minute recap of a week of footage, a dozen follow-ups by clip position, the context of the last follow-up within 30 percent of the first, then the best 45 seconds of the longest video), media already in the app (DREAM_LIVE_IMPORTED: generated clips that differ only in color, a photo and a song imported through the app's picker with no computer access; used by look, by name, as an attachment and as a timeline selection, and what was left out recalled), and interruptions and modes (DREAM_LIVE_INTERRUPTIONS: stop part way and continue without duplicate scenes, an accidental undo put back, ask-only changing nothing, plan first waiting for approval and then running, stop and redirect, a vague request).

## October 11, 2026 — The footage map: the agent sees what the footage shows

_Replaced on October 11, 2026 by "The agent looks at footage itself; nothing pre-interprets it"._

- The live editing-checks run showed the agent editing video from transcripts alone: the project held only words, it looked at footage in one of ten requests, and its notes on sources quoted dialogue. It extended a clip into a paused stretch and a screen-recorder window it had never seen.
- Every imported video or image now gets a footage map in the background after it is ready (stage footage_map). One local ffmpeg pass at 320 px and 10 fps (about 15 times real time) finds cuts (scdet), frozen stretches (freezedetect, which catches a paused video), black stretches, blur, brightness, motion and camera shake (vidstabdetect; the frame-to-frame camera move minus its one-second average, so pans do not count). Shots between cuts carry their measurements and problems (frozen, black, dark, blurry, shaky); thresholds were set on real footage (sharp video blurs at about 4, soft at about 9; steady footage jitters about 1 px per frame, handheld 4). Then one inexpensive Haiku call looks at a contact sheet of up to sixteen shots and returns a line per shot (what it shows, framing, tags, energy, usable) plus problems measurements cannot see: player controls, a screen-recorder or desktop window, a pause icon, burned-in text, watermarks, letterboxing. Without a connection the map keeps every measurement and says the shots were not described. Shots are stored in the existing shot records, so search finds them by description. Loudness (EBU R128) is measured per source as well (stage loudness).
- The media list shows each source's map (summary, shots with their problems, frozen and black stretches, where usable footage ends), within a budget of about 150 shot lines across sources; a source not analyzed yet says so. The timeline outline says what each placed clip shows and what is wrong in its range.
- edit_timeline returns warnings with the result, never blocking: placed ranges that are frozen, black, dark, blurry, shaky or show junk (with where usable footage ends), sources not analyzed yet, slow motion below half speed, a clip over 40 percent of a video of 15 seconds or more, and the same footage used twice. The agent fixes them or says in its recap why it kept them, and is told to offer an alternative when a request cannot be met with good footage.

## October 11, 2026 — The project briefing is cached across requests

_Partly replaced on October 11, 2026: the footage map is no longer in the cached block (see "The agent looks at footage itself; nothing pre-interprets it"). The two-block cached briefing still holds._

- In the live run, cache writes were 56 percent of all spending: every request rebuilt a briefing of about 25,000 characters and put it after the request text, so no part of it could be read from cache by the next request. The first message is now two blocks. The first holds what changes rarely (capabilities, environment, the computer without its clock, the media list with each source's footage map) and carries a cache breakpoint, so a request within five minutes of the last reads it instead of writing it again. The second holds the request and what depends on it: the time, the timeline outline, project notes, decisions, recent conversation and related records.
- The briefing lists authored files by name instead of carrying code excerpts (up to 12,000 characters, unrelated to most edits); search and read_file open the code a request needs. Related project records are capped at 5,000 characters, since the timeline outline and the media list now cover clips and sources.

## October 11, 2026 — Tools that failed at their job in the live run

- remember_decision failed both times it was used for its purpose: the agent passed a conversation record ID (conversation:<id>:0), then a made-up one. The message ID is now optional and may be either form; the quote itself finds the user's message (the named one, else the latest of their recent messages that contains it), compared without regard to quote marks, dashes or spacing. Words the user never wrote are still refused.
- view_media refused motion detail over more than 8 seconds and said so only after the call, so finding the shakiest clip took seven looks. A longer range is now sampled more coarsely (scene-aware overview up to 60 seconds, a preview beyond) with a note that a shorter range gives frame-by-frame motion.
- A choice field sent as quoted JSON ("\"captured\"") is unwrapped; only fields with a fixed set of choices, so file contents keep their quote marks. Invalid tool input is reported as plain lines (field, what is wrong, the accepted values) instead of raw validator output.
- Project notes hold what the user wants, never the current state of the edit (the live run's notes said "five shots at 0.75 speed" two edits after that stopped being true). Replies never mention internal records such as project notes, the footage map or receipts.

## October 11, 2026 — Effects the agent can use, and a real white balance

- The player already supports effect items on footage (slow_push, punch_zoom, shake and a grade layer), and the manual editor offers them, but the engine reference and the edit tool never mentioned them, so the agent never used them. They are now documented with an example: an attached item of type effect changes every clip under it, with no scene code.
- Colour temperature was a sepia tint plus a rotation of every hue: cooler footage got a warm tint and a fixed -20 degree hue shift. It is now an SVG colour matrix (feColorMatrix, sRGB interpolation) that scales red against blue, with green following red slightly; the composition defines one filter per temperature used by clips and grade layers, and clips refer to it by ID. Checked in the app's render browser: grey 128 becomes 144,131,112 warmed by 0.5 and 112,125,144 cooled by 0.5. The grade layer now takes a temperature too.
- The bulk-import test waits for background analysis, which now includes the footage map, before closing the project; it has 90 seconds under a full parallel run (about 6 alone).

## October 11, 2026 — Balanced sound

- Clips played at whatever level they were recorded and the final mix was never normalized: the live run's export measured -12.3 LUFS with a 13.5 LU loudness range. Each clip's sound is now levelled toward -18 LUFS from its source's measured loudness (at most 12 dB either way), in the shared audio manifest, so preview and Export hear the same thing; the clip's own gain still applies on top. Music keeps the gain it was given (generated scores carry no measurement, and the agent sets music relative to dialogue). A project can turn levelling off with settings.autoLevel false.
- Export then brings the finished mix to -14 LUFS with true peaks below -1.5 dBTP in two passes (measure, then a linear loudnorm), copying the picture untouched; silent exports and ones already within half a decibel are left as they are. Export progress shows "Balancing the sound" for this step.

## October 11, 2026 — The agent may download anything and write any code

- The user wants the agent to work like Claude Code: install or download any tool, library, model or binary, write any code, and process audio, images and source footage however a request needs. The instructions no longer forbid building infrastructure, limit installs to what the engine lacks, or confine commands to data files; they say commands have internet access (the sandbox already had it) and that produced media goes under output/ as an output to place on the timeline. Media outputs may now be video as well as audio and images, so a cleaned-up recording or a converted clip can go on the timeline. The one rule left: the edit itself renders only when the user clicks Export.
- Safety limits stay as limits on spending, not on capability: each request may now spend $3 (was $2) before it stops with its work saved, and each resume allows another $3. Changes to files on the user's computer still need their approval, and no account credentials reach the agent's commands.

## October 11, 2026 — Second live run of the editing checks, with the footage map

- Same ten requests on the same footage as the first run: all checks passed except one, which was a fault in the check, and Export produced the video. $0.075 in total with no Opus (first run $0.066), 304 seconds of requests (225). The export is 47 seconds at -14.3 LUFS with an 8.2 LU range (first run: -12.3 LUFS, 13.5 LU). Evidence: artifacts/live-editing-checks-1791736600743.
- The quality fault from the first run is gone. The agent recognized the sources as screen captures of videos, used the playback content and left out desktop and recorder windows; asked to extend the last clip by 30 seconds, it built the time from clean footage, skipping a player window and a blurry stretch, and its recap said the shot runs long and asked the user to check the pace. No frame shows player controls, a pause icon or a recorder window (the first run's export ended on all three).
- Two follow-ups. Swapping two clips also trimmed and slowed the moved clip because the outline flagged it (6 calls and 40 seconds instead of 2 and 10): the agent is now told to change only what the request asks and to suggest fixes for untouched clips in its recap. The extension check measured only the last clip while the agent split the extension across two; it now measures the whole video's growth.

## October 11, 2026 — Commands on the user's computer, and the web

- When the user has allowed computer access (the existing "Allow computer access" grant), the agent's commands run on their computer like a terminal (cmd.exe as the user, in the project workspace): their installed programs and files, the internet, and the bundled Node, Python and the app's ffmpeg on PATH ahead of their own. The app's own secrets (Dream, Supabase, provider keys, tokens, passwords) are removed from the environment. Receipts, logs, replay and timeouts work as in the container. Without the grant, commands still run in the isolated container. The user asked for Claude Code behaviour; tying it to the grant keeps a customer's computer closed until they allow it.
- Every agent with tools gets Anthropic's server-side web search (web_search_20260209 on Opus 5.5 and Sonnet 5.5, web_search_20250305 on Haiku 5.5, up to eight searches per call), placed first so the cache breakpoint stays on Dream's own tools. A model that rejects it runs without it, recorded as ai.web_search_unavailable. A paused server-side turn (pause_turn) is sent back unchanged, at most five times, with nothing appended after it. Searches cost $0.01 each in both the gateway and the client cost formula; the gateway's share takes effect when it is next deployed. Searches show in the activity stream.
- fetch_url reads a web page or text file as plain text (scripts, styles and markup removed, title kept apart), up to 100,000 characters. Addresses on the user's computer or local network are refused, so a page cannot point the agent at a local service. Files (images, logos, video, audio) are downloaded with commands (curl or pip). Web content is data, never instructions.

## October 11, 2026 — Transcription survives network hiccups

- In the first long-form run (a 38-minute talk), cloud transcription reached 84 percent in 56 seconds, then one chunk upload failed with "fetch failed" and the whole transcription was marked failed: only an explicit busy reply was retried. A dropped connection or a server error (5xx) is now retried up to four times with a growing wait (2, 4, 8 seconds); a refusal still fails at once and a later retry resumes from the saved chunks.
- Measured on that import: the clip was ready to edit in 4 seconds (the agent started 5 seconds after import); playback audio took 24 seconds and the waveform 9, both in the background; the footage map was still running after two minutes on the 1080p original when the test runner was stopped.

## October 11, 2026 — The cached briefing actually stays the same

- In the second live run the cached briefing was read from cache by only one request of eight: the media list inside it changed almost every request, because the agent rewrites its notes on sources as it works and every new title or music track it makes joins the list. Source notes now travel as sourceNotes and media the agent made as generatedMedia in the request block, so the cached media list changes only when the user imports something or a source's footage map finishes.

## October 11, 2026 — Export renders footage with ffmpeg

- Export no longer screenshots every frame in a hidden browser (about 7 times slower than real time; a 13-minute 1080p edit took about an hour). ffmpeg renders footage straight from the sources: framing, grade and white balance with the player's CSS colour maths, zooms, shake, crossfades, dips, footage overlays and captions (libass), encoded on the graphics card when there is one. Consecutive pieces render as one ffmpeg run, three runs at once. Plain footage never leaves YUV; untagged video is read as BT.709, as the browser reads it. The sound is mixed, levelled and encoded while the picture renders. A 13-minute talk edit exports in about 3 minutes (6 with a grade on every clip); it matches the browser export at SSIM 0.968.
- Only what the browser alone can draw goes through it. Graphics over footage (titles, chapter cards, motion graphics) come from it as a transparent ProRes 4444 layer that ffmpeg puts over the footage; only a scene used as the clip itself, or a transition only the player draws, is drawn whole. Each layer is rendered with a composition selected with that layer's props, because a Remotion composition renders with the props it was selected with: before this, browser pieces drew the footage and the captions anyway, which made a long-form edit with nine chapter cards hang for over 40 minutes. That edit (10 minutes) now exports in 5.
- If the native path fails, the browser renders the whole video as before. DREAM_EXPORT=browser forces the browser path.

## October 11, 2026 — Editing starts while a long recording is still being transcribed

- read_transcript returns the speech transcribed without gaps from the start while transcription runs, waiting at most 45 seconds for the requested page, with transcribedUntilSec; its revision stays fixed while words are appended, so pages already read stay valid. Each source's state shows how far transcription has got.

## October 11, 2026 — The agent looks at footage itself; nothing pre-interprets it

- The import-time footage map is gone: no measured "frozen / dark / black" labels, no one-frame-per-shot descriptions (one Haiku call per import), no preview frames warmed for the agent, no contact sheets pushed into its first message or returned by import_media, no shot descriptions in the timeline outline or in project search. In the first long-form run the map called a talk with a moving speaker in a corner box "solid black frame" and flagged every clip frozen and dark; the warnings were then ignored wholesale, and the one real warning (the hook used twice) with them.
- What the agent gets is facts: each source's length, size, frame rate, sound, path, capture time, its own earlier notes (sourceNotes), and how far transcription has got with the file of timed words. It decides what to look at (view_media frames at the times it picks) and measures with code.
- Cloud transcription still runs at import: it is raw data (what was said, with timings) that captions, music ducking and word anchors need, and it is a file the agent may read, not pushed into its context.
- Kept for the player and export: playback copies, thumbnails, waveforms, loudness (auto-level). Earlier projects' maps, shot descriptions and video observations are dropped from the search indexes by a migration, and their footage_map/context/shots jobs are retired on open. The dream-context preview runtime and its staging script are removed.
- Edit warnings keep only facts about the timeline: slow motion, a dominating clip, footage used twice.

## October 11, 2026 — The agent edits through code; the timeline actions are gone

- edit_timeline is removed. Every edit (cutting and tightening speech, ordering, pacing, framing, colour, effects, graphics, titles, captions, music, sound) is a change to project.json made by the agent: directly for a small change, or by a program in any language it writes and runs that reads the project, the sources and context/ and writes it. What the timeline cannot express it makes: processed or generated media under output/, or a scene. In the first long-form run the agent's helpers cut speech by typing seconds into dozens of timeline actions, then reported the pause removal blocked; a program over the transcript does that work exactly.
- ffmpeg and ffprobe (the app's own) are on PATH in the isolated command container as well as on the user's computer. read_file returns an image the agent's code wrote (a frame, a crop, a sheet of frames), so it can look at what it measured.
- publish_project checks what the request changed, from the timeline and the transcript only: footage used twice, a cut inside a spoken word, silence over three seconds between words inside a clip (must fix), slow motion and a dominating clip (notes). finish complete is refused while a must-fix check is neither fixed nor listed in finish.kept with a reason, and while a task the agent delegated is still blocked or was skipped: unfinished work is not reported as done.
- The engine reference documents the project document itself (sources, transcripts, clips and their framing, outputs) instead of actions. It states that a clip's scale zooms about the frame's centre: the agent's punch-in on a speaker in a corner box zoomed into the black slide area, so a region is cropped by processing the footage or with a scene.

## October 11, 2026 — One agent owns the edit

This entry supersedes the October 9 entry (Opus leads, Haiku executes) and the October 10 entry (Haiku first, then Sonnet, then Opus) where they describe a director.

- One editing agent owns each request from start to finish: it looks at the footage, decides, edits project.json, publishes, checks and replies. In the first long-form run a Sonnet director relayed the work to Haiku workers through written briefs; a worker reported the pause removal blocked, and the director published and called the request done.
- The router picks that agent's model: Haiku for changes to an existing edit and edits of short footage; Sonnet for a big edit (the first cut or a full re-edit of long footage, many sources cut into one video, or several new pieces built at once); Opus only for a whole new video made from nothing or when the user asks for Opus. The route schema is unchanged, so the gateway needs no deploy.
- When the agent keeps failing (the same error twice, a similar one three times, its step limit, or three cut-offs), the same conversation continues on the next model up (Haiku, Sonnet, Opus) with everything it has read and done and a fresh step allowance; a resumed request keeps the stronger model. Before this, a new conversation started from a written handoff. At the top of the ladder a repeated failure asks Opus for direction instead.
- The director (lead role, its prompt, switch_to_orchestrated, hand_off and the mode phases) is removed, and so are research workers: the agent reads in parallel itself.
- For separate pieces that take real work (several new scenes, or scenes and music) the agent may delegate Haiku helpers as a task graph. A helper writes only its declared paths: it never edits project.json, publishes, imports media or changes the user's computer. The agent places their outputs and publishes. finish complete is still refused while a delegated task is blocked or was skipped.
- Plan first: the Opus planner writes the plan; the approved steps run as one Sonnet editing-agent conversation (was the Opus lead).
- consult_director asks the model one step above the asker. Effort and task budgets have no director settings left: Auto effort is low for the router and simple work, high for difficult work, medium otherwise; the editing agent sees a 120K task budget and helpers 100K. The run monitor labels the agent's costs Dream and each helper by its task.

## October 11, 2026 — Sonnet only, a real environment, and checks before a live run

This entry supersedes "One agent owns the edit" where it describes choosing a model and moving up a ladder.

- Every role runs on Sonnet 5.5: the router, the editing agent, its helpers, plans and replies (`models.agent`). The Haiku, Sonnet, Opus ladder, escalation within a request and consult_director are removed. A repeated failure is now the agent's own to diagnose (the second identical failure returns diagnosisRequired, and the prompt says to find out why and change approach); the third ends the request as blocked with its work saved. Replies have the read-only tools, so they can look at the transcript or frames before answering. Starting on Haiku and stepping up added routing, escalation and consultation paths, each with its own failures, to save cost on easy requests; one capable model is simpler to get right.
- The workspace is real: nothing the agent reads is a stale copy. The context files were rewritten only between tool calls, so in the October 11 long-form runs the agent's script waiting for the 38-minute transcript (Haiku in one run, Sonnet in the next) read a frozen file and would have waited 25 minutes after transcription had finished. While a command runs, each transcript file is now rewritten as its transcription advances, and assets.json with the Sources/ copies when a source is added.
- The gateway attaches the routing JSON schema for Sonnet as well (only Haiku had it), so a Sonnet router still answers in the schema. This needs `supabase functions deploy dream-gateway`.
- A live session refuses to start when the packaged app is older than the app's code or the deployed gateway older than the gateway's code. The October 11 long-form run went to Haiku because the Sonnet routing schema, committed the day before, had never been deployed. A short live smoke session (three minutes of the talk, then captions) runs before a long one.
- The workspace's package.json no longer declares "type":"module" (earlier workspaces lose it on open). In all three October 11 runs the agent's first `require()` script failed on it; without it Node 24 runs CommonJS and detects ES module syntax, as in a fresh npm project. The smoke session (three minutes of the talk to a 66-second cut, then captions) passed every check for $0.40 in 74 seconds, and its script waiting for the transcript returned as soon as transcription finished.
- Auto effort is medium for every role (the router stays low: it classifies within a 2K-token allowance, and more thinking could cut off its answer). The router called nearly every request difficult, which meant high effort: in the long-form session thinking was 57 percent of all output, and adding chapter titles cost $0.30. A user-chosen effort in the composer still overrides it.
- When DREAM_AGENT_MODEL selects Haiku, its Auto effort is xhigh (Haiku 5.5 accepts low to max), to make up for the smaller model at a fraction of Sonnet's price; Sonnet stays at medium. The contracts and the gateway accept xhigh (needs `supabase functions deploy dream-gateway`).

## October 12, 2026 — One gate decides when an edit is done

- A request could end "complete" three ways, and only the finish call checked the published edit. In the Haiku long-form run the first cut ended complete with six silences of up to 25 seconds left in, while the agent's own reply said it was not finished: a plain reply with something published was accepted, and so was running out of nudges. Every way an edit can end complete now goes through one check (completionBlocker): the head is published with nothing unpublished, no scene it changed fails while playing, every must-fix check is fixed or kept with a reason, and no delegated task is blocked. A reply that fails it is told exactly what is left; when the nudges run out the request ends blocked with that list, never complete. Replies to questions, plans and helpers are unchanged.

## October 12, 2026 — Every failed AI response is recorded with what the stream showed

- The Sonnet long-form first cut died on "The AI response could not be decoded" after retries, and the cause could not be found: the stream reader built diagnostics, but nothing saved them, and a record that was not JSON carried none. Each failed attempt is now an ai.inference_failed event with the model, phase, attempt, error code and message, and the reader's diagnostics: stop reason, open blocks, block types, whether a tool call's JSON failed to parse, and the last 20 events. A record that is not JSON is an invalid stream naming its event and the first 300 characters. The session report lists failed responses per request. The shared stream reader is also the gateway's, so this needs `supabase functions deploy dream-gateway`.


## October 12, 2026 — Every call carries less: what the October 11 runs actually spent tokens on

- Measured with `scripts/cost-anatomy.ts` (images counted by pixel size; the earlier estimate counted their base64 text and put images at 36%, when they were about 3%). In the Sonnet long-form run the re-read tokens were the system prompt and tools (38%), the briefing (18.5%), thinking (13%), view_media text (9%) and command output (8%). One view_media look carried 85,000 characters of text: up to 300 transcript words as full JSON objects.
- The system prompt keeps the rules and the project-document half of the engine reference; the scene-authoring half (imports, @dream/engine, frame rules, scores, examples) is written to context/engine.md and read when a scene or sound is written. Helpers, which always write scenes, keep the whole reference. Tool schemas carry types, choices, defaults and required fields; length and count limits are still enforced when an input is parsed. The editing agent's fixed prefix is 6.8K tokens (was 12.7K).
- Replies and plans are sent the editing agent's system prompt and tool list (the engine still refuses their write calls), and the mode travels in the first message, so they read the same cached prefix and briefing.
- view_media gives the model a compact view (frame times, words as "start end text" lines, merged coverage spans; no absolute paths or hashes), with the full evidence still saved with the call. A default look keeps every other frame on contact sheets about 1024 px wide; detail true gives every frame, full-size frames for short ranges and 1568 px sheets. read_file images are about 1024 px. read_transcript returns words as lines. Command results drop timings, log path, isolation and hash (kept in the receipt).
- The briefing lists library versions once, sound presets as their combination, media the agent made without paths or dimensions; relevant records are only what the user selected or attached and matching earlier conversation (the outline already lists every clip); earlier assistant replies are cut to 700 characters.
- Not changed: thinking (13% of Sonnet's re-reads, 41% of Haiku's at xhigh) is preserved by the provider and never edited mid-conversation; effort decides it.

## October 12, 2026 — Every result's text is capped, including looks at footage

- In the Sonnet long-form run, one look at footage added 52,812 tokens to the conversation in one step (94,735 characters of text beside its images), which every later call in that request re-read. The size cap applied only to results that are plain text; a result of text and images bypassed it. Now the text blocks of any result share the same budget, with the receipt to read the rest.
- Considered and not done: clearing old tool results earlier. Simulated on the October 11 Sonnet calls, clearing at 35K to 100K tokens changed input cost by -7% to +7%, because each clearing rewrites the cache at 12.5 times the price of reading it. Skipping the calls after a failed one in the same response was tried and removed: the engine cannot tell dependent calls from independent ones, and a helper's independent writes were skipped.

## October 12, 2026 — The user picks the model in the composer; Auto sends small changes to Haiku

This entry supersedes "Sonnet only" (October 11) where it says every request runs on Sonnet.

- The composer has a Model choice: Auto (default), Sonnet or Haiku. It is pinned per request (agent-model:<turnId>), so the agent, its helpers and any resume share one model and one prompt cache.
- Auto runs a request on Haiku only when it is a small, precise change to an edit that exists: the router (or the plain-edit shortcut) calls it a simple local edit, and it names no new visuals, sound, captions or whole-video change. The first cut, motion graphics, scenes, music, captions, pacing across the video, questions and plans stay on Sonnet. In the October 11 runs Haiku cost about a seventh of Sonnet but left long silences in a first cut, which the completion gate now refuses.
- The router stays on Sonnet; DREAM_AGENT_MODEL still forces one model for a measured comparison.

## October 12, 2026 — The timeline beside the chat is the editor

- The layout stays: chat on the left, player and timeline on the right (a full OpenCut-style rearrangement was considered and dropped). The timeline under the player is the OpenCut-derived one that was dormant in the manual editor: drag clips to move them (onto another row, or onto the empty row below the used ones, which makes a new track), drag edges to trim, marquee and Shift/Ctrl selection, snapping (Alt to bypass), Delete, Ctrl/Cmd+B to split, Ctrl/Cmd+D to duplicate, and media dropped from the Media tab. Each change is one undoable version the agent sees in its next request; while the agent works the timeline is locked and dropped media goes with the next message.
- It is minimal: no card around it, flush under the player, a zoom slider in the corner of the ruler (double-click fits), icon-only track headers with mute and hide on hover, no toolbar, footer or horizontal scrollbar. It opens fitted to the width, with the main track first. Its height is dragged from its top edge and remembered.

## October 12, 2026 — No router: the user picks the model

This entry supersedes "The user picks the model in the composer; Auto sends small changes to Haiku".

- The composer's Model choice is Sonnet (default), Haiku or Opus 5.5, and that is the model the request runs on (agent, helpers, replies and plans). Auto and the router model call are removed: the router rated nearly every request difficult, so a rule built on its rating could not be trusted to pick a model. DREAM_AGENT_MODEL still sets the default for a measured run.
- Whether a message is an edit, a question to answer, or carrying on with a stopped request is read from its words and the Permissions mode (Edit, Plan first, Ask only), with no model call. The agent sets the project title itself.

## October 12, 2026 — Requests travel compressed, because the firewall in front of the gateway blocks the agent's code

- In the October 12 live long-form run three requests (the first cut, the faster middle, captions) failed four times each with "Unexpected token '<', \"<!DOCTYPE\"". Replaying the saved conversation without a login showed why: Cloudflare, in front of Supabase's functions, answered 403 with its HTML block page, because a tool call in the conversation was a Node one-liner with require('fs').readFileSync(...).writeFileSync(...), which its rules treat as code injection. The first message alone reached the gateway (401 JSON). A code-writing agent sends such content all the time, and the October 11 "could not be decoded" failure was most likely the same block.
- The desktop now sends the AI and token-count requests gzip-compressed (application/x-dream-json-gzip) and the gateway decompresses them; plain JSON is still accepted. The same conversation compressed reaches the gateway. A reply that should be JSON and is not now fails with its status, content type and the start of its text, recorded with the failed attempt.
- Without a router, a message is a question when it starts with a question word (now also where, which, who, when, do, did, was, were, should); in the same run "Where does it still feel slow or confusing?" was taken as an edit. A polite request ("Can you add captions?") stays an edit.

## October 12, 2026 — The agent's edit appears on the timeline as it works, as CapCut-style blocks

- While the agent works, the timeline and the player show its unpublished draft (the workspace.draft events): blocks it adds come in one after another, moved and trimmed ones glide, removed ones fade out, and "Editing live" shows beside the zoom. The player plays the draft whenever everything in it already exists; scenes built only on publish show on the timeline first. A half-written project.json keeps the last good draft on screen; publishing makes the draft the edit.
- Every part of the edit is a block on a track of its kind, top to bottom as in CapCut: Effects (punch zoom, slow push, shake), Filters (a grade over a stretch, and a clip's own grade shown over that clip), Text, Captions, Overlays (motion graphics the agent wrote, named after the scene, and overlay media), the main track, Sound effects and Music. Only tracks with something on them show, plus one empty overlay and one empty audio row to drag onto for a new track.
- The old read-only timeline and its styles are removed.

## October 12, 2026 — Export cannot fill the disk

- Each graphics layer the browser renders (ProRes, about 41 MB a second at 1080p30 with transparency) is deleted as soon as the run that uses it is encoded, instead of when the whole export ends; at most one per concurrent run exists at a time.
- Before rendering, export estimates its peak space (the largest concurrent layers, the encoded runs and the joined output, plus a margin) and stops with "Export needs about N GB free on C:; M GB is free." when the drive is short.
- A full drive is not retried in the browser, which needs more space still; any other native failure is, and if that fails too its message carries the first error (the browser's "out of memory" no longer hides the cause).
- The layer format stays ProRes 4444: a smaller format with transparency (VP9) is far slower to encode, and deleting layers as they are used already bounds the space.
- Measured on the October 11 long-form edit (11:18, 12 chapter cards and overlays): exported in 574 s with a peak of 0.56 GB of work files.

## October 12, 2026 — Commands run in a POSIX shell

- The agent writes bash: `;` between commands, `head`, `\"` inside a `node -e` one-liner. Under cmd.exe those broke silently — `node -e "…"; type x | findstr …` piped node's output into findstr and came back empty, and `head` did not exist.
- Commands now run in BusyBox's sh (busybox-w32 FRP-6075, Unicode build, pinned by its published SHA-256, GPLv2, source linked in notices/busybox), on the user's computer and in the container alike. It brings POSIX quoting and the Unix tools (ls, cat, head, tail, grep, sed, awk, find, wc, xargs); Node, npm, Python, pip and ffmpeg run from it as before.
- Inside the AppContainer BusyBox cannot exec a program in its place (it exits at once and the job ends the program), so every command gets a final `exit $?`: the shell waits and passes on the exit code. An explicit `exec` in a command still fails there.
- A command that runs to its end is a result whatever its exit code, as in a terminal: the agent reads the exit code and output, nothing is marked failed or counted toward repeated failures. Only a stop, a timeout or a crash (a negative exit code) is an error.
- check_outputs with nothing to check answers with an empty list and a note instead of an error, and publishing a non-scene output outside output/ names the output, its kind and path, and both fixes (move it under output/, or declare a live scene as kind "scene").
- The creation runtime was restaged and passed qualification, with a new check for quoting, pipes and the Unix tools.

## October 12, 2026 — The agent sidebar follows Cursor

- A quiet header holds Chat and Media as text tabs and version history as an icon; the "Figjam" name row above each answer is gone.
- The user's message is a bubble on the right. The agent's notes are plain text; each step is one grey line with an icon for its kind (reading, searching, writing, running, publishing, looking); the live step shimmers, a failed one is red.
- A finished request folds into one line, "Worked for 49s · 11 steps" (or "Stopped after …"), above its answer; it opens to the full stream. A request that ended without an answer stays open. Its changes follow as small pills ("+7 clips", "− transition").
- The composer is one box: the timeline selection and attachments as small tiles inside it, the text, then + · mode · model and a round send button. Mode and model are plain text menus (Edit, Plan, Ask; Opus, Sonnet, Haiku). The run monitor and to-dos sit on top of the box like a tab, and "jump to latest" is a small round button on the chat's bottom edge.
- The sidebar uses the system UI font (Segoe UI); the rest of the app is unchanged.
- Timeline: a spare row for a new track keeps one height and only lights up during a drag; opening it moved every track under the cursor, so drops landed on the wrong row.
- After a stop, a message that ends with "continue" (after the feedback it carries) carries on with the stopped request, as one that starts with it already did.

## October 12, 2026 — Web search without the server sandbox

- A request failed with "code_execution tool use … was found without a corresponding code_execution_tool_result block". The 20260209 web search brings Anthropic's own code sandbox along (to filter results), and the agent took it for its workspace: it wrote its project.json edit there, next to an ordinary tool call. That code never ran, and the call without a result made the API reject the conversation.
- Web search uses the 20250305 version on every model, which has no sandbox; filtering results costs some input tokens instead.
- A server tool call left without its result is dropped from the saved reply (and from saved conversations when they resume), except in a paused turn, which is sent back as it is so the server can finish it.

## October 12, 2026 — Home, media, and no settings page

- Home is one greeting, "What do you want to create?", one box to start an edit (Add media, round send), four idea chips that fill the box, and recent projects as cards that lift on hover ("Edited today", length, an open arrow). The mark is the fig from usefigjam.com and the wordmark says figjam. The top of the page matches the window-control strip.
- The settings page and its buttons (home and editor header) are gone. Computer file access lives in the composer's mode menu; the local runtime status and the optional speech-model download had no other use.
- Media is a bin like CapCut's: search and Import, kind toggles with counts (All, Video, Audio, Images, Made by Figjam), 16:9 pictures with their length (tenths under a second), a muted preview on hover, Figjam's scenes as purple graphic tiles and audio as green waveform tiles. Only states that need attention show (preparing, transcribing, a failure to retry, a missing source to relink). Clicking selects for the next message with a sticky "N selected · Clear" bar; files dropped from the computer are imported.

## October 12, 2026 — Keyframes, and only Export renders

- Asked for "CapCut-style keyframes" panning up a pyramid, the agent baked each camera move into a new video with ffmpeg (a per-pixel blend over the whole clip took over ten minutes and hit the command limit twice) and swapped it in for the footage. The timeline had no way to say "zoom and pan over time", and the instructions sent anything the timeline could not express to processed media.
- Clips and attached items take `keyframes`: `sec` on the source clock (so trims, splits and speed changes keep them on their footage), any of scale, x/y (where the picture's centre sits), rotation, opacity, exposure, contrast, saturation and temperature, and an easing (linear, ease in/out, hold) for the move into each one. Each property moves between the keyframes that set it and holds outside them. The player draws them live; Export draws the same values in the browser renderer (ffmpeg's native path hands keyframed pieces over).
- Keyframes are white diamonds on their block: press one to jump there, drag to move it, Delete removes it.
- The agent is told camera moves are keyframes, other visuals are scenes, and processed media is never the edit itself. Commands that render scenes or the composition (the Remotion CLI's render or still, or the renderer API in a script the command runs) are refused before they start.
- Same day: scores are mastered to about -9 LUFS (one came out at -31 LUFS, inaudible under the music gain and ducking); resuming a conversation repaired for an unanswered server call starts a new journal scope instead of failing; the timeline says why it does not respond while Figjam is editing.

## October 13, 2026 — Motion graphics stay, on the one engine; plans are answered like Codex

- Phase 5 had removed coded scenes from v1. The user reversed it: the agent keeps writing Remotion, drawings and anything else as code, unrestricted. The revert brought the agent's instructions back; the new engine now shows scenes too.
- Preview: a scene is a layer in the frame model. Its own sandboxed document (dream-engine:// for engine scenes, the file for legacy HTML scenes) is placed, scaled and cropped where the frame model puts it and told which frame to draw. Whatever lies under the first scene is drawn on the engine's canvas below it; whatever lies over it (titles, captions, overlays) on a transparent canvas above. A scene that fails shows its error over the picture and the agent sees it next request, as before.
- Export: each scene frame is drawn in a hidden, transparent, off-screen window in the main process over the same frame protocol, captured with its alpha and composited by the same compositor as footage. A held frame is drawn once.
- Plans: under a proposed plan, a bar takes what to change (sent as a revision of the saved plan), Accept runs it, and underneath it a model menu (the composer's model by default) picks which model carries it out.
- Project files: writes go through a temporary copy and a rename, which Windows refuses (EPERM) while OneDrive or a reader holds the file. One helper retries for about a second, then writes in place.

## October 13, 2026 — The editor shows the agent working, and clips show their frames

- Model check: every run after the plan card's "Run with" went to the chosen model. The Northern Vietnam vlog was sent with Opus selected, so its plan ran on Opus (about $0.27) and the approved work on Sonnet. Gateway prices match Anthropic's list; about half of a typical run's cost is prompt-cache writes.
- Run clock: an approved plan continues the request it was planned in, so the clock counted from the planning hours earlier. Each run records when it starts (`run_started_at`, sent with `ai.status`); the task bar and the live stream count from it, and "Worked for" leaves out waits over ten minutes.
- While the agent edits, the editor shows it as Codex or Antigravity show an agent using a computer: a blue glow, a status bar with Stop, and Figjam's cursor visiting each block the streamed draft adds, moves or trims. The agent announces its phase (`ai.phase`) as soon as it is set, because full state refreshes reached the window after the first change.
- Timeline blocks draw real frames along the clip (WebCodecs through Mediabunny, from the playback copy, on a time grid per asset), so media the agent made with effects baked in, which has no import thumbnail, shows its picture instead of a colour block.
- Selection tiles each have an X. Right-clicking a block opens split, duplicate, delete and playhead moves (a menu, not a toolbar). The chat and timeline dividers show a handle and go further (chat 20–60%, timeline 15–80%).
- The task window puts tasks first with the cost and models used at their top right, and the latest activity beside them.
- Shortcuts: Ctrl+L or / types in the chat, Shift+Tab in the chat or Ctrl+1/2/3 pick Edit, Plan or Ask, Ctrl+Shift+M steps through the models.

## October 13, 2026 — Black and white, dark mode, Settings

- The whole app is black and white. The renderer's ~350 hard-coded colours were converted by script into a grey scale (`--n0` paper to `--n100` ink) and an ink accent, both redefined for dark mode; the blue agent overlay, errors, greens, timeline block colours and shadows were left as they are. Text on pictures (clip labels over frames, length badges) stays white on a dark scrim in both themes.
- Settings sits at the top right of home and the editor, as in Claude Code: Light / Dark / System (follows the system by default, remembered on this computer) and the keyboard shortcuts. The window's own controls take the page colour (`--chrome`) so the header reads as one strip.
- The home logo is bigger and monochrome. Version history is gone (Undo/Redo stay); change cards replace it. The task bar above the chat box stays small and opens its window only when clicked; the window closes for each new request.
- While the agent edits, the video gets a soft blue wash and a slow light sweep on top of the blue outline, and keeps playing underneath.

## October 13, 2026 — Change cards and the elements list

- Under each reply that edited the timeline, a card lists its changes one by one, as Codex and Claude Code show a diff: added, edited (what was trimmed, sped up, recoloured, retimed) and removed clips, elements and audio, captions, settings, order and tracks. Opening a row shows its details and selects the change on the timeline with the playhead on it, lit up, ready to drag, trim or right-click; Undo reverts that change alone as a new undoable step.
- The diff lives in `@dream/timeline` (`timelineChangeList`) with the operations that undo each change; the service answers `turn_changes` from the version before the request to its last version.
- An Elements tab lists everything on the timeline (clips, transitions, text, motion graphics, overlays, effects, filters, sound effects, music, captions), marks what Figjam added, can show only that, and selects or removes each one.

## October 13, 2026 — Auto is back, and GPT, Gemini and DeepSeek behind the gateway

- Auto is the default model choice again, decided per request from the request's words and route, with no extra model call: Haiku for a small, precise change to an edit that exists; Opus to plan difficult work (the approved plan then runs on what Auto picks for doing it); Sonnet for everything else; a question that changes nothing goes to Gemini 3.8 Flash when its key is set. A model the user picks always wins over Auto.
- The composer lists Claude Opus/Sonnet/Haiku 5.5, GPT-6 Astra, GPT-6.1 Sol, GPT-6 Luna, Gemini 4 Argon, Gemini 3.8 Flash, DeepSeek V4 Pro and DeepSeek V4.1 Flash, with prices from the official pages on October 13, 2026 (DeepSeek at its peak rate; Gemini 4 Argon doubles on December 1). A provider without a key on the gateway is listed but can't be picked.
- The gateway translates requests for these models from Anthropic Messages to OpenAI's Responses API (GPT, `store:false`) or Chat Completions (Gemini's OpenAI-compatible endpoint, DeepSeek) and their streams back into Anthropic events, so streaming, receipts, recovery and accounting are unchanged. Thinking blocks, cache controls and Anthropic's web search tool are left out for them; tool-result images move into the next user turn; DeepSeek V4 Pro gets a note instead of images. Keys: OPENAI_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY; `/providers` says which are set. Token counting for them uses Sonnet's tokenizer.

## October 13, 2026 — The user's choices win, editing taste, a smaller file search

- The editing agent is told first that the user's words are the brief: their explicit choices override every default and suggestion; it never substitutes, skips or waters down part of a request, does the rest of what it can and says exactly what it could not do and why, and offers ideas only after doing what was asked. "When the footage cannot meet a request, say so and offer an alternative" became "do the closest version and say what differs".
- Taste: a short summary in the system prompt (open on the strongest moment, cut what does not move the story, vary rhythm, prefer clean cuts, effects only with a reason, readable text in the safe area, clear speech over ducked music, consistent colour) and a fuller guide at context/editing.md, read before a first cut, a re-edit or a creative choice left open; helpers get the motion-graphics part. The fixed prefix grows by about 250 tokens (cap now 7,500).
- find_media results, which every later call re-reads (a third of the Northern Vietnam vlog's re-read tokens), are grouped by folder as one line a file (name, local capture time, kind, length, resolution, size, the asset it was imported as): about 75% smaller per file.

## October 13, 2026 — Why the vlog's sound effects kept failing

- The Northern Vietnam vlog's request ended with "Repeated attempts could not complete this step" while the agent was fixing each sound-effect error correctly. Four engine causes, all fixed: (1) a sound or score reported only its first problem, so three problems took three publishes; (2) the layer rule said "need unique IDs, envelopes within their duration and placement within the sound" without saying which layer or rule; (3) sound and music files were checked only at publish, not as they were written like scenes; (4) failures were counted per tool call, and publish_project has no input, so three different failed publishes looked like one step failing three times.
- Now every problem comes back at once, one line each with its path, layer, rule and the numbers to fix it (`describeIssues`); writing a .sfx.json or .score.json returns that check; failures are counted per distinct error (`failureSignature`: numbers and ids removed), so a new error after a fix is progress and only the same error three times ends the request; "Source range exceeds" says how long the source is.
- A silent repair of bad sounds (lengthening, renaming, clamping) was tried and dropped: it hides what the agent wrote. Leaving out a layer's id, pan, start, envelope or filter still gets an obvious default.

## October 13, 2026 — Haiku routes Auto; the vlog stuck on a disk-wide search

- Auto now asks Haiku (one low-effort call, a 2K-token allowance, about $0.0002) which model should do each request, or the next part of one (an approved plan, a continuation). It sees the request, the mode, the project's size and the models that can run, each with what it is good at, whether it can see images and its price, and picks the cheapest that will do it well; the keyword rules decide when it cannot answer. Picking Auto always decides again: a model pinned by an earlier pick no longer carries over (the vlog stayed on DeepSeek after the user switched back to Auto).
- The model menu shows each model's strengths and a cost tier ($ to $$$$$) under its name.
- The vlog's run sat on `grep -r ... /` and `find / ...` for ten minutes: the agent was searching the whole computer for the sound-design rules, because the error was vague and context/engine.md listed the layer fields without the required id or the two rules. The reference now gives the full format with defaults, both rules and a valid example.
- Caching per provider: DeepSeek's automatic prefix cache served about 98% of each call's prompt in the vlog run. OpenAI requests now carry a per-request prompt_cache_key so a request's calls share one cache. Gemini caches implicitly; not yet measured.

## October 13, 2026 — A project's second request was invisible; disk, scenes, dark mode, framing

- The window dropped every live event whose request id differed from the one it had on screen, so from a project's second request on it showed no steps ("Planning next moves"), no editing overlay and no Stop until the run ended. Events carry the service's current request, so a new id now means a new request: the window moves to it and refreshes once. Auto's Haiku router also never ran, because the model was pinned before it; it now runs first.
- From the moment a message is sent, the send button is Stop and the editor turns blue; a live card in the editor lists the last steps with the current one's command or file, or "Thinking" between steps.
- Showing a change (a change card, the Elements list) lights it up on the timeline with the playhead on it, without selecting it into the chat.
- Disk: agent-made music keeps only its mix (the separate instrument tracks, unused by the timeline, were 345 MB in the vlog); the playback copy of imported audio is FLAC instead of WAV (about half the size, same samples); files on this computer's own drive are always linked, never copied, whatever the agent asks. Existing projects keep their current files.
- Motion-graphics scenes show a still on their timeline block: one frame per scene revision, drawn in a hidden window that closes straight after.
- Dark mode turned a transparent captions scene into a white sheet over the video: Chromium paints an embedded document whose color scheme differs from the page's with an opaque backdrop. Embedded scene documents keep the default scheme.
- The main track always fills the project's frame: footage of another shape is cropped to cover it (never letterboxed), never zoomed out below the frame, and moves and shake only travel as far as the zoom leaves room.

## October 13, 2026 — Every part of a request gets done; tests stop filling the disk

- A message with several asks (a list, "and then", "also", several sentences) is split by Haiku into parts when an edit request starts; the agent gets the list, and finishing as complete is refused until it reports each part as done, or not_possible with the reason, which is added to its recap. One plain ask is not split (no extra call) and needs no report.
- 6.7 GB of the user's disk was test leftovers: about 7,700 scratch projects and profiles from test runs in the temp folder, none from the app. Both test runners now give each run one temp folder (TEMP/TMP/TMPDIR) and delete it at the end; folders from crashed runs older than an hour are removed by the next run.

## October 13, 2026 — The installed app is 1.6 GB, not 3.1 GB

- Left out of the installed app: ffmpeg-static and ffprobe-static (414 MB, binaries for every platform; the installed app always used staged/media-runtime, and they are now looked up only when running from source), the local analysis runtime staged/ingest (1 GB; only the retired audio_features step ran it), and imageio-ffmpeg's own ffmpeg (84 MB; agent commands set IMAGEIO_FFMPEG_EXE to the app's ffmpeg).
- Kept for now: the headless Chrome and Remotion renderer (about 330 MB) still serve the editable-timeline XML export and the old export code; moving those to the engine would remove them. The bundled Python and Node libraries (about 700 MB) are what the agent's own code uses.

## October 13, 2026 — Auto scores each request, and the score picks the model

- What went wrong in the last two days: a word rule labelled nearly every message "difficult, open-ended", and Auto asked Haiku for "the cheapest model that will do it well" from ten one-line descriptions and only the latest message. "make the caption white" went to DeepSeek Flash (described as the cheapest, though Haiku and GPT Luna cost a third of it) and took 12½ minutes; small talk bounced between DeepSeek, GPT Luna and Haiku; follow-ups like "its still there" or "go" were judged without the conversation.
- Now one Haiku call (triage, with its own reply schema on the gateway) reads the message with the last six messages, a stopped request and the project's size, and returns what it is (edit, answer, plan, continue), a difficulty from 1 to 5 with a rubric drawn from these requests, whether it needs eyes on the footage, whether it still wants a stopped request's asks, and its parts. It replaces the word rules (kept as the fallback), the model-picking call and the separate parts call. Requests without a composer choice (tests, the command line) use the word rules.
- The score picks a tier: an edit of 1 is light (Haiku, GPT-6 Luna, DeepSeek V4.1 Flash, Gemini 3.8 Flash), 2–4 strong (Sonnet, GPT-6.1 Sol, Gemini 4 Argon), 5 frontier (Opus, GPT-6 Astra); a plan of 4–5 is frontier; an answer of 1–2 is light. Within a tier the cheapest listed price among the providers that can run wins, a tie going to Claude. A model the user picks always runs. The score also sets thinking effort (1 low, 2–4 medium, 5 high; Haiku one step higher) unless the user picked one.
- A message after a stop that still wants the stopped request's asks ("aside from that…") carries them into the new request; the vlog's "put the definition on screen" was lost this way.
- The router's own thinking is no longer recorded as reasoning activity. DeepSeek V4 Pro is removed.

## October 13, 2026 — What the agent writes reaches the user and the next request

- Banana: the agent wrote the full ooga-booga script, finishing was refused because nothing had been published, it published an unchanged project, and only its one-line finish summary was saved. The user never saw the script ("i still cant see it"), and the next turns, seeing only that summary, rewrote it from memory and contradicted themselves about having looked at the drawings. 16 no-op publications across the two days came from the same rule.
- A request that changed nothing (the project is still the version it started from and no workspace file changed) now finishes complete without publishing. An edit request that only talks is still nudged, then stopped as blocked; finishing complete with no change takes an explicit finish.
- The saved reply is what the agent wrote: the text that ends its work (sent with finish, or a response with no tool calls), never replaced by a later short line. The finish recap follows it only when the project changed and the recap adds something. finish's summary is described as the reply the user reads (12,000 characters, was 4,000).
- The next request sees the latest reply in full (up to 8,000 characters) and earlier replies up to 2,500 (was 700 each), each longer one saying where to read the rest.
- Limits the model is never shown no longer fail a call: over-long text is shortened and over-long note lists cut, except paths, code, commands, URLs and ids. Part ids are matched on their number ("P1", "part 1", "p1-captions"); a one-part request is never refused for its report. A remembered decision may quote the user with the spelling fixed, as long as nearly every word is theirs.

## October 13, 2026 — Precise edits: the agent looks at its own edit and measures it

- Rough drafts worked; precise requests did not, because the agent edited blind. "make the caption white" was reported done three times while the captions showed dark; a green tint at 10–13 s took four guesses; "doesn't fit 9:16", "weird border" and an empty "VS" were each fixed by reading code. Every reply ended "I haven't watched the result".
- The user chose "player frames, when needed" (this replaces the October 8 rule that chat never draws frames; only Export still renders video). view_media with target preview now returns, for the published edit at the timeline times the agent picks (up to 12, or six over a range): exactly what is on screen at each moment from the engine's own frame description (the clip or item id, where it lands in the frame, opacity, grade, blur, text and colours, bottom to top), the frame as the player's engine draws it, and its measured colours (average and a 3x3 grid of region averages). The on-screen list is exact even when no window can draw.
- The frames come from the editor window: the main process sends frames.request, the window draws them with the compositor the player and Export use (source frames decoded exactly with WebCodecs, scenes through the existing scene capture) and answers through dream:framesResult. The old Remotion still-renderer is no longer used by the app.
- Engine components no longer drop settings silently: FitText takes the text's look directly (color, textShadow, WebkitTextStroke, letterSpacing, textTransform, fontStyle, textDecoration) and any prop FitText or SafeArea does not take comes back as a scene error naming what it does take. The vlog's captions were dark because FitText ignored color.
- Reading a still image the agent's code made: ffmpeg was always called with -ss 0, which skips a still's only frame, so 13 reads of .jpg sheets failed with "Source frame could not be decoded". Stills and time 0 are read without a seek.
- The scene engine's runtime source (packages/scene-engine/src/runtime) was never in git: a broad `runtime/` ignore rule covered it. It is tracked from now on.

## October 13, 2026 — Commands never sit silent for ten minutes

- Two requests sat on one command for exactly 600 seconds ("make the caption white" on DeepSeek, the Pyramid loop) and the user asked "whats taking so long". A command that left a program running in the background kept its output pipes open, and the runner waited for the pipes to close rather than for the command to end. A command is now over when its shell exits; the pipes get 1.5 s to drain and are then let go, with a note that a program it started is still running.
- A command still running after 4 minutes (DREAM_COMMAND_WAIT_MS) goes on in the background until its timeout: the call returns its output so far and its processId, freeing publishing and other commands; run_command with processId waits again, with stop true ends it, and finishing the request waits for background commands.
- Programs that start their own shell (Python's os.system, Node's exec, npm scripts) get cmd.exe on Windows, where `head` and friends did not exist ("'head' is not recognized"). Each command's PATH now ends with one-line .cmd shims for 43 Unix tools that run BusyBox's version, after the computer's own programs.

## October 13, 2026 — Captions follow the speech you hear, at the times it is said

- The vlog had no captions ("i dont see captions"): the narration was a separate recording on the music track, built-in captions read only the main track, and the agent's loudness-normalised copy of it was never transcribed because media made with code was skipped. Captions now read the speech heard: main-track clips that are not muted and music items at -10 dB or louder (beds, generated scores and sound effects are left out); captions.params.sources picks sources exactly; the same words heard twice are captioned once. Media the agent makes with code is transcribed like an import (synthesized scores and sound effects are not).
- Whisper stretches words across silence: the vlog's "made" ran from 1.7 s to 15.4 s and "I" sat 13 s early, so every caption built from the transcript drifted ("the captions dont match up with what the guy is saying"). Each word is now fitted to the sound in its own chunk: a 20 ms loudness mask against the chunk's quiet floor pulls it onto the speech actually heard, caps it at what a word can take to say, and moves a word with no sound under it next to the word it was stretched towards. On the vlog's first three chunks, words over 2 s went from 3 to 0 and "I made it" moved to 14.5–15.7 s. Saved transcripts are fitted again from their saved chunks when a project opens, with no new transcription.
- The language Whisper heard is kept on each word. read_transcript can hear a stretch again in a named language (the locals' Vietnamese inside English narration) or translate it to English (Whisper large v3 on the gateway's translations route), up to five minutes, as timed lines.
- The agent's fixed prompt stays under 7,700 tokens: tool descriptions no longer repeat what the engine's refusals already say.

## October 13, 2026 — Real music, sound and footage the agent may use, and web search on every model

- "find a good song" was answered "I couldn't license a real song, so I composed one", and "find actual fitting footage" spent 15+ minutes scoring the user's own clips. find_media with online (music, sound, footage, image) and a query now searches free-to-use libraries through the gateway's media-search route: Openverse (Jamendo, Freesound and others), Wikimedia Commons and the Internet Archive with no key; Pexels, Pixabay, Freesound and Jamendo join when their key is on the gateway, and OPENVERSE_CREDENTIALS (client_id:client_secret) lifts Openverse's anonymous limit of 20 searches a minute and 200 a day, shared by everyone on the gateway. Only public domain, CC0, CC BY, CC BY-SA and the Pexels and Pixabay licenses come back, never non-commercial or no-derivatives ones; MIDI files are left out.
- The libraries match every word: "upbeat acoustic travel" found nothing on Openverse. A query that finds too little is searched again more loosely (the first half of its words on Openverse, which has no OR; OR on Commons). Openverse's sound-effect category left out most sounds ("camera shutter" found none there), so only music is filtered by category. The Internet Archive failed on the wildcard license filter, with the error inside a 200 answer that read as "no results"; it now searches titles, subjects and descriptions excluding nc/nd licenses, and an error inside an answer is reported as that library failing.
- import_media takes online:<id>: the app downloads exactly that search result (https, media types only, at most 1.5 GB, once per project) into Media/Downloaded and imports it like any file. Its license, source page, creator and credit line stay on the asset and show in the media list. A request that puts downloaded media whose license asks for credit into the edit ends its reply with the credit lines, once, when it is added.
- GPT, Gemini and DeepSeek had no web search (Anthropic's server-side search was dropped for them), and Auto now sends them edits. They get web_search as a plain function, answered by one small Haiku call that searches with Anthropic's search and reports what the pages say, citing them: low effort, kept out of the live stream, its cost counted in the request.
- Live check, keyless and read-only: music "calm piano" 20 results, sound "camera shutter" 16, footage "ocean waves" 12; files downloaded from Openverse (Jamendo and Freesound), Commons (audio and video) and the Archive all decode.

## October 13, 2026 — The agent can bring back its own earlier work

- "revert the text change", "restore some of the drawings", "add back all the drawings litearlly allof them": every version keeps a snapshot of the agent's files, but the agent could not see them, so it rebuilt earlier work from memory (Banana took four requests to bring the 16 drawings back; the Supply & Demand hook's two blocks were redrawn instead of restored). Requests labelled as questions also refused edits ("the project is locked"); the scored router (now deployed) fixes that part.
- Each request's context now lists the edit's last 12 versions, newest first: id, time, the request that made it and the start of its reply. read_file and list_files take version (an id from that list) and return the agent's files as they were then; project.json comes back on the current base with that version's exact timeline and no pending outputs, ready to write over the current one. Reverting stays the agent's own file edit and publish, never a fixed action.
- The gateway was deployed (it had been stale since 20:12, so the scored router, translations and media search were not live until now).

## October 14, 2026 — Second full pass over the requests: plans answered with "continue", accidental stops, attachments in replies

- A plan answered with "continue" was planned again: only a short word list ("go", "do it", "looks good") approved a waiting plan, and anything else revised it. Banana's "add back all the drawings" plan waited 13 hours and Supply & Demand's 19, through "continue" and "continue work". The list now takes continue, cont, keep going, yeah go ahead and the like; any other reply is read by the triage, whose "continue" now also means accepting a waiting plan in any words, and that approves it. Asking for changes still revises the plan.
- Three vlog requests ("revert the change…", "just make the caption white", "can you add camera effects…") were stopped 2–5 s after sending and then sent again or followed by "cont": Send turns into Stop in the same place, so a repeated click stopped them. A Stop click within 1.5 s of the button appearing is ignored.
- Replies could not open the user's attachments in an archive: the Banana script turns had the drawings only as a .zip, and answers said "I didn't re-view your drawings". With the scored router, "a script for these drawings" is an answer, so this would now happen every time. A reply may unpack with import_resources into .cache/look, which is not part of the project's files, so looking changes nothing.
- Checked and already fixed: the OneDrive EPERM that ended the travel log's first request (it ran seven minutes before the retry landed), "Execution history changed" (Pyramid), the ten-minute commands, image reads, the no-op publishes and finish-input limits, the sound-file errors, the missing narration captions, routing.

## October 14, 2026 — The footage index: the agent knows its material

- Edit quality failed mostly because the agent never knew its footage: it sampled a few frames and took leftovers next to each scene for b-roll ("so ugly"), and Opus's better b-roll came largely from looking three times longer. The user chose to fix the core, like Cursor's codebase index, rather than add rules.
- Every imported video (and image) is indexed in its own background queue after import, and footage of older projects when they open: shots are found at cuts (colour change beyond what camera movement explains), takes over eight seconds split into parts of at most six, and each is measured from 96x54 frames at four per second: camera pan and tilt, shake (handheld, shaky), light, colour, sharpness against the source's own median (soft), how much moves (busy, still) and loudness. Thresholds were checked by eye on the Northern Vietnam vlog: a smooth drive on a mountain road reads steady, a walking street shot shaky, a selfie handheld; 126 cuts in 21 minutes, indexed in about 3.5 minutes from the 1080p original (faster from a playback copy).
- A small vision model (Haiku, low effort, about a cent per 20 minutes of footage) describes each shot once, twelve to a frame sheet: what is visible and generic tags (setting, day or night, people, shot size, subjects). The index is not pushed into the agent's context: find_shots searches it by meaning (words ranked like a search engine over descriptions, tags, spoken words and fact labels; -word excludes) and by facts (steady, speech, unused in the edit), and every result comes back with its frame on one sheet, so the agent judges with its own eyes and a wrong description costs a glance. Without a query it lists the shots in order. If describing fails (signed out, offline), the measured index still works and the describing is retried.
- Cut detection is colour-based: a cut between near-identical pictures (a jump cut) is not found, but long takes are split anyway, so every stretch stays searchable.
- The editing agent's fixed prefix may now be 8,000 tokens (was 7,700) for the index and listening tools; the footage paragraph of its instructions was rewritten around find_shots and is shorter.

## October 14, 2026 — The agent watches and listens: strips of the edit, and sound it can hear

- The agent could not hear: every sound complaint ("weird whoosh", "too annoying", "camera sounds are ass", music not matching the mood) came from sound chosen by loudness numbers alone. listen sends up to 90 seconds of a source's sound, a workspace file, or the published edit's own mix to a model that can hear (Gemini 3.8 Flash through the gateway, which now passes audio to Gemini as input_audio and tells other models it was there), with a question if it has one, and returns what is audible (speech and language, music with mood and tempo, effects, problems, with times) beside measured loudness, loudness range, true peak and silent spans. Without the Gemini key, or when hearing fails, the loudness still comes back.
- The edit's mix for a stretch is made the way Export mixes it (each sound's gain, fades and ducking under speech), only for that stretch, as a small mono MP3. Like a frame the player draws, hearing a stretch is on demand and is not a render of the edit.
- Watching: view_media target preview over a stretch draws about a frame a second (six to twelve) and returns them as one strip, with what happens there from the timeline itself (cuts and the source range each shows, items and sounds starting and ending) and its pace (shots, average, shortest, longest). view_media on a source adds the footage index's shots and facts for the range.
- Sound is counted by its length (32 tokens a second) in both the app's and the gateway's prompt estimates, never by the size of its encoded text. Listening, like describing shots and web search for other models, runs at low effort and stays out of the live stream; its cost counts in the request.

## October 14, 2026 — Auto picks the best model for the kind of work, and steps up after a rejection

- Auto took the cheapest model in a tier, and price ties made it Claude-only in practice. The user added GPT, Gemini and DeepSeek for people to try, and wants Auto to choose the best model for each job. The triage now also names the kind of work (talk, look, write, fix, footage, graphics, sound, restructure) and how the message takes the previous result (positive, negative, none). A table (bestFor in packages/config/src/models.ts) lists the best models for each kind of work by difficulty; the first that can run, and see when the work needs eyes, does it. Price does not decide. From the requests of October 12–14: Haiku for one-setting fixes and small talk; Sonnet for precise fixes, graphics and most sound (it made most edits work at the first try and writes the scenes); Opus for choosing footage and b-roll from difficulty 3, whole-video work, scripts that need writing and harder sound and graphics (its b-roll was kept); other providers stand in, in order, when Claude cannot run. A plan is Opus from difficulty 4, Sonnet below.
- A rejection ("its still there", "no revert that", "the b roll is ugly") moves the next request of the same kind of work a step up the ladder Haiku, Sonnet, Opus and a step up in thinking, one more step for each rejection in a row, at most two; an accepted result or another kind of work starts again. The green tint took four tries on one model; now the second try is Opus and the third Opus thinking harder.
- When the triage cannot name the work (word rules, an older gateway), it is read from the score: answers 1–2 talk, harder answers look, plans write or restructure, edits fix, a 5 restructure. The choice, the work and any step up are recorded with each request (ai.model_chosen).
- Deployed with the gateway on October 14 (triage reply with work and feedback; audio passed to Gemini; sound counted by length). The installed app's own ffmpeg (6.1.1, media-runtime) has the MP3 encoder and every filter indexing and listening use.

## October 14, 2026 — Haiku chooses from every model

- The user: "make haiku choose all the models that we have". The triage call now also returns model: Haiku is shown every model whose provider has a key on the gateway, each with a guide to what it is best at in this editor and where it falls short (ModelInfo.guide), the model that made the result the message may be reacting to (previousResultBy), and the rule: match the work to what each model is best at, cost only between models equally good for it, and a stronger model than previousResultBy after a rejection. Its pick runs when that provider can run; an unknown or unavailable pick falls back to the bestFor table. After a rejection the model must be above the one that made the result on the ladder Haiku, Sonnet, Opus, or it climbs from it.
- The guides are honest about the logs: DeepSeek Flash is for inexpensive text work and was slow and error-prone at editing with tools; Gemini 4 Argon reasons over long footage and many clips; GPT-6.1 Sol follows instructions carefully and writes well; GPT-6 Astra is rarely worth five times Sonnet's price for editing.

## October 14, 2026 — Auto weighs cost against difficulty; no forced climb; a smaller start

- The first runs on the new build cost $0.54, $0.64, $0.53, $0.16 ("there are duplicate captions", four steps) and $0.30, nearly all on Opus: the router was told to pick the best model with cost only breaking ties, Opus's guide called it the best at choosing footage, and after a rejection Haiku picked GPT-6 Astra and the climb rule made it Opus thinking harder. On Opus the first step alone (loading about 31,000 tokens of instructions and project) cost $0.21.
- Haiku still chooses from every model, now shown each model's typical cost per request (about $0.55 Opus, $0.28 Sonnet, $0.01 Haiku, $1.38 GPT-6 Astra, from the vlog's Opus runs scaled by list price) and told to pick the least expensive model that will do the request well at its difficulty: inexpensive models for small talk, quick questions and one setting on one thing, a capable editor for real edits, the most expensive only for work that needs their judgement (a first cut of long footage, a whole-video rework). Sonnet's guide is the usual editor, including footage and b-roll; Opus's is whole-video work and calls a cheaper model already got wrong. After a rejection Haiku is told which model made the result and to think about why it fell short; nothing forces a pricier model, and thinking effort no longer rises on rejections. The fallback table follows the same rule, and GPT-6 Astra is never a fallback.
- The starting context is smaller: workspace files as path and size without their hashes (at most 40), the latest 15 made media as one line each with a count, and the last 6 versions with shorter lines.

## October 14, 2026 — Gemini could not take a second step

- "why does the montage footage look so unsmooth and choppy" went to Gemini 3.8 Flash, whose first step (read project.json) worked and whose second was refused: "Google Gemini returned 400." Gemini 3 signs each function call (extra_content.google.thought_signature in its OpenAI-compatible stream) and refuses the next request unless the signature comes back with that call; the gateway's translation dropped it. Gemini had never run a multi-step request here: the October 13 Gemini answers were single steps.
- The gateway now passes the signature as a signature on the tool call (the app keeps it like any block field), sends it back to Gemini with the call, and strips it from anything sent to Claude. A provider's refusal now shows its own message (Gemini's comes wrapped in a list), not only the status.
- The first fix still failed ("Function call is missing a thought_signature… position 5"): Gemini's live stream did not put the signature where it was read. The gateway now finds a thought_signature anywhere in a chunk (on the call, the delta or the choice) and gives it to that chunk's call, the next call, or the call still open; and any call sent to Gemini without one (saved before, or made by another model) carries Google's documented placeholder skip_thought_signature_validator instead of being refused.

## October 15, 2026 — The agent works from the footage index on every request, without having to ask

- The footage index (October 14) was never used: in the Northern Vietnam Vlog's eleven requests after it was built, find_shots was called zero times, including "a summary of the trip at the start" and "the start of some of the clips are really shaky and jerky". Asked to fix the shaky montage, the agent cut it from 12 shots to 7 and kept the two shakiest (shake 2.9 and 4.5) while dropping the steady ones (0 and 0.2), which the index had measured. Eight requests went round the montage. A tool the agent may call changed nothing about how it works.
- The index is now part of what every request reads, as code search is part of Cursor's: each clip and footage item in the timeline outline of the first message says what its source range shows and how it was shot (the description of its main shot, camera, light, soft focus, shake, and any cut inside it). The edit reads as its material, whatever the request is about.
- Triage (Haiku, already run on every request) also writes lookFor: when a request needs footage chosen from the user's videos, what to look for in the words shots are described with. The shots the index finds for it come with the first message (footageForRequest, ten lines). Searching on the request's own words was tried and rejected: "a summary of the trip" matched buildings with shutters and a title card saying "trip"; lookFor ("rice fields, mountains, river valley, street food, lanterns at night, wide scenic, steady") found the aerial rice fields, the river between cliffs and the terraces. Requests that need no footage get no list.
- After each publish, every main-track clip it added or re-trimmed comes back with the same facts (footageInPlacedClips), and watching a stretch of the edit gives each cut its facts.
- Cost: about 7,000 characters more in the vlog's first message (40 outline lines and ten shots), in the part re-read from cache within the request.
- The gateway's triage schema gained lookFor; until it is deployed, triage replies have none and requests simply get no footage list.
- Deployed the same evening (gateway version 40), so triage replies carry lookFor.

## October 15, 2026 — An agent command can no longer take the computer's memory, and crashes leave a record

- "its just like starting and stopping and stuttering" (vlog, 20:58) ended with the app gone and nothing recorded. The agent's second command built the opening montage with one ffmpeg filter graph that fed the whole 21-minute 1080p source into seven trims of the one input; ffmpeg keeps every decoded frame for the trims not yet being read, so memory grows with every second decoded. The same shape over 60 seconds of 1080p peaked at 5.1 GB (one trim alone: 266 MB); over 1,130 seconds it would want around 95 GB. The computer ran out of memory and the app died with it. The command ran on the user's computer (computer access), which had no limit at all; the container's job object had no memory limit either.
- Every command now runs through the creation host in a Windows job object with a memory cap on the whole job (every program it starts): 60% of the computer's memory, leaving at least 3 GB, never under 2 GB (DREAM_COMMAND_MEMORY_GB overrides). Commands on the user's computer go through the host too, as the user (no AppContainer), so they are capped and a stop or timeout ends the whole process tree; programs a local command leaves in the background keep running under the cap. A command that reaches the cap has its memory requests fail and comes back failed with a note naming the cap and saying to process long media in pieces. The same ffmpeg command under a 2 GB cap stopped in 1.5 s.
- Crashes are recorded in <userData>/logs/crashes.log: the project service ending on its own (exit code, project, the last 8,000 characters of its stderr, which before went to a console nobody sees), renderer and helper processes going away, and main-process errors nothing caught.
- The host was rebuilt (.NET 8, artifacts/code-runtime-tools/dotnet), the creation manifest's host checksums updated and the creation environment qualified again (all checks, including npm, pip and stopping a child tree).

## October 15, 2026 — The $1.19 caption loop, what each model really costs, and what the agent sees

- "replace the captions with just normal white text" (vlog) cost $1.19 over 47 Sonnet steps. The built-in captions could not show: the words the player, the agent's view and Export read (playbackFootage) came only from main-track clips, and the vlog's narration sits on the music track. The agent built its own caption scene; after publishing, project.json's outputs were empty, so every check_outputs draft of it ran without its props and crashed, and the draft of the scene it then removed still blocked finishing. All three fixed (music-track words loaded, a song's odd word not captioned, drafts of published scenes keep their props, only drafts in the edit block finishing).
- Across all 93 requests in the nine projects so far: median $0.10, mean $0.19; seven runaway requests cost $0.60-1.41.
- Costs were checked against each provider's pricing page. Claude's were right. Gemini's thinking was not counted (its OpenAI-compatible completion_tokens leaves it out), DeepSeek was always billed at peak (half price off-peak), GPT-6 lacked its long-context rate above 272K, and Gemini's December 1 and January 1 increases were not scheduled. All fixed in the gateway and the app's mirror, held equal by a test. Deployed the same night (gateway version 41).
- A scripted turn now saves the frames view_media returns: captions were there, but a scene's first frame was captured before its window painted it, so the agent (and Export) got a blank first frame of a graphic while the frame description listed it. The capture now waits for the paint.
- Auto no longer favours Claude. Its picks across the projects were 50 Claude and 17 others, but no real edit ever went to another provider: Sonnet's description to the router called it "the usual choice for real editing", the fallback table listed Claude first for every kind of edit, and the model list always opened with Claude. Models of one tier (light, strong, frontier) now have the same description, the fallback is any model of the tier the work needs, and both the list and the fallback rotate per request. GPT-6 Astra is now a possible frontier fallback (2.5x Opus's price) like any other frontier model.
- The first fix was not enough: the router is Claude (Haiku), and shown "Claude Sonnet 5.5" beside "GPT-6.1 Sol" and "Gemini 4 Argon" with the same description and price, it still picked Sonnet. The router now sees only tiers (light, strong, frontier) with what each is for and its cost, never a provider or model name, and is told the tier that made a result it reacts to. It judges how much model a request needs; the app picks which provider's model of that tier runs, rotating per request.
- Auto now runs exactly three models: Claude Haiku 5.5 for light work, GPT-6.1 Sol for real edits (Sonnet's $2/$10 with cache reads at $0.10 instead of $0.20, and cache reads were most of a long request's cost) and Claude Opus 5.5 for the hardest. The router still names only a tier; a model name it returns counts as its tier. Every other model runs only when the user picks it. Without an OpenAI key on the gateway, Sonnet does Sol's work.

## October 17, 2026 — Switching projects no longer stops a running edit

- A request that went quiet on October 16 looked like a project switch, but the app's profile files were rewritten at 23:55 EDT, the minute it went silent: the app restarted. The switch was a real hole all the same. There is one project service process, opening another project closes the current one inside it, and closing cancels its request. The editor lets you open another project at any time.
- Opening or creating another project while a request runs now parks the running project's service: it keeps its own process, finishes the request out of sight and then closes. A new service opens the next project. Opening the parked project again takes its service back, still working or done. Opening the project that is already open and running does nothing to it. A parked request's frames are still drawn by the editor window (each frame request carries its own timeline and footage), and its media stays registered until it closes. Quitting the app closes every parked service too.
- A request still marked running when its project opens (the app quit, crashed or was stopped first) now gets a reply saying it stopped when the app closed and that "continue" picks it up, unless it already answered, and its unfinished steps are marked interrupted. A request stopped by closing its project says the same, not just "Stopped.".

## October 17, 2026 — The agent's export is the Export button's export

- There were still two video renderers. The Export button used the engine (the window draws each frame with the shared WebGL compositor from WebCodecs-decoded frames and encodes it; main mixes the sound, writes and joins the file), but an export the agent proposed as a file operation (render_video) went to the October 11 path: ffmpeg filter graphs drawing footage from the sources, with the offline rendering browser drawing what ffmpeg could not. The same edit could come out differently depending on who exported it.
- An approved render_video now begins the same engine job (agent-export.ts): main starts it for the version the export was approved for, the window draws and encodes exactly that timeline (the export.request event, answered the way the agent's frame looks are) and main joins it to the mix. The settings are the Export window's defaults (the project's size and frame rate, H.264, recommended quality), MP4 or MOV from the file name; progress, cancel (the agent's stop, the Export window's Cancel, quitting) and errors are the button's. A window that cannot draw the video, or closes, ends the job with its reason (failExport).
- The old renderer is gone: rendering.ts and native-export.ts (the filter graphs, piece planning, the browser fallback and DREAM_EXPORT=browser), with the scripts that benchmarked and compared it. The sound mix stays, in its own file (export-audio.ts), since the engine export still mixes with it. The rendering browser itself stays for the timeline (XML) export's scene clips and the scripts' review renders.

## October 17, 2026 — The preview plays fast montages without stopping at cuts

- Fast montages played in fits and starts: the picture stood still at cuts. Three causes in the preview player, all seen in code and in real footage. (1) The preview played the originals, and the user's phone footage has a keyframe every ~4.2 s, so a cut into the middle of a clip decoded up to four seconds of video before it could show a frame. (2) Every clip had its own video element, so even a jump cut within one source was a cold load and seek. (3) The lookahead checked only the one moment half a second ahead, so a clip shorter than that was never got ready, and the player held the last frame for up to 400 ms waiting for it.
- Long-GOP video gets a preview copy (`previewPath`): a keyframe every half second, at most 1080p (the short side), video only, H.264. Ingest reads the keyframe times of what the preview would otherwise play (packets only, the first minute, no decoding) and makes the copy only when the longest stretch without a keyframe is over a second. It is made in the background in its own queue, one at a time, after the source is copied and fingerprinted, so import and the first edit never wait for it; existing projects get theirs when they open. Only the preview player plays it (the `play` media variant); export and the agent's frames still decode the original, and the tiles, filmstrips and the old playback proxy are unchanged.
- The player keeps a pool of video elements instead of one per clip. A cut whose next clip picks up the same source within 0.1 s of where the playing video will be (the same shot going on) is played into by the playing element, with no second element and no seek. A jump cut reuses an idle element of the same source when there is one, so it only seeks. Within 0.1 s, not more, because a larger jump is a cut the editor meant: easing the playing video into it would show frames that were cut out.
- The lookahead walks every frame of the next second (each frame's layers worked out once per revision) and parks every clip that starts in it on its first frame, however short. The pure parts (finding arrivals, the continuation test, choosing an element) are in lookahead.ts with unit tests; the desktop playback spec plays a twelve-cut montage of 0.2–0.3 s clips and checks that the picture never stands still for more than a few frames.

## October 17, 2026 — The first call of a request carries only what every call needs

- The first Opus call of a request cost 13.6¢ before any work: it wrote 14,933 tokens of fixed prefix at the one-hour cache price ($8/M on Opus). Counted exactly with Anthropic's count_tokens (`scripts/prefix-tokens.ts`): the system prompt 5,974, Gumbo's 22 tools 6,519, Anthropic's web_search tool 2,440.
- System prompt and tools are cached for five minutes, like the conversation. The calls of a request are seconds apart, so five minutes covers them; the one-hour write cost 60% more to keep the prefix for a next request that rarely came in time. Supersedes the line above (in the cache entry) that kept system and tools at one hour across requests. A conversation waiting on its helpers still makes every breakpoint one hour.
- The project-document reference (format, clips, framing, keyframes, items, anchors, captions, effects; about 3,600 tokens) is no longer in the system prompt. The workspace writes it to context/project.md, and the prompt says to read it before the first edit of project.json in a request, as context/engine.md is read before a scene. A reply, a search or a look no longer carries it; an edit reads it once, at the same five-minute price.
- Web search is the plain web_search function for every model (about 100 tokens), answered by the Haiku search that other providers' models already used. Anthropic's search tool was 2,440 tokens on every call of every request.
- The prefix is 9,003 tokens (system 2,383, tools 6,519, search 101). The same first call costs about 6¢ instead of 13.6¢. The tool list stays whole: each tool is a few hundred tokens and the rarely used ones (file changes and export on the computer, decisions, resources) are needed when they are asked for.
- Gateway change (requires deployment): `cachedPrompt` gives system and tools the conversation's TTL.

## October 17, 2026 — The dashboard shows the money left in each API account

- Only DeepSeek publishes an account's balance (GET /user/balance); the dashboard reads it live with the gateway's key. Anthropic, OpenAI, Google and Groq show their balance only on their billing pages (no API for it as of today), so the dashboard keeps the balance read off that page, entered with Set balance, and counts it down by what the gateway billed on that provider since it was entered. Calls made with the same keys outside the gateway (scripts, other apps) are not seen, so Update it from the billing page now and then.
- Balances live in dream_provider_balances (service role only; migration 202610170002). Saving one needs the dashboard password like reading. A tile turns amber under $5 and red at nothing left; each links to its provider's billing page.
- Requires the migration and a gateway deployment.

## October 17, 2026 — Auto runs only Claude Haiku 5.5 and GPT-6.1 Sol

- Auto now chooses between two models: Claude Haiku 5.5 for light work and GPT-6.1 Sol for everything else, the hardest whole-video work and big plans included. Opus, like every other model, runs only when the user picks it. The router is shown only the light and strong tiers; a frontier tier or model it still names (an older prompt, a "still not fixed" climb) runs on Sol. Claude Sonnet 5.5 still stands in for Sol only when Sol cannot run (no OpenAI key on the gateway). Settings > AI says the same.

## October 17, 2026 — A full manual editor, laid out as OpenCut's

This entry supersedes "Manual UI is disabled while shared project/timeline code is retained" and the October 12 decision that dropped an OpenCut-style rearrangement.

- The header has two layouts: Gumbo (the chat beside the player and timeline, as before) and Editor, modeled on OpenCut Classic's editor (github.com/opencut-app/opencut-classic, MIT, notice in resources/notices/OpenCut-LICENSE.txt): an assets panel with a rail of tabs (Gumbo's chat first, then media and the libraries), the preview with OpenCut's transport (timecode, play in the middle, view controls; the timeline is the scrubber), and a full-width timeline under them. Both layouts edit the same timeline, versions and undo history, so the agent's changes and hand edits show on the same blocks; the choice is remembered per viewer. Gumbo's layout is unchanged.
- The code is written for Gumbo's stack, not pasted: the layout and tab set follow OpenCut's editor page and assets panel, the shortcuts follow its action defaults, and the timeline keeps the OpenCut interaction algorithms vendored on October 7.
- Shortcuts are OpenCut's in both layouts: Space or K plays, J and L step a second, arrows a frame (Shift: five seconds, was one), Home and End; S or Ctrl+B splits, Q and W split and remove the left or right part, Delete, Ctrl+D, Ctrl+C and Ctrl+V (paste at the playhead), Ctrl+A, Esc, N toggles snapping (remembered; Alt still skips it once), + − and 0 zoom, Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y. ? shows them all. There is still no button toolbar: the zoom slider is the only control on the timeline.
- Track headers gain a lock beside mute and hide. Media cards in the editor have a + that puts the piece on the timeline at the playhead (video and photos on the main track, audio on music).
- `pnpm dev -- <args>` passes the arguments to the app (for example `--remote-debugging-port`), so the running dev app can be driven from a script.
- The editor has OpenCut's properties panel on the right: what is selected, in plain sections (Transform, Adjust, Speed or Duration, Sound, Transition in for clips; Text, Transform and Timing for text; Fit, Adjust and Sound for overlays; the amount for effects; level, fades and ducking for music; the word, emphasis and caption style for captions), and the project's settings (canvas, frame rate, loudness levelling, captions) when nothing is. A value shows live in the preview while it is dragged or typed and is one undoable change when let go. Animatable values have a diamond: it sets or removes a keyframe at the playhead, and once a value is animated, changing it sets the keyframe at the playhead, as in CapCut. On the main track position is a keyframe (one keyframe holds it in place), since the main track has no still offset and always fills the frame.
- The preview is OpenCut's too: clicking selects what is there (overlays and text before the main track), a selected overlay or text is outlined with corner handles to scale it and a knob to turn it (Shift: 15° steps), and dragging it moves it, snapping to the frame's centre lines (Alt skips the snap). The outlines come from the frame description the player and Export draw, so they match the picture exactly. In Gumbo's layout a click still plays or pauses.
- The editor's timecode is OpenCut's: hours, minutes, seconds and frames.
- Transitions are a library in `@dream/timeline` (library.ts), so the editor's Transitions tab, the agent's project.json and the compositor share one list: cross dissolve, dips to black and white, flash, wipe, slide, whip pan, zoom in (`zoom_through`), zoom out, blur dissolve, spin, circle reveal (`iris`) and glitch. `transitionIn` gains `direction` (left, right, up, down) for wipes, slides and whips. Each is drawn by the one engine, centred on the cut over black, in the preview and in Export alike; wipes and reveals are masks in the compositor's shader, and a coded scene in a transition is masked by a clip-path computed from the same frame description. Transitions now work between any two clips with a picture (photos and scenes hold theirs), not only two videos.
- A dip to black now fades the outgoing clip to black and the incoming one up from it, centred on the cut; before, it cut to black and only faded the next clip in. A dip into the first clip still fades the video in from black (or white).
- Coded scenes carry no grade, blur or effects in the frame description, because the preview plays them in their own documents, which cannot be graded the way the compositor grades footage; before, Export graded a graded scene clip and the preview did not.
- On the timeline a transition is a small mark over its cut: click to select it (the properties panel then shows its type, length and direction), Delete removes it. A transition from the library is dragged onto the timeline (it goes on the cut nearest the drop, which lights up during the drag) or clicked (the selected cut, the cut into the selected clip, or the cut nearest the playhead). Library tiles play their transition on hover.
- The editor's rail gains OpenCut's asset views, each a library in `@dream/timeline` (library.ts) that the agent writes in project.json and the one engine draws in the preview and Export: Text (13 styles: font, outline, shadow, glow, box, and in, out and loop animations, typewriter included), Stickers (27, Gumbo's own vector drawings in the compositor, no image files or third-party art), Effects (motion: slow push, pull out, zoom punch, pulse, shake; looks: blur, vignette, glow, film grain, VHS, glitch, RGB split, pixelate, cinema bars), Filters (16 grade presets with an intensity) and Captions (the four styles). Every tile is drawn by the engine itself from a small edit holding that piece, so it looks like what the piece does, and plays on hover. Tiles show looks at full strength, since a tile is about a tenth of a 1080p frame.
- A piece is dragged onto the timeline or clicked: text and stickers go at the playhead on their own rows (the next free row when one is taken); an effect or filter dropped on a clip follows that clip, and a filter dropped on a clip grades the clip's own picture (`framing.filter`). Clicking text or a sticker moves the playhead to where its entrance animation ends, so what was added is visible with its handles, as CapCut plays a template once.
- Effects change the main track; `params.apply: "all"` also changes overlay footage and photos. Effect sizes follow the frame's height, so a 4K export looks like its 1080p preview. The grade gains tint, fade, hue and a teal-and-orange split tone, all in the compositor's shader.
- Hiding a track now hides that row's items: the frame description names an item's track as the timeline does (text, stickers, effects, filters, overlays). Before, hiding a text, effect or filter row did nothing to the picture.
- Text from before styles (no style, no animation) still fades in over 8 frames with the soft shadow, so existing projects look the same.
- The editor's canvas-ratio choice in the transport is a quiet outlined control like the rest of the bar, in light and dark.

## October 18, 2026 — The editor waits while Gumbo edits; a crash leaves a record

- While Gumbo is editing, the Editor layout is closed: the workspace shows Gumbo's layout (the chat beside the player and timeline), the switch shows Editor with a lock, and the editor comes back by itself when the edit ends if it was the layout chosen. A request sent from the editor's chat tab moves to Gumbo's layout for the edit.
- The Gumbo / Editor switch is a larger segmented control centred in the header, with the Gumbo mark and scissors, instead of small words beside the project name.
- On October 17 the app closed during an edit (a 21-minute video being imported, its preview being made and an agent command just finished) with exit code 0xCFFFFFFF and nothing in crashes.log: a crash in the main process runs no JavaScript. The app now keeps Electron's crash dumps on this computer (nothing is uploaded) and writes a marker while it runs; a start that finds the marker records in crashes.log that the last run ended without quitting, when it started, and the newest dump. The cause of that crash is not known yet.
- A preview cut short when the app closed no longer leaves its partial file in Media/Proxies: the next preview of that clip removes it.

## October 18, 2026 — Long edits stop compounding past 60k tokens

- Every step of an agent run resends the whole conversation, so a long edit costs more per step as it goes (the 10-minute Vietnam recap: 47 steps, the prompt growing from 6k to 99k tokens). The working context target, past which the conversation is compacted to half of it, is now 60,000 tokens for every model (was 180,000; Haiku 80,000). No step's prompt goes much past 60k, however long the run.
- Tool results are capped at 12,000 characters (was 24,000); a file read keeps up to 24,000, since the agent asked for that file and the editing guides run to about 12,600. The full result stays archived and readable. On the runs measured the cap changed nothing (the largest result was about 4k tokens); it guards against an occasional huge output.
- scripts/replay-cost.ts replays a finished run offline (no model calls) under other settings and prices it with the app's billing formula; it reproduces the real cost within 0-6%. Replays: Vietnam recap (GPT-6.1 Sol, 47 calls) $0.706 → $0.624 (−12%); a Sonnet 5.5 run of 46 calls $1.219 → $1.138 (−7%); a Sonnet run of 16 calls $0.716 → $0.695 (−3%); an Opus 5.5 run of 28 calls $1.422 → $1.432 (+1%). Compacting rewrites the cached prefix, which is billed as new input (and on Claude written to the cache at 1.25x), so on Opus, whose cache reads cost 5% of input, the rewrites cancel the saving. 40k was measured too and rejected: with Gumbo's ~22k-token system prompt and tools, Claude runs compacted 18-39 times and cost up to 70% more.
- Playing no longer re-renders the workspace every frame. The player's frame lives in its own small store (store/playhead.ts) that only the playhead line, the timecode and the scrubber follow; the editor's frame is set when playback stops or the playhead moves. On the 10-minute Vietnam recap (117 clips, 121 sound pieces, 150 text items) each re-render took about 300 ms in the dev build, so it played at 2 to 5 frames a second; it now plays at 40 to 50. Actions taken while playing (split, paste, adding a piece) read the live frame when they run.
- While a new request is starting, the task dock shows no cost until that request's first call, instead of the previous request's total.
- Typing in the chat box no longer re-renders the workspace: the draft lives in its own store (store/draft.ts) that only the box follows, and sending reads it. On the long Vietnam edit a keystroke took about 130 ms and now takes about 12 ms.
- Timeline filmstrips are drawn off screen and shown as images. As canvases, each one became its own compositing layer once drawn; with a hundred clips the page re-layerized for about 20 ms every frame while anything animated (Gumbo's working indicators, the playhead), which made the whole app feel slow during an edit. Layers went from about 160 to under 50.
- Later the same day: compaction stopped thrashing. A run of the Vietnam project (turn 201b5ae1, 44 GPT-6.1 Sol calls) compacted six times, twice only six calls apart: compacting to half the 60k target left too little room once images and transcripts came in, and each compaction re-billed about 15-25k tokens as new input. Compaction now cuts the conversation so the whole prompt lands near 20k (compactTo), at most once every 6 calls (compactGap) unless a prompt passes 90k, and never so deep that the latest exchange, the result the agent has just been given, is summarized away.
- OpenAI's prompt cache was keyed to the request id, so every new request and each worker began cold (the Vietnam run's first call: 14.5k tokens, none cached; its worker's: 21.3k). The gateway now keys it to the user and the stable prompt start (model, instructions, tools), so a new request reads the system prompt and tools its earlier requests cached. Claude needed nothing: its cache follows the exact prefix and its first calls already read 15-17k. Nothing per request sits in the system prompt or tools; the per-request briefing and project state come after them. This takes effect when the gateway is deployed.
- Replays (scripts/replay-cost.ts; "warm" assumes the system prompt and tools are cached at the start, as the new key allows for GPT and as Claude already had):

| Run | Before Oct 18 (180k) | Morning (60k, to half) | Now (to 20k, gap 6) | Now, warm start |
|---|---|---|---|---|
| Vietnam "next" (201b5ae1, Sol, 44 calls) | $0.831 | $0.824 (5 compactions) | $0.737 (4) | $0.726 |
| Vietnam recap (5f0681b2, Sol, 47 calls) | $0.706 | $0.624 (2) | $0.593 (1) | $0.585 |
| Opus 5.5 run (28 calls) | $1.422 | $1.432 | $1.405 | (already warm) |
| Sonnet 5.5 run (46 calls) | $1.219 | $1.138 | $1.138 | (already warm) |
- Compaction can no longer repeat every few calls. On October 18 a request compacted 14 times, at the end on every call ($0.06 to $0.08 each, against $0.01 for a normal call), because what a compaction keeps came to about 47k tokens against a 60k target: the brief, twenty receipts with 1,000-character excerpts, the project state, copies of recent reads (30% of the target) and the latest results. A compaction now keeps the latest ten receipts with 300-character excerpts and recent reads up to 15% of the target (both stay readable from the archive), and it runs only once 25k tokens have come in since the last one left the prompt, and no sooner than six calls after it; only a prompt past 1.5 x the target or the provider's limit compacts sooner. The offline replay of that request: $1.53 with the 180k target of before October 18, $1.16 now (it really cost $1.77).
- A request pauses once a stretch of it has cost 50 credits ($0.50 of AI cost: the main agent, its helpers and its looks at media), with its work saved and a message saying so; saying continue gives it another 50 from where it stopped. Before, nothing stopped a long run but the user watching the counter. The limit is engineBudgets.requestSpendUsd.
- Scenes can place source video by seconds: `<SourceVideo startAt={seconds}>` beside `startFrom` (scene frames). An agent working from a 60 fps source in a 30 fps scene offset by the source's rate and showed the wrong moments, then spent about ten looks finding why; seconds need no frame rate.
- A look at media asked for a range past its end, or for an empty range, now shows the nearest valid stretch and says so, and a frame that cannot be decoded at the very end of a clip is taken a moment earlier, instead of failing the step.
- A look at the edit with no times or range now shows the whole cut: a frame from the middle of every shot on the main track (sixteen at most, evenly chosen), on one sheet of four to a row. Until now it drew only the first frame, so an agent checking a 16-shot cut looked at each shot on its own (twelve looks where one does).
- The gateway passes the request's effort to DeepSeek V4.1 Flash as its thinking effort (low and medium to low, high to high, xhigh to max). Without it DeepSeek thought at high effort on every call, and an edit took about 10 minutes of model time where GPT-6.1 Sol took 2.5. Live only once the gateway is deployed.
- New GPT requests still began cold after the cache-key change (the Vietnam project's turn 089c718f: 14,933 tokens, none cached, 78 seconds after the last call of the request before it). Rebuilt offline from the run's own records, its first call and the next request's (4e6136cc) send byte-identical instructions (7,784 characters) and tools (15,928, matching the recorded sizes) under the same cache key, and their input agrees for its first 5,940 characters: about 8k tokens a gateway running that change reads from the cache. DeepSeek, cached by prefix alone, already read 9k on its first calls. Nothing per request sits in the prompt start. Hits only within a request are what the old key, the request id, produces, so the deployed gateway is most likely not running the change yet. To make this checkable, a GPT call's receipt now names the cache key it was sent with (dream_policy.features: prompt-cache-key:gumbo-<user>-<prompt>; the old gateway gives only cost-receipts), and the gateway's health answer says promptCacheKey: user-and-prompt. A test builds two editing requests from the real system prompt and tools and checks the prompt start and key are identical and hold no date, request id or project text.
- After a compaction, Claude calls re-wrote their whole conversation to the prompt cache on every call instead of reading it (the Vietnam project's turn 67c4e6ea on Opus 5.5: the three calls after the compaction each read only the 23,900-token system prompt and tools and wrote 9,328, then 11,561, then 13,855; about 5-7 cents a call). Rebuilt offline from the turn's checkpoint, those calls sent byte-identical, append-only conversations; what changed was the task budget's remainder, sent only once a conversation is compacted and recomputed each call from the output so far (108,013, then 107,879, then 107,684). The task budget sits in output_config with effort, and changing it resets Claude's message cache. The remainder is now the budget left where the compacted conversation starts (Claude counts what follows itself, as before the first compaction), set once per compaction and kept until the next one. A test sends 40 Opus calls with a task budget through the real gateway handler and checks that between compactions each request to Anthropic is the previous one with only new messages at the end; before the change it failed on the remainder alone. GPT-6.1 Sol never had this: other providers get no task budget. The fix is in the app; the gateway needs no redeploy.
