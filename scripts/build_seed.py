"""Rebuild the fictional public starter database."""
import json
import os
import sqlite3
from pathlib import Path

from backend.db import DEFAULT_SEED_PATH, initialize


def rebuild(output=DEFAULT_SEED_PATH):
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    for candidate in (output, Path(str(output) + "-wal"), Path(str(output) + "-shm")):
        candidate.unlink(missing_ok=True)

    os.environ["STILL_DB_PATH"] = str(output)
    os.environ["STILL_SEED_ON_FIRST_RUN"] = "false"
    initialize()

    days = [
        (1, "2026-09-19", "2026-09-19T16:00:00Z"),
        (2, "2026-09-20", "2026-09-20T16:00:00Z"),
    ]
    entries = [
        # Open task trees: checked children demonstrate partial parent progress.
        (1, "task", None, "Prepare the Series B pitch without saying “platform” more than twelve times", ["fundraising"], None, 0, "2026-09-20T18:00:00Z", "2026-09-20T18:00:00Z", None),
        (2, "task", None, "Make one chart Monica cannot immediately disprove", ["fundraising"], 1, 0, "2026-09-20T18:02:00Z", "2026-09-20T19:10:00Z", "2026-09-20T19:10:00Z"),
        (3, "task", None, "Remove the slide titled “Why Hooli Is Technically Evil”", ["fundraising"], 1, 1, "2026-09-20T18:03:00Z", "2026-09-20T18:03:00Z", None),
        (4, "task", None, "Practice eye contact with a houseplant", ["fundraising"], 1, 2, "2026-09-20T18:04:00Z", "2026-09-20T18:04:00Z", None),
        (5, "task", None, "Fix the middle-out demo before Gavin Belson invents it retroactively", ["product"], None, 1, "2026-09-20T19:00:00Z", "2026-09-20T19:00:00Z", None),
        (6, "task", None, "Reproduce the bug on a computer we do not own", ["product"], 5, 0, "2026-09-20T19:01:00Z", "2026-09-20T20:00:00Z", "2026-09-20T20:00:00Z"),
        (7, "task", None, "Explain to Dinesh that “works on my laptop” is not a QA strategy", ["product"], 5, 1, "2026-09-20T19:02:00Z", "2026-09-20T19:02:00Z", None),
        (8, "task", None, "Retrieve the laptop from Dinesh", ["product"], 7, 0, "2026-09-20T19:03:00Z", "2026-09-20T19:03:00Z", None),
        (9, "task", None, "Return Erlich’s smoke machine before the security deposit becomes philosophical", ["office"], None, 2, "2026-09-20T20:00:00Z", "2026-09-20T20:00:00Z", None),

        # September 19: notes and a completed task tree are deliberately interleaved.
        (10, "note", 1, "The office internet died, so productivity briefly became measurable.", ["office"], None, 0, "2026-09-19T16:05:00Z", "2026-09-19T16:05:00Z", None),
        (11, "note", 1, "Gilfoyle called this “a useful decentralization exercise.”", ["office"], 10, 0, "2026-09-19T16:06:00Z", "2026-09-19T16:06:00Z", None),
        (12, "task", 1, "Make the demo button do the thing the demo button says", ["product"], None, 1, "2026-09-19T16:10:00Z", "2026-09-19T17:08:00Z", "2026-09-19T17:08:00Z"),
        (13, "task", 1, "Connect the button", ["product"], 12, 0, "2026-09-19T16:11:00Z", "2026-09-19T16:44:00Z", "2026-09-19T16:44:00Z"),
        (14, "task", 1, "Rename `final_final_REAL.ts`", ["product"], 12, 1, "2026-09-19T16:12:00Z", "2026-09-19T17:07:00Z", "2026-09-19T17:07:00Z"),
        (15, "note", 1, "Investor feedback: “Love the technology. Could it be less technological?” I wrote this down because apparently that’s leadership.", ["fundraising", "meetings"], None, 2, "2026-09-19T17:15:00Z", "2026-09-19T17:15:00Z", None),

        # September 20: more hierarchy, Markdown, tags, and another completed tree.
        (16, "note", 2, "Stand-up lasted **nine minutes**. Either we’re becoming efficient or everyone has stopped listening.", ["meetings"], None, 0, "2026-09-20T16:05:00Z", "2026-09-20T16:05:00Z", None),
        (17, "note", 2, "Dinesh used seven of those minutes to say “blockchain” in four different tenses.", ["meetings"], 16, 0, "2026-09-20T16:06:00Z", "2026-09-20T16:06:00Z", None),
        (18, "task", 2, "Deploy a build that survives contact with another computer", ["product"], None, 1, "2026-09-20T17:00:00Z", "2026-09-20T17:50:00Z", "2026-09-20T17:50:00Z"),
        (19, "task", 2, "Replace `localhost` with an actual hostname", ["product"], 18, 0, "2026-09-20T17:01:00Z", "2026-09-20T17:28:00Z", "2026-09-20T17:28:00Z"),
        (20, "task", 2, "Ask Gilfoyle to remove the Satan ASCII art from `/health`", ["product"], 18, 1, "2026-09-20T17:02:00Z", "2026-09-20T17:49:00Z", "2026-09-20T17:49:00Z"),
        (21, "note", 2, "Monica looked at the burn chart, then at me, then back at the burn chart. Somehow the chart looked worried.", ["fundraising"], None, 2, "2026-09-20T18:00:00Z", "2026-09-20T18:00:00Z", None),
    ]
    sessions = [
        (1, "2026-09-19T16:04:00Z", "2026-09-19T17:12:00Z"),
        (2, "2026-09-20T17:06:00Z", "2026-09-20T17:53:00Z"),
        (3, "2026-09-20T20:15:00Z", "2026-09-20T20:39:00Z"),
    ]

    with sqlite3.connect(output) as db:
        db.execute("PRAGMA foreign_keys = ON")
        db.executemany("INSERT INTO days(id, date, created_at) VALUES (?, ?, ?)", days)
        db.executemany(
            """INSERT INTO entries(
                   id, kind, day_id, content, tags, parent_id, position,
                   created_at, updated_at, completed_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [(*row[:4], json.dumps(row[4]), *row[5:]) for row in entries],
        )
        db.executemany("INSERT INTO sessions(id, started_at, ended_at) VALUES (?, ?, ?)", sessions)
        db.commit()
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        db.execute("PRAGMA journal_mode = DELETE")
        db.execute("VACUUM")


if __name__ == "__main__":
    rebuild()
