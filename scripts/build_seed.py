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
        # Three open top-level tasks: one with 3 subtasks, one with 2, and one leaf.
        # Subtasks are task rows too; parent_id is what nests them under a root task.
        # Root 1: three subtasks (two complete, one open).
        (1, "task", None, "make the series b deck monica doesn't hate", [], None, 0, "2026-09-20T18:00:00Z", "2026-09-20T18:00:00Z", None),
        (3, "task", None, "delete slide about hooli being evil", [], 1, 0, "2026-09-20T18:03:00Z", "2026-09-20T18:33:00Z", "2026-09-20T18:33:00Z"),
        (4, "task", None, "fudge numbers for chart more realistically", [], 1, 1, "2026-09-20T18:34:00Z", "2026-09-20T18:48:00Z", "2026-09-20T18:48:00Z"),
        (5, "task", None, "rehearse 'revenue a lagging indicator' speech", [], 1, 2, "2026-09-20T18:49:00Z", "2026-09-20T18:49:00Z", None),

        # Root 2: two subtasks (one complete, one open).
        (8, "task", None, "get laptop back from dinesh", [], None, 1, "2026-09-20T19:03:00Z", "2026-09-20T19:03:00Z", None),
        (6, "task", None, "check browser history", [], 8, 0, "2026-09-20T19:05:00Z", "2026-09-20T19:18:00Z", "2026-09-20T19:18:00Z"),
        (7, "task", None, "check for malware", [], 8, 1, "2026-09-20T19:19:00Z", "2026-09-20T19:19:00Z", None),

        # Root 3: no subtasks.
        (9, "task", None, "return erlich's smoke machine", [], None, 2, "2026-09-20T20:00:00Z", "2026-09-20T20:00:00Z", None),

        # September 19: notes and a completed task tree are deliberately interleaved.
        (13, "task", 1, "connect button", [], None, 1, "2026-09-19T16:11:00Z", "2026-09-19T16:44:00Z", "2026-09-19T16:44:00Z"),
        (15, "note", 1, "investor feedback: “love the technology. could it be less technological?”", ["fundraising"], None, 2, "2026-09-19T17:15:00Z", "2026-09-19T17:15:00Z", None),
        (22, "note", 1, "read [the tail at scale](https://research.google/pubs/the-tail-at-scale/).", [], None, 3, "2026-09-19T18:00:00Z", "2026-09-19T18:00:00Z", None),
        (23, "note", 1, "actual customers notice waiting, investors notice axis green", [], 22, 0, "2026-09-19T18:02:00Z", "2026-09-19T18:02:00Z", None),


        # September 20: more hierarchy, Markdown, tags, and another completed tree.
        (20, "task", 2, "get gilfoyle's satan ascii art out of `/health`", [], None, 1, "2026-09-20T17:02:00Z", "2026-09-20T17:49:00Z", "2026-09-20T17:49:00Z"),
        (35, "task", 2, "find the endpoint that summoned it", [], 20, 0, "2026-09-20T17:08:00Z", "2026-09-20T17:21:00Z", "2026-09-20T17:21:00Z"),
        (36, "task", 2, "replace it with a boring health response", [], 20, 1, "2026-09-20T17:22:00Z", "2026-09-20T17:48:00Z", "2026-09-20T17:48:00Z"),
        (27, "note", 2, "if we beat estimates by a lot, assume measurement bug. check headers, dict leakage, dup files", [], None, 3, "2026-09-20T18:22:00Z", "2026-09-20T18:22:00Z", None),
        (28, "note", 2, "compare [brotli](https://www.rfc-editor.org/rfc/rfc7932) and [zstd](https://www.rfc-editor.org/rfc/rfc8878)", [], 27, 0, "2026-09-20T18:24:00Z", "2026-09-20T18:24:00Z", None),
        (29, "note", 2, "dinesh logo sucks ass", [], 28, 0, "2026-09-20T18:25:00Z", "2026-09-20T18:25:00Z", None),
        (31, "note", 2, "use this: [architecture decision records](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)", [], None, 4, "2026-09-20T19:00:00Z", "2026-09-20T19:00:00Z", None),
        (34, "note", 2, "new rule: anyone saying “obviously” has to produce a measurement or buy lunch", [], 31, 2, "2026-09-20T19:06:00Z", "2026-09-20T19:06:00Z", None),
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
