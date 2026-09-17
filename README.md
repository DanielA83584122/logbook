# [still](https://github.com/divyavenn/still)

A document-style logbook. React + TypeScript, Vite, styled-components, FastAPI, and Neon PostgreSQL.

## Run it

Requires Node 22.12+ and Python 3.12+. On this Mac, Homebrew Python is `/opt/homebrew/bin/python3` (the system Python is too old).

```sh
npm install
/opt/homebrew/bin/python3 -m venv .venv
.venv/bin/python -m pip install --index-url https://pypi.org/simple -r backend/requirements.lock.txt
npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies `/api`, `/journal.md`, `/llms.txt`, `/openapi.json`, and `/docs` to FastAPI on port 8000. On another machine, use any Python 3.12+ executable to create `.venv`.

For one server serving the production build:

```sh
npm run build
npm start
```

Then open **http://127.0.0.1:8000**. Start or restart FastAPI after building so it registers the static assets.

Vite uses the official `esbuild-wasm` package through an npm override. This avoids a native esbuild executable that is killed on this Mac. Application code still runs normally in the browser.

## The daily practice

- Open the page and type. The cursor starts on a new bullet under today. Notes save after 700 ms of inactivity; Enter commits the bullet and opens the next one. Shift+Enter adds a line break.
- Drafts are saved to localStorage immediately, including edits and new to-dos. Failed note saves can be retried, and a stable client ID prevents duplicate notes if a response is lost. A refreshed page restores an unsaved draft or starts a new bullet if the previous one reached the server.
- Click existing notes or to-dos to edit. Enter saves and opens a new sibling with the cursor ready to type; blur saves, and Escape cancels an edit. Clearing the text and leaving the entry deletes it.
- Journal bullets and to-dos share 15 px text, 18 px line height, and compact paragraph and row spacing. The light-mode timer uses a soft cool gray, shifting to muted teal while running.
- Both lists support eight levels of nesting. Tab nests under the preceding sibling; Shift+Tab outdents. Enter inserts the next bullet at the same level. Backspace at the start merges into the preceding bullet in the same list, with the cursor at the join. On an empty new bullet it removes the draft and moves to the preceding bullet’s end, or dismisses it if there is no preceding bullet; Shift+Tab outdents an existing nested item. A new bullet after reopening the page starts at the root. Note parents have a small disclosure arrow in place of the bullet; to-do parents have a round progress marker. Both start collapsed. Hovering the marker previews the children until the pointer leaves the branch; click to keep it expanded, and click again to collapse. Logbook bullets indent by 32 px per level on desktop (24 px on medium windows and 16 px on narrow windows), and branches reveal or collapse with a gentle progressive transition. Each level opens independently; nesting while typing opens its ancestors, and collapsing a branch saves an active edit before hiding it.
- The blank to-do checkbox appears while its new entry has focus. An untouched new journal bullet or to-do disappears completely on blur or Backspace. A draft typed into and then erased also disappears on blur, even if it had autosaved. Click the blank space beneath any date, including historical dates, or below the to-do list to begin a tentative bullet at the end. Leaf to-dos have checkboxes. Parent to-dos have round progress markers showing completed direct children. Checking a child immediately appends `finished {task}` to today and leaves the child dimmed and struck through until its parent finishes. The final child automatically completes and logs its parent, recursively. A completed sub-parent remains dimmed under its own open parent, while its children disappear. A finished root and its subtree leave the list. Each task is logged once, in the date it finishes. Completion and the resulting notes are written in one transaction. Undo restores the task state, including any automatically completed ancestors; edited journal notes are preserved.
- The timer shows hours, minutes, and seconds. Click it to start a mix of white, pink, and brown noise; its fill and concentric ring shift to a muted teal while running. Click again to finish, save the session, and reset the timer. Right-click the timer (or use Shift+F10) for mute/play and volume, including in timer-only mode. Command/Ctrl+Shift+M also opens the sound menu. The volume and mute preference are remembered.
- Refreshing or closing the page does not stop a running timer. Reopening it restores elapsed time from the server. Browsers require a gesture to resume audio after a reload: open the timer’s sound menu and choose Play sound.
- Total focused time appears beside each date, including seconds and the running session (for example, `30s`, `2m 05s`, or `1h 02m 05s`). Zero-second totals are hidden. Click the date or total to open sessions: the date and total form the heading, followed by borderless start-time and duration rows. Click a time to edit; Enter saves. Editing preserves the original start date, and changing only the duration preserves the original start seconds. The small animated × deletes a session and updates the total; + at the bottom adds one. Click outside or press Escape to close. Statistics open separately from the icon beside the theme toggle.
- Today appears automatically at local midnight, including when the page resumes after sleep. Historical days appear newest first and load in pages of 14 dates as you reach the bottom of the logbook. Background refreshes update the current page and retain already-loaded history.
- The document uses Söhne at a light weight, a dusty cool gray background, and wider side margins. The small sun/moon switch in the page’s top-right margin toggles night mode (navy `#011627`, gray `#c0c7d1` text, teal `#75d1c4` links; light-mode links are blue and links are never underlined) and remembers the choice locally. The icon is a sun in light mode and a moon in night mode. The document is centered with generous side margins. The round timer has a thin concentric ring and sits beside the to-do list in the same document grid. The outer ring aligns with the first to-do row at the top and the logbook text at the right edge. The to-do list expands to fit all its items above the independently scrolling logbook. If it exceeds the window height, the page scrolls while the timer stays sticky in its document column. Click “to do” to fold or reopen the entire list. Margins shrink progressively on smaller windows; nested indentation also shrinks to preserve readable lines.
- At widths of 640 px or less, or heights of 480 px or less, the timer is centered at the top with today’s notes filling the remaining space beneath. To-dos, historical days, header icons, and the tag sidebar are hidden. Narrow, tall windows keep today’s notes; only heights of 230 px or less switch to timer-only mode. Shared media queries keep every section on the same breakpoints.
- The statistics icon next to the theme toggle (or Command/Ctrl+Shift+S) opens 7- or 30-day summaries. Choose all calendar days or days with focus as the averaging denominator. Statistics explicitly include completed sessions only. Exact durations and averages display seconds; averages are floored to whole seconds. Zero days have zero-height bars and the scale follows recorded focus.

