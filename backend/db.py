"""SQLite storage. All related writes use a single transaction."""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .tags import initialize_tags
from .history import SCHEMA as HISTORY_SCHEMA

SCHEMA = """
CREATE TABLE IF NOT EXISTS days (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY,
    day_id INTEGER NOT NULL REFERENCES days(id),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_task_id INTEGER UNIQUE REFERENCES tasks(id),
    client_id TEXT
);
CREATE INDEX IF NOT EXISTS notes_day ON notes(day_id, id);
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    CHECK(ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_running_session ON sessions((1)) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_start ON sessions(started_at);
"""


def db_path():
    return Path(os.environ.get("STILL_DB_PATH", Path(__file__).resolve().parents[1] / "data/still.sqlite3"))


@contextmanager
def connection():
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize():
    with connection() as db:
        db.execute("PRAGMA journal_mode = WAL")
        db.executescript(SCHEMA)
        # Version 2 adds retry-safe note creation to existing logbooks.
        columns = {r["name"] for r in db.execute("PRAGMA table_info(notes)")}
        if "client_id" not in columns:
            db.execute("ALTER TABLE notes ADD COLUMN client_id TEXT")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS notes_client_id ON notes(client_id)")
        # Version 3 stores each bullet's parent and order; existing rows stay at the root.
        for table in ("tasks", "notes"):
            columns = {r["name"] for r in db.execute(f"PRAGMA table_info({table})")}
            if "parent_id" not in columns:
                db.execute(f"ALTER TABLE {table} ADD COLUMN parent_id INTEGER REFERENCES {table}(id) ON DELETE SET NULL")
            if "position" not in columns:
                db.execute(f"ALTER TABLE {table} ADD COLUMN position INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0)")
                db.execute(f"UPDATE {table} SET position = id")
            db.execute(f"CREATE INDEX IF NOT EXISTS {table}_parent_order ON {table}(parent_id, position, id)")
            for event in ("INSERT", "UPDATE OF parent_id"):
                name = "insert" if event == "INSERT" else "update"
                db.execute(f"""CREATE TRIGGER IF NOT EXISTS {table}_no_cycle_{name}
                    BEFORE {event} ON {table} WHEN NEW.parent_id IS NOT NULL BEGIN
                    SELECT RAISE(ABORT, 'Bullet hierarchy cannot contain a cycle') WHERE NEW.id IN (
                        WITH RECURSIVE ancestors(id, parent_id) AS (
                            SELECT id, parent_id FROM {table} WHERE id = NEW.parent_id
                            UNION ALL SELECT p.id, p.parent_id FROM {table} p JOIN ancestors a ON p.id = a.parent_id
                        ) SELECT id FROM ancestors
                    ) OR NEW.id = NEW.parent_id;
                    END""")
        task_columns = {r["name"] for r in db.execute("PRAGMA table_info(tasks)")}
        if "client_id" not in task_columns:
            db.execute("ALTER TABLE tasks ADD COLUMN client_id TEXT")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS tasks_client_id ON tasks(client_id)")
        for event in ("INSERT", "UPDATE OF parent_id, day_id"):
            name = "insert" if event == "INSERT" else "update"
            db.execute(f"""CREATE TRIGGER IF NOT EXISTS notes_same_day_{name} BEFORE {event} ON notes BEGIN
                SELECT RAISE(ABORT, 'Nested notes must belong to the same day') WHERE
                    EXISTS (SELECT 1 FROM notes WHERE id = NEW.parent_id AND day_id != NEW.day_id)
                    OR EXISTS (SELECT 1 FROM notes WHERE parent_id = NEW.id AND day_id != NEW.day_id);
                END""")
        initialize_tags(db)
        db.executescript(HISTORY_SCHEMA)
        db.execute('PRAGMA user_version = 6')


def ensure_day(db, day, now):
    db.execute("INSERT OR IGNORE INTO days(date, created_at) VALUES (?, ?)", (str(day), now))
    return db.execute("SELECT id FROM days WHERE date = ?", (str(day),)).fetchone()["id"]
