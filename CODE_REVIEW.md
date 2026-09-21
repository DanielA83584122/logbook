# Code review — September 20, 2026

## Implementation resolution — September 20, 2026

The reliability work recommended below is now implemented in the working tree:

- schema version 8 uses non-reused `AUTOINCREMENT` entry IDs, monotonic revisions, transactional migration/version advancement, foreign-key validation, and retry receipts;
- document mutations reject stale revisions, replay duplicate request IDs, search every saved task, normalize promoted/moved task roots, and prevent checked groups from containing unchecked descendants;
- drafts carry kind, revision, and a persistent per-mutation request ID; recovery uses the unified endpoint; late typing is saved before Enter advances; mixed note/task Backspace preserves both identities;
- Render has a reproducible service definition with a persistent disk and optional authentication; `STILL_AUTH_ENABLED=false` leaves it disabled for now, and CI runs backend, build, and browser checks;
- the idle app no longer rerenders the journal every second, obsolete frontend completion-note state and the unused completed-task query were removed, and completed tasks use the requested attributed hollow-circle checkmark.

Regression coverage was added for every confirmed functional failure in this review. An online backup of the current database migrated to v8 with 135 entries and 6 sessions, `integrity_check=ok`, and no foreign-key violations. The live database was not migrated by validation; startup performs that migration after deployment or restart.

The original findings remain below as the rationale and historical reproduction record.

## Verdict

The stack is appropriate and the unified `entries` table is the right direction. I would keep SQLite, FastAPI, React, and the document-style interface. This does not need a rewrite or a different database.

However, I would not yet trust this implementation as the only copy of an important journal, or expose its backend publicly without access control. There are reproducible data-loss and data-visibility bugs, not just opportunities to tidy the code.

The central issue: **storage has been unified, but editing, recovery, history, and task lifecycle rules have not been unified to the same extent.** Several paths still treat notes and tasks as separate entities. Other paths can update a tree without restoring its completion and display-location invariants.

This review covers the current working tree, including the existing uncommitted refactoring. It is a review, not an implementation: application code and the personal database were not changed. Reproductions used temporary databases and an isolated browser server. The live Render deployment was not inspected.

Priority definitions: P1 means fix before relying on the affected workflow; P2 means an important correctness problem that should follow the data-safety fixes. Deployment findings are conditional on how the application is exposed.

## Confirmed bugs

### 1. P1 — Typing during a pending Enter save can disappear permanently

Location: [Outline.tsx:585](/Users/divyavenn/Documents/GitHub/still/src/components/Outline.tsx:585), [save acknowledgement at line 257](/Users/divyavenn/Documents/GitHub/still/src/components/Outline.tsx:257).

Reproduction: enter a new note, press Enter, delay the `/api/document/edit` response, and keep typing before the response arrives. The editor remains editable. When the save finishes, Enter's callback replaces the current draft with a blank one.

The browser showed `Review latency original LATE TYPING`. SQLite contained only `Review latency original`, and localStorage had already been replaced with the empty next draft. The late text was in neither place.

Fix: make each save acknowledge an immutable draft ID and revision. Enter should transition locally to the next draft without waiting for the network; the outgoing save must never clear a newer draft. Keep unacknowledged changes in a persistent queue. Making the editor temporarily read-only would be a narrower containment measure, but is not the best final interaction.

### 2. P1 — Reused SQLite IDs let a stale deletion delete a different entry

Location: [entry ID definition](/Users/divyavenn/Documents/GitHub/still/backend/db.py:23), [note deletion](/Users/divyavenn/Documents/GitHub/still/backend/app.py:342).

`INTEGER PRIMARY KEY` can reuse deleted IDs. In an isolated database:

1. Create note A: ID `1`.
2. Delete A.
3. Create note B: ID `1` again.
4. Retry the deletion intended for A: B is deleted.

The retry returned 204 and left zero entries. A delayed request or stale browser tab is enough; no unusual database corruption is required. Undo and recovered drafts also depend on reliable identity.

Fix: use non-reused identities, such as UUIDs or correctly migrated `AUTOINCREMENT` IDs, and protect mutations with identity/revision checks. A retry-safe delete must mean “delete this original entry,” not “delete whoever currently has this number.”

### 3. P1 — Deleting a task parent can strand a completed child outside both views

Location: [remove_preserving_children](/Users/divyavenn/Documents/GitHub/still/backend/hierarchy.py:87), [visible_tasks](/Users/divyavenn/Documents/GitHub/still/backend/tasks.py:13).

