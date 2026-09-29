"""Seed the promo scratch database with a small, fictional logbook.

Resets the running scratch server (test mode) and writes rows directly, the same
way scripts/build_seed.py builds the public starter database. Never point this at
a personal database.

    python3 promo-film/capture/seed_demo.py <scratch server's STILL_DB_PATH> [port]
"""
import json
import random
import sqlite3
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

DB = sys.argv[1]
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8020
# The personal journal lives in the repo's data/ folder. The reset below also only
# exists on a server started with STILL_TEST_MODE=1, which personal servers are not.
if Path(DB).resolve().is_relative_to(Path(__file__).resolve().parents[2] / "data"):
    sys.exit("refusing to seed the personal database; pass the scratch server's STILL_DB_PATH")
# The server creates its database on startup, so a missing file means a mismatch.
if not Path(DB).is_file():
    sys.exit(f"{DB} does not exist; start the scratch server with STILL_DB_PATH={DB} first")

TZ = ZoneInfo("Europe/Stockholm")
TODAY = datetime.now(TZ).date()


def utc(day: date, hh: int, mm: int, ss: int = 0) -> str:
    local = datetime(day.year, day.month, day.day, hh, mm, ss, tzinfo=TZ)
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def d(offset: int) -> date:
    return TODAY - timedelta(days=offset)


request = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/test/reset", method="DELETE")
assert urllib.request.urlopen(request).status == 204

db = sqlite3.connect(DB, timeout=10)
db.execute("PRAGMA foreign_keys = ON")

day_ids = {}


def day(offset: int) -> int:
    on = d(offset)
    if on not in day_ids:
        cur = db.execute("INSERT INTO days(date, created_at) VALUES (?, ?)", (on.isoformat(), utc(on, 7, 30)))
        day_ids[on] = cur.lastrowid
    return day_ids[on]