## Text formatting

Both to-dos and journal bullets render formatting as you type. Select text and use a shortcut, or toggle a format before typing. Links open in a new tab from saved text; click elsewhere on the bullet (or focus it and press Enter) to edit. There is no toolbar. Both lists use the same `Outline` component for draft lifecycle, saving, nesting, Enter, and boundary navigation, and the same `RichTextEditor` for text selection, formatting, and link behavior.

| Action | Mac | Windows / Linux |
| --- | --- | --- |
| Bold | Command+B | Ctrl+B |
| Italic | Command+I | Ctrl+I |
| Underline | Command+U | Ctrl+U |
| Add or edit link | Command+K | Ctrl+K |
| Inline code | Command+Shift+C | Ctrl+Shift+C |
| Strikethrough | Command+Shift+X | Ctrl+Shift+X |
| Clear formatting | Command+backslash | Ctrl+backslash |
| Undo | Command+Z | Ctrl+Z |
| Redo | Command+Shift+Z | Ctrl+Shift+Z or Ctrl+Y |
| Heading 1–6 | Command+Option+1–6 | Ctrl+Alt+1–6 |
| Plain paragraph | Command+Option+0 | Ctrl+Alt+0 |
| Blockquote | Command+Shift+B | Ctrl+Shift+B |
| Code block | Command+Option+C | Ctrl+Alt+C |

Command/Ctrl+K opens a single URL field only when text is highlighted. If the clipboard contains a URL, it prefills the field; otherwise an existing link URL is used. Press Enter to apply, Escape to cancel, or clear the URL and press Enter to remove the link. Clipboard access depends on browser permissions; manual entry always works. Edit link text directly in the document, or right-click a link to open two unlabeled fields (text, then URL). The text field matches the link color, and the URL is a harmonious purple. Both fields remain borderless. Enter saves; Escape cancels.

Night-mode links retain the requested teal color without bold or underlines; their distinction from surrounding text relies on color, a known accessibility exception. Light-mode colors meet the contrast checks for both the background and surrounding text.

Typing directly against either end of a link extends that linked word. A separating space keeps new outer words unlinked; spaces and words inserted inside a multiword link stay linked.

Inline code uses a monospace font with a subtle color and background; code blocks have no syntax highlighting. Enter within a code block adds a line; Command/Ctrl+Enter saves the bullet. Standard selection, cut, copy, paste, and Shift+Enter line breaks work inside the editor. Tab and Shift+Tab continue to change the bullet's nesting level. Undo/redo first uses the active bullet’s typing history, then the shared document history across entries. Arrow Up/Down crosses bullet boundaries; Backspace/Delete at a boundary merges adjacent bullets in the same list. Command/Ctrl+A selects the current bullet; press it again consecutively to select the day or to-do list, including collapsed descendants. That selection supports copy, cut, paste, replacement, and bold/italic/underline/strike/code formatting. Multi-entry edits are atomic and undoable. History survives reload and refuses to overwrite conflicting changes from another window.