Reproduction: create an unfinished parent with one checked child and one unchecked child, then delete the parent through the document API.

Both children are promoted to roots. The checked child retains `completed_at` but has `day_id = NULL`. To-dos exclude completed roots; the logbook requires a day. The checked child remains in SQLite but disappears from both primary views. The unchecked child remains visible.

Fix: after deletion or reparenting, normalize every affected resulting tree, including newly promoted roots. A completed root must receive a logbook location. Testing only the old parent is insufficient.

### 4. P1 — Moving an open task under a checked group creates an inconsistent tree and a later 500

Location: [move_entry](/Users/divyavenn/Documents/GitHub/still/backend/app.py:103), [archive_task_tree](/Users/divyavenn/Documents/GitHub/still/backend/app.py:423).

Reproduction: an open root has a checked subgroup and an unfinished sibling. Move another open task under the checked subgroup. The move succeeds, but the moved task remains unchecked and is omitted by the visibility traversal. Completing the remaining sibling then returns 500 when archiving tries to assign a day to the unchecked descendant.

Completion is adjusted when a move changes note/task kind, but not for this same-kind move. Allowing a completed parent without applying its completion rules leaves contradictory state.

Fix: route all moves through the same lifecycle rules as child creation and completion. Decide and enforce the behavior for moving an existing open task into a checked branch; reject an invalid move or perform the intended state transition atomically. Never leave a checked ancestor containing an unchecked descendant.

### 5. P1 — A migration interrupted after table creation is skipped on restart

Location: [migration DDL](/Users/divyavenn/Documents/GitHub/still/backend/db.py:129), [startup migration detection](/Users/divyavenn/Documents/GitHub/still/backend/db.py:185).

Startup treats the existence of `entries` as proof that migration finished. `executescript()` creates that table outside the later data-copy transaction.

In a fault-injection test, migration was stopped immediately after creating the new schema. Restart then reported schema version 7 with **zero entries and one legacy note still in the old table**. The application appeared empty and did not retry the migration. The legacy data was not physically erased in this reproduction.

Fix: use explicit numbered migrations. Schema creation, data copying, validation, and version advancement must commit as one controlled unit. Detect incomplete or unsupported schemas instead of silently accepting them. Test interruptions at several stages, and take a verified SQLite backup before a destructive migration.

### 6. P1 — Ordinary saves can silently overwrite another tab's edits

Location: [document updates](/Users/divyavenn/Documents/GitHub/still/backend/app.py:249), [REST note updates](/Users/divyavenn/Documents/GitHub/still/backend/app.py:333).

Mutation requests do not include the version the user edited. Two writes based on the same original text both succeed; the later request overwrites the earlier one. This was reproduced with stale-client API updates. The undo path has conflict checks, but normal saves do not.

Fix: add a revision and require an expected revision for updates. On conflict, retain both the server version and the local draft and return an actionable 409 response. A single-user application still has multiple tabs, devices, and delayed requests. Collaborative CRDT infrastructure is unnecessary to solve this first.

### 7. P2 — Earlier-day draft recovery still assumes every entry is a note

Location: [recoverEarlierDrafts](/Users/divyavenn/Documents/GitHub/still/src/api.ts:52).

The editor stores a draft's kind, but recovery ignores it and always uses `/notes` routes.

Browser reproductions with historical completed-task drafts showed:

- An unsaved text edit generated `PATCH /api/notes/<task-id>` and returned 404. The pending draft remained and recovery reported failure.
- An unsaved deletion generated `DELETE /api/notes/<task-id>` and returned 204 without deleting the task. Recovery removed the local draft anyway.

A malformed JSON draft or a failed request can also abort recovery of subsequent drafts because failures are not isolated per item.

Fix: use the same typed mutation pipeline for ordinary saves and recovery. Version the local draft format; isolate individual failures; remove pending data only after the matching operation is acknowledged. Recovery should not invent a second implementation of editing.

### 8. P2 — Backspace cannot merge a note and a completed task

Location: [boundary merge](/Users/divyavenn/Documents/GitHub/still/src/components/Outline.tsx:438).

Both merge participants inherit the neighboring row's kind. With a note followed by a completed task, Backspace at the task's start sends a deletion for the task ID with `kind: "notes"`.

The actual browser interaction returned 404 and displayed “That item no longer exists.” The task did exist; the request identified it incorrectly. The transaction rolled back, so this reproduction failed without deleting either entry.