def entry(kind, content, *, offset=None, tags=(), parent=None, position=0, at=None, done=None, role=""):
    day_id = day(offset) if offset is not None and (kind == "note" or done) else None
    cur = db.execute(
        """INSERT INTO entries(kind, day_id, content, tags, parent_id, position, created_at, updated_at, completed_at, role)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (kind, day_id, content, json.dumps(list(tags)), parent, position, at, at, done, role),
    )
    return cur.lastrowid


# ---- to do (active task trees: no day) -------------------------------------------------
ship = entry("task", "ship onboarding v2", tags=["launch"], position=0, at=utc(d(3), 10, 5))
entry("task", "empty states", parent=ship, position=0, at=utc(d(3), 10, 6), done=utc(d(2), 15, 40))
entry("task", "welcome email copy", parent=ship, position=1, at=utc(d(3), 10, 7), done=utc(d(1), 11, 20))
entry("task", "final qa pass", parent=ship, position=2, at=utc(d(3), 10, 8))
grant = entry("task", "reply to maya about the grant", position=1, at=utc(d(2), 9, 12))
entry("task", "budget numbers from sam", parent=grant, position=0, at=utc(d(2), 9, 13), role="wait")
entry("task", "book flights to lisbon", position=2, at=utc(d(1), 20, 2))

# ---- today -----------------------------------------------------------------------------
entry("note", "ran 5k before coffee. legs heavy, head clear", offset=0, tags=["health"], position=0, at=utc(d(0), 7, 41))

# ---- yesterday -------------------------------------------------------------------------
sec = entry("note", "# sunday reading", offset=1, tags=["reading"], position=0, at=utc(d(1), 10, 2))
mom = entry("note", "[the mom test](https://www.momtestbook.com): ask about their life, not your idea", offset=1, position=1, at=utc(d(1), 10, 4))
entry("note", "compliments are noise. commitments are signal", offset=1, parent=mom, position=0, at=utc(d(1), 10, 9))
entry("note", "[shape up](https://basecamp.com/shapeup) ch. 3: fixed time, variable scope", offset=1, position=2, at=utc(d(1), 11, 30))
entry("note", "idea: a weekly email of everything I tagged", offset=1, tags=["ideas"], position=3, at=utc(d(1), 16, 45))

# ---- two days ago: a finished task tree interleaved with notes -------------------------
fix = entry("task", "fix signup redirect loop", offset=2, tags=["launch"], position=0, at=utc(d(4), 14, 0), done=utc(d(2), 13, 52))
entry("task", "reproduce on safari", offset=2, parent=fix, position=0, at=utc(d(4), 14, 1), done=utc(d(2), 11, 5))
entry("task", "patch the cookie domain", offset=2, parent=fix, position=1, at=utc(d(4), 14, 2), done=utc(d(2), 13, 52))
entry("note", "culprit: `SameSite=Lax` behind the proxy", offset=2, position=1, at=utc(d(2), 13, 58))
entry("note", "lisbon: stay near the 28 tram line", offset=2, tags=["travel"], position=2, at=utc(d(2), 19, 20))

# ---- three days ago --------------------------------------------------------------------
entry("note", "# launch prep", offset=3, tags=["launch"], position=0, at=utc(d(3), 9, 0))
price = entry("note", "pricing page: annual plan gets **two months free**", offset=3, position=1, at=utc(d(3), 9, 14))
entry("note", "ask sam if billing supports it", offset=3, parent=price, position=0, at=utc(d(3), 9, 16))
entry("note", "demo video under 15 seconds. nobody watches more", offset=3, position=2, at=utc(d(3), 16, 30))
entry("note", "walked home the long way, no phone", offset=3, tags=["health"], position=3, at=utc(d(3), 19, 5))

# ---- four days ago ---------------------------------------------------------------------
entry("note", "user call #4: “I just want to know what I did yesterday”", offset=4, tags=["research"], position=0, at=utc(d(4), 11, 0))
entry("note", "sketched the empty state as a single blinking bullet", offset=4, tags=["design"], position=1, at=utc(d(4), 15, 10))

# ---- focus sessions: 30 days, trending up, lighter weekends ----------------------------
rng = random.Random(28)
sessions = []
for offset in range(29, -1, -1):
    on = d(offset)
    weekend = on.weekday() >= 5
    trend = 0.55 + 0.45 * (29 - offset) / 29
    minutes = (70 if weekend else 170) * trend + rng.uniform(-25, 30)
    if offset == 0:
        blocks = [(8, 2, 72 * 60 + 36)]  # this morning: 1h 12m 36s, already finished
    else:
        blocks, start_h, left = [], 8 + rng.randint(0, 1), int(minutes * 60)
        start_m = rng.randint(0, 50)
        while left > 300:
            length = min(left, rng.randint(35, 95) * 60 + rng.randint(0, 59))
            blocks.append((start_h, start_m, length))
            left -= length
            end = datetime(2000, 1, 1, start_h, start_m) + timedelta(seconds=length + rng.randint(20, 70) * 60)
            start_h, start_m = end.hour, end.minute
    for hh, mm, length in blocks:
        start = datetime(on.year, on.month, on.day, hh, mm, tzinfo=TZ).astimezone(timezone.utc)
        end = start + timedelta(seconds=length)
        sessions.append((start.strftime("%Y-%m-%dT%H:%M:%SZ"), end.strftime("%Y-%m-%dT%H:%M:%SZ")))
db.executemany("INSERT INTO sessions(started_at, ended_at) VALUES (?, ?)", sessions)

db.commit()
assert not db.execute("PRAGMA foreign_key_check").fetchall()
print(f"seeded {TODAY}: {db.execute('SELECT COUNT(*) FROM entries').fetchone()[0]} entries, "
      f"{len(sessions)} sessions, {len(day_ids)} days")
db.close()

# The rows must be visible through the server, or it was started on another file.
with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/journal?timezone=Europe/Stockholm") as response:
    if not json.load(response)["tasks"]:
        sys.exit(f"the server on port {PORT} does not read {DB}; start it with STILL_DB_PATH={DB}")