Each bullet's `content` remains a PostgreSQL **TEXT** column containing Markdown, for example `**bold**`, `*italic*`, `[link](https://example.com)`, `` `code` ``, `~~strikethrough~~`, and `++underline++`. Underline uses the `++` extension because CommonMark has no underline syntax. The backend preserves the submitted Markdown, including significant whitespace. JSON is used for API transport; editor document objects and HTML are not stored in PostgreSQL. Journal and export responses identify `content_format: "markdown"` for agent consumers.

Literal Markdown punctuation is escaped when typed as plain text. Pasted rich text keeps supported formatting; arbitrary styles and unsafe links are discarded. Completing a task preserves its Markdown, including nested descendants. Block content receives the `finished` prefix in a separate paragraph so headings, quotes, and fenced code retain their meaning.

## Tags

Type `#name` anywhere in a bullet or to-do to create a light gray tag chip. `#` opens suggestions from existing tags; type to narrow them, use Up/Down to cycle, and Enter or Tab to choose. A new name becomes a tag automatically. Click a chip and press Backspace to remove it. Hashtags inside code and links remain literal text.

Tags are **separate from Markdown content**: the `notes.tags` and `tasks.tags` columns contain JSON arrays, such as `["work", "health"]`, defaulting to `[]`. The API accepts and returns `tags` as a list. Omit it on PATCH to retain current tags; send `[]` to clear them. A bullet may contain just tags. Tag chips are editor UI; saved `content` never contains the hashtags created by this shortcut. Committed chips move to their final trailing position while editing, with leftover shortcut whitespace removed, so saving does not rearrange the bullet. Names are case-insensitive and support letters, numbers, underscores, and hyphens, up to 64 characters.

Hover in the outer half of the left margin (or keyboard-focus the Tags navigation) to reveal the sidebar. The left margin is slightly wider than the right. A “logbook” home link sits above a wrapping collection of rounded tag pills, without selected highlights or bars. The rest of the page blurs and dims while the sidebar is open. Move back to the document or press Escape to close it. Select a tag to show matching to-dos and notes **plus all their children**, across paginated history. The active tag is hidden inline, and all sidebar tags remain hidden until the sidebar is opened again. New entries in that view inherit its tag. Click “logbook” to return to everything. Tags and suggestions derive from saved notes and open tasks, so unused tags disappear automatically. Completing a task copies its tags to the resulting journal bullet, with a restrained pop/fade and slide animation that respects reduced motion.

Inline tags use fully rounded pills with balanced vertical padding, more horizontal padding, and space around the pill so it cannot overlap neighboring text. Their muted color differs from the date background. Saved bullets and active editors share the same pill styling.