Fix: preserve each participant's real identity and kind. With globally unique entry IDs, the server should ordinarily resolve kind from the entry rather than require the client to supply a second identity discriminator. Define which kind survives a mixed merge and cover both directions.

### 9. P2 — The editor's delete endpoint is not retry-safe

Location: [document edit lookup](/Users/divyavenn/Documents/GitHub/still/backend/app.py:231), [editor deletion](/Users/divyavenn/Documents/GitHub/still/src/components/Outline.tsx:242).

The compatibility DELETE routes tolerate missing entries, but `/api/document/edit` calls `required()` before handling deletion. Repeating a successful document deletion returns 404. This is the endpoint the editor uses.

A lost successful response therefore leaves the client treating a completed deletion as a failed operation. Simply fixing the older `/notes` route does not cover the current editor.

Fix: introduce a client operation ID with a transactionally stored result. A retry should return the original result, including its undo operation, without reapplying changes. Non-reused entry IDs are a prerequisite for safe stale requests.

### 10. P2 — Search omits saved descendants inside completed subgroups of active tasks

Location: [search corpus](/Users/divyavenn/Documents/GitHub/still/backend/app.py:309), [visibility traversal](/Users/divyavenn/Documents/GitHub/still/backend/tasks.py:19).

Search uses `visible_tasks()`, which stops descending through checked task groups. A completed leaf inside a checked subgroup was present in `/api/export` but absent from `/api/search` while the overall root remained unfinished.

Entirely archived task trees are searched; the missing case is a completed branch inside an active tree.

Fix: search persisted entries independently of what the current UI displays. Apply display rules after finding results, and retain enough ancestry to navigate to the match. A collapsed or checked branch must not make saved text unsearchable.

### 11. P2 — Migration overwrites manually arranged root order

Location: [root ordering during migration](/Users/divyavenn/Documents/GitHub/still/backend/db.py:167).

Migration sorts root entries by completion/creation time and rewrites `position`, ignoring saved note order. A two-note fixture manually ordered opposite to creation order was reversed by migration.

Fix: preserve the relative order of each legacy list and specify how those formerly separate lists should be merged. Existing data may not encode the desired cross-kind interleaving, but that does not justify discarding order that is recorded. Add fixtures with reordered roots and nested children.

## Deployment blocker: no authentication

[README.md:125](/Users/divyavenn/Documents/GitHub/still/README.md:125) correctly calls this a local, unauthenticated application. The backend has no authentication layer protecting either reads or writes, including [the complete export](/Users/divyavenn/Documents/GitHub/still/backend/app.py:644).

If the Render backend is directly internet-accessible without an upstream access gate, anyone who can reach it can read and modify the journal. HTTPS does not provide authorization, and protecting only the frontend is insufficient. I did not check whether your deployment already has external protection.

Before public use, require authentication for every journal/API representation, configure HTTPS, and add CSRF protection if authentication uses cookies. For this personal app, a correctly configured access proxy can be sufficient; an elaborate account system is not required.

The repository also lacks a portable production deployment definition. [package.json](/Users/divyavenn/Documents/GitHub/still/package.json:8) starts a locally created `.venv` on `127.0.0.1:8000`. A production build must install the Python environment and frontend assets; startup must bind to the platform's required address and port. SQLite needs a persistent mount, one authoritative database location, and tested backups. Do not scale independent replicas against separate local database files.

## Design choices I would change

### Finish the unified model instead of adding more compatibility patches

One table should be matched by one canonical entry type, one mutation service, and one set of tree invariants.

Currently the journal uses plural kinds (`notes`/`tasks`), stored rows and several API responses use singular kinds (`note`/`task`), and [the frontend type](/Users/divyavenn/Documents/GitHub/still/src/types.ts:1) only declares the plural versions. Runtime casts compensate for this mismatch. Old `source_task_id` concepts and separate-kind history structures also remain.

Choose a single wire representation with a required discriminator, validate response schemas, and generate or check frontend types against it. Compatibility routes can remain as thin adapters to the same service; they should not own independent mutation logic. IDs should stay stable when an entry changes kind.

The mutation service should cover create, edit, move, delete, complete, reopen, merge, and undo, and restore these invariants at each transaction boundary:

- Parent references are acyclic and within the supported depth.
- Children have the required kind and display location for their parent.
- An unchecked descendant implies unfinished ancestors and a to-do root.
- A completed root has a logbook day; an unfinished root has no logbook day.
- Promoted children are valid roots or siblings after deletion.
- Every surviving root belongs to exactly one primary view, with one deterministic sibling order.

This is why ordering feels harder than it should: the code still has several representations and mutation paths around what should be one ordered tree. The `position` column itself is not the problem. Integer sibling positions are reasonable for a personal journal; fractional ranking is optional, not a prerequisite.

### Keep checkbox state separate from display location

`day_id` and task completion are not equivalent under the requested behavior. A checked subtask can belong to an unfinished root, so it needs checkbox state while its tree still has `day_id = NULL`.

The timestamp itself is a design choice: a boolean could represent completion if completion time were unnecessary. But some separate completion state is required. Keep `completed_at` if its timestamp supports useful history/undo behavior; do not infer every checkbox from `day_id`. Prefer deriving location from the root, or maintain duplicated descendant locations through one well-tested service.

### Make the editor state explicit

[Outline.tsx](/Users/divyavenn/Documents/GitHub/still/src/components/Outline.tsx:149) owns rendering, selection, keyboard navigation, localStorage, save queues, mutation locks, focus restoration, hierarchy edits, and completion animations. Its current behavior is distributed among React state, refs, promises, timers, and window events. The lost-typing bug is a consequence of these competing timelines, not a missing CSS tweak.

Extract a testable editor reducer/controller and a persistence queue. Distinguish the current local draft, the acknowledged server version, and each in-flight operation. Render should consume those states rather than reconstruct their meaning from several booleans. Preserve the existing keyboard-first UI and Tiptap integration.

### Reduce whole-document work, after correctness

These are source-confirmed scaling concerns, not claims of measured slowness:

- [History snapshots](/Users/divyavenn/Documents/GitHub/still/backend/history.py:22) read every entry before and after each document mutation. Record only affected rows/subtrees once correctness tests protect that implementation.
- [Descendant traversal](/Users/divyavenn/Documents/GitHub/still/backend/hierarchy.py:33) loads every entry of a kind. Sibling placement rewrites the entire sibling list. Appropriate subtree queries and targeted updates would reduce work.
- [GET /api/journal](/Users/divyavenn/Documents/GitHub/still/backend/app.py:155) performs a write to ensure today's day exists, reads all sessions, and recomputes totals during polling. Avoid making routine reads hold a writer transaction; bound historical queries.
- [The app-level clock](/Users/divyavenn/Documents/GitHub/still/src/App.tsx:182) updates state every second even with no running timer. The provider value and document render paths participate. Isolate the clock, stabilize context values, and pre-index children instead of repeatedly filtering arrays per row.
- The production JavaScript chunk is approximately **920 kB / 306 kB gzip**. Profile parsing and rendering before choosing optimizations; consider lazy-loading optional statistics/search surfaces.

Do not introduce a cache server, microservices, Postgres, or a new frontend framework just to address these issues.

## Interface review

Full mode, scoped to the main note/task editor and shared visual primitives: React/TypeScript, Tiptap, and styled-components. This supplements the correctness review; it is not a new exhaustive review of every modal, accessibility scenario, or screen size. The small round checkboxes, quiet document styling, and existing styling system should be preserved.

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Global styles, rich-text styles, timer numbers, desktop browser | Font smoothing, wrapping rules, and tabular timer numbers already present; no new typography finding |
| Surfaces | Editor, empty composer, focus/hover/active controls, delayed save, recovery, 390 px touch viewport | Findings 1 and 7: draft continuity and recoverability; measured touch checkbox target 44×44 px with no horizontal overflow |
| Animations | Disclosure transitions exercised at 10% playback; theme source and reduced-motion override | No additional decorative motion recommended; reduced-motion transition duration verified |
| Icons | Checked circle, disclosure/progress marker, names and keyboard focus | Existing small checked glyph retained; desktop control measured 40×28 px, with touch enlargement |
| Performance | Timer/context updates, outline traversal, explicit CSS transitions, production bundle | Render/persistence concerns above; large-history latency not benchmarked |

### Editing continuity and recoverability

These rows summarize the interface changes proposed by the functional findings; none was implemented in this review.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | [Outline.tsx:585](/Users/divyavenn/Documents/GitHub/still/src/components/Outline.tsx:585) | Text entered while Enter awaits a save can vanish | Transition locally and acknowledge only the matching draft revision | Continuity: an editor must retain every accepted keystroke; finding 1 |
| HIGH | [api.ts:52](/Users/divyavenn/Documents/GitHub/still/src/api.ts:52) | Recovery uses note-only routes and can discard an unapplied task deletion | Recover typed operations through the shared persistence queue | Recoverability: local pending data must survive until its matching action succeeds; finding 7 |
| MEDIUM | [Outline.tsx:438](/Users/divyavenn/Documents/GitHub/still/src/components/Outline.tsx:438) | Backspace across mixed kinds returns 404 | Preserve both identities and apply a defined mixed-merge rule | Familiar interaction: notes and tasks should edit as one document; finding 8 |

### Considered but rejected

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Main editor | Add a permanent toolbar or prominent save controls | This would change the requested quiet, keyboard-first product without solving the persistence bugs |
| Task markers | Enlarge the visible circles or indiscriminately pad every desktop row | Small round markers and compact rows are intentional; touch targets already enlarge, and overlapping invisible targets would introduce new errors |
| Shared visual styles | Replace styled-components or add an animation dependency | Existing tokens, explicit transitions, and reduced-motion support are adequate; the priority is reliable behavior |

Interface verdict: **Block** on the remaining HIGH interaction findings. Physical touch/pen use, screen-reader navigation, comprehensive contrast checks across all states, final-state visual regression of every theme/modal, and large-history performance remain unverified. The additional unrestricted axe check reported heading/landmark best-practice warnings; the existing WCAG-tagged browser checks passed. Those results are not a complete accessibility certification.

## What I would do next, in order

1. **Protect data and reproduce every failure in tests.** Add the slow-save, stale-delete, task-promotion, invalid-move, and interrupted-migration cases. Fix immutable identity, lost typing, and tree normalization first. Preserve a verified backup before schema changes.
2. **Unify mutations and recovery.** Introduce one entry contract and service, operation-level idempotency, revision checks, and a durable pending-change queue. Make old API routes adapters. Remove obsolete compatibility branches after their consumers migrate.
3. **Harden deployment and migrations.** Add numbered transactional migrations, fail-closed schema validation, a reproducible production definition, complete access control, persistent storage configuration, and automated backup/restore checks.
4. **Make tests independent and mandatory.** Give browser tests isolated/reset fixtures rather than relying on a shared accumulated database. Make the test command build the frontend first: the current [Playwright configuration](/Users/divyavenn/Documents/GitHub/still/playwright.config.ts:17) serves existing build output. Gate changes on backend tests, strict TypeScript/build, and browser tests in CI.
5. **Optimize and simplify after the behavior is protected.** Reduce broad queries and snapshots, isolate timer rendering, remove stale fields/helpers and misleading docs, and profile a realistically large journal before adding more infrastructure.

Add randomized state-machine tests over create/move/delete/check/uncheck/undo sequences. Assert tree invariants after every operation. Also test lost responses, duplicate commands, multi-tab conflicts, browser reloads during saves, malformed recovery records, migrations interrupted mid-copy, and restoration from a real backup. The important matrix is not just “notes versus tasks”; it is kind × completion × ancestry × location × failure timing.

## Verification and boundaries

- `npm test`: **75 backend tests passed**.
- `npm run build`: **passed**, including TypeScript; Vite emitted the large-chunk warning noted above.
- `STILL_TEST_PORT=8019 npm run test:e2e`: **57 browser tests passed** against an isolated temporary SQLite database.
- Additional isolated API/SQLite probes reproduced ID reuse, stranded promoted tasks, invalid same-kind task moves and a subsequent 500, duplicate document-delete 404s, missing search results, stale-write overwrites, interrupted migration recovery, and lost legacy ordering.
- Additional Chrome probes reproduced mixed-kind merge 404s, lost typing while a save response was held, and incorrect historical-task recovery routes. They also exercised editor focus, empty input, hover/activation, disclosure motion at 10% speed, reduced-motion styles, and a 390 px emulated touch viewport.
- These targeted probes were one-off review diagnostics, not added regression tests. Passing existing tests therefore does not mean the reported failures are covered.
- No authentication/penetration audit of a deployed service, live Render configuration review, load benchmark, or exhaustive accessibility audit was performed. The personal SQLite data and pre-existing source changes were left untouched.

The goal should be “a journal that never silently loses a keystroke and whose state is always explainable,” not maximum abstraction. The existing architecture can reach that standard through a focused reliability pass.