The top-right controls form a compact group. Hover changes their color and gently animates the glyph without adding a background highlight. The GitHub icon opens [this repository](https://github.com/divyavenn/still). To point a fork at a different repository, set `VITE_REPOSITORY_URL` in `.env.local` and restart Vite. `.env.example` documents the setting.

`GET /api/tags` returns tag names and note/task counts. `GET /api/journal?tag=work` returns matching branches, retaining original parent IDs; filtered roots may have parents omitted from the response. The current date remains available for new entries. There is no separate tag registry or stale tag counter.

## Search

Command/Ctrl+F opens search across all stored notes and visible to-dos, including unloaded dates and collapsed branches. Up/Down selects a result; Enter opens its date and expands its ancestors. Results paginate without loading the entire archive into the document. Selecting a result clears the tag filter so the surrounding context is available.

## Data and time

The application uses Neon PostgreSQL. Put the pooled connection string in `DATABASE_URL` and its direct counterpart in `DATABASE_URL_DIRECT`; see [`.env.example`](.env.example). `DATABASE_URL` serves normal traffic. The direct URL is only for schema migrations and the one-time legacy-database import. There is no seeded or fabricated journal data.

Neon gives the online logbook durable PostgreSQL storage, encrypted connections, managed backups, and concurrent access from multiple devices. The app uses a small transaction pool for ordinary traffic, transaction-scoped advisory locks for compound edits, and a direct connection for migrations. Foreign keys, transaction isolation, and a unique index allowing only one running session protect consistency. Schema migrations run at startup; the current schema is version 7.

The normalized tables are:

| Table | Stored facts |
| --- | --- |
| `days` | Unique journal date and creation timestamp |
| `notes` | Day reference, Markdown content, JSON tag list, parent note, sibling position, timestamps, optional source task, retry ID |
| `tasks` | Markdown content, JSON tag list, parent task, sibling position, creation and completion timestamps, retry ID |
| `sessions` | UTC start and end timestamps; a null end means running |
| `document_operations` | IDs, timestamps, and undo/redo state for document transactions |
| `document_changes` | Relational before/after row images for each changed bullet; Markdown and tag arrays retain their normal representation |

Totals and statistics are derived; no aggregate counters can become stale. Timestamps are UTC ISO 8601. The browser supplies its IANA timezone. Notes keep the calendar date they were written under; session and task-completion statistics are grouped in the requested timezone. Sessions crossing midnight are split using real local day boundaries, including 23- and 25-hour daylight-saving days. The longest session for a day is that day’s longest uninterrupted portion of a session. Overlapping or future manual sessions are rejected.

Bullet hierarchy uses an **ordered adjacency list**, not a JSON document. Each bullet is a row with `parent_id` (a self-referencing foreign key, null for roots) and integer `position` among its siblings. Depth is derived from the parent chain. This allows individual edits, transactional branch moves, recursive SQL queries, and per-bullet analytics without replacing a whole document. The API returns flat records with parent IDs; the UI reconstructs nested HTML lists.

The API rejects cycles, missing parents, nesting notes under a different date, and moves that would push any descendant beyond eight levels. PostgreSQL foreign keys and deferred constraint triggers also enforce valid parent references, acyclic trees, and same-day note ancestry. Deleting a parent promotes its children one level in the same order. Indenting or outdenting carries the whole branch. Parents complete automatically when all direct children are complete. `completed_at` remains the single persisted completion state; visibility and progress are derived from the task hierarchy. A completed child is retained while its immediate parent is open. Parents cannot be manually completed while they have unfinished children. Reopening a child reopens completed ancestors and keeps earlier completed siblings intact. Automatic completion also runs after moving or deleting the last unfinished child.

Export a normalized snapshot with `GET /api/export`. Use Neon’s point-in-time restore and branch features for backups. To transfer a previous local logbook into a new, empty Neon database, first validate without writing, then explicitly import:

```sh
.venv/bin/python -m backend.import_sqlite --sqlite data/still.sqlite3
.venv/bin/python -m backend.import_sqlite --sqlite data/still.sqlite3 --apply
```

The importer preserves IDs, Markdown, tags, hierarchy, sessions, and undo history; it opens the legacy file read-only and refuses to write into a nonempty Neon target. Keep the SQLite file as a local backup until the imported site has been checked. This API has no user authentication yet; deploy it behind an authentication layer before exposing it on the public internet.

## Agent API

Agents can start at **`/llms.txt`**, then read **`/api/agent/journal`** for structured JSON or **`/journal.md`** for Markdown. These representations work without JavaScript and include collapsed descendants and history beyond the browser's loaded page. The HTML advertises them through alternate links, and the production server adds HTTP `Link` headers. A no-JavaScript browser gets a link to the Markdown document. No controls are added to the interactive interface.

```sh
curl 'http://127.0.0.1:8000/api/agent/journal?start=2026-09-01&end=2026-09-17&timezone=America%2FLos_Angeles'
curl 'http://127.0.0.1:8000/journal.md?tag=work&q=design&timezone=America%2FLos_Angeles'
```

The versioned JSON includes ISO dates, original `content_markdown`, separate tags, explicit `{text, url}` links, stable `(kind, id)` keys, ordered `children`, task completion relationships, and numeric focus durations in seconds. Completed and running durations are separate. Sessions crossing midnight expose both their whole duration and `seconds_on_day`, so daily sums do not double-count time.

Date ranges are inclusive and default to the last 30 calendar days, including zero days. `limit` paginates 1–100 dates; follow `next_url` until null. `tag` and `q` filter bullets while retaining matching descendants and ancestor context (`matched: false`); focus totals remain unfiltered because sessions are not assigned to tags. `tasks=visible|all|none` selects the current task snapshot independently of the note date range. The next-page URL omits tasks to prevent repetition. Each response uses a read-only PostgreSQL snapshot and includes only saved data. `/llms.txt` documents the full contract and query semantics; OpenAPI defines the recursive response schema.

The production homepage supports the same queries with `Accept: application/json` or `Accept: text/markdown`. On Vite, use the explicit representation URLs. Agents need network access to the running site, just like a browser; no data is sent to an external LLM service.

Interactive OpenAPI docs: **http://127.0.0.1:8000/docs**. Machine-readable schema: `/openapi.json`.

| Endpoint | Purpose |
| --- | --- |
| `GET /llms.txt` | Agent discovery guide, data contract, and query examples |
| `GET /api/agent/journal` | Read-only, versioned document tree with date/text/tag filters, links, tasks, focus totals, and session allocations |
| `GET /journal.md` | The same filtered document as Markdown, without JavaScript |
| `GET /api/tags` | Existing tag names and counts from notes and open tasks |
| `GET /api/search?q=...&offset=0&limit=40` | Archive-wide search with paginated results and parent/date references |
| `POST /api/document/edit` | Atomic batch of create/edit/delete/move operations, returning an undo operation ID |
| `POST /api/document/history` | Undo or redo a group of document operations, checking for conflicting edits |
| `POST /api/tasks/{id}/reopen` | Undo completion, reopening completed ancestors without reopening unrelated siblings |
| `GET /api/journal` | Current day, notes, open tasks, live focus totals, active timer; cursor pagination with `before` and `limit`, optional `tag` filter or exact-date `on` lookup |
| `POST /api/notes` | Create a note with `date`, `content`, optional `parent_id`, `after_id`, and `client_id` for retries |
| `PATCH /api/notes/{id}` / `DELETE /api/notes/{id}` | Edit or delete a note |
| `PATCH /api/notes/{id}/location` | Move a branch using `parent_id` (null for root) and optional preceding sibling `after_id` |
| `POST /api/tasks` | Add a to-do with `content`, optional `parent_id`, `after_id`, and `client_id` |
| `PATCH /api/tasks/{id}` / `DELETE /api/tasks/{id}` | Edit or delete an open to-do |
| `PATCH /api/tasks/{id}/location` | Move a to-do branch using `parent_id` and optional `after_id` |
| `POST /api/tasks/{id}/complete` | Complete a leaf and any ready ancestors, adding their completion entries to the current day |
| `GET /api/timer` | Active session and server time |
| `POST /api/timer/start` | Start, or return the existing running session |
| `POST /api/timer/stop` | Finish a specific `session_id`; retries cannot stop a newer session |
| `GET /api/sessions?date=YYYY-MM-DD` | Sessions intersecting a day, with full duration and seconds allocated to that day |
| `POST /api/sessions` / `PATCH /api/sessions/{id}` | Add or edit `started_at` (timezone-aware) and `duration_seconds` |
| `DELETE /api/sessions/{id}` | Delete a finished session |
| `GET /api/stats` | Summary metrics and daily records |
| `GET /api/stats/daily` | Daily records suitable for joining to health data |
| `GET /api/export` | All normalized records with schema version |

Date-based reads and task completion accept `timezone`, defaulting to UTC. Stats accept inclusive `start` and `end` dates (up to 3,660 days). Missing bounds default to the last seven days. All durations in API responses are seconds; the interface formats them in hours, minutes, and seconds.

```sh
curl 'http://127.0.0.1:8000/api/stats/daily?start=2026-09-01&end=2026-09-16&timezone=America%2FLos_Angeles'
```

Each daily record contains `date`, `focused_seconds`, `longest_session_seconds`, `session_count`, `first_started_at`, `last_ended_at`, `note_count`, and `completed_task_count`. Join on `date` after using the same timezone as your Oura data. A cross-midnight session counts once in each day it touches, and once in the summary’s unique `session_count`.

The summary provides averages over all calendar days and separate `average_active_day_*` values for days with focus. It explicitly returns `includes_running_session: false`. Oura connectivity and correlation analysis are left for the future agent integration.

## Checks

```sh
npm test                 # isolated local PostgreSQL tests: transactions, retries, stats, midnight, DST
npm run build            # strict TypeScript check and Vite production bundle
npm run test:e2e          # Chrome browser tests against an isolated local PostgreSQL database
```

Browser tests use the installed Google Chrome via Playwright. They create and reset a local `still_e2e` PostgreSQL database, never the configured Neon database. Run `npx playwright install chrome` on machines without it. Build before the browser suite; it tests the production app. Test databases and screenshots never touch the personal database.

The interface follows [make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better), with the user's document reference taking precedence: styled-components throughout, the reference’s Söhne font, tabular timer numbers, native modal focus management, compact document rows (44 px on touch devices), explicit transitions, and reduced-motion support. No style sheets or inline `style` attributes are used. There are no decorative images, taglines, or formatting toolbars; the page shows document content, the timer, and quiet theme and statistics icons.
