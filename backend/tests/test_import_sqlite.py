import sqlite3

import psycopg
import pytest

from backend.import_sqlite import apply, inspect


def legacy(path):
    with sqlite3.connect(path) as db:
        db.executescript('''
            CREATE TABLE days(id INTEGER PRIMARY KEY, date TEXT, created_at TEXT);
            CREATE TABLE tasks(id INTEGER PRIMARY KEY, content TEXT, tags TEXT, created_at TEXT, completed_at TEXT, parent_id INTEGER, position INTEGER, client_id TEXT);
            CREATE TABLE notes(id INTEGER PRIMARY KEY, day_id INTEGER, content TEXT, tags TEXT, created_at TEXT, updated_at TEXT, source_task_id INTEGER, client_id TEXT, parent_id INTEGER, position INTEGER);
            CREATE TABLE sessions(id INTEGER PRIMARY KEY, started_at TEXT, ended_at TEXT);
            CREATE TABLE document_operations(id TEXT PRIMARY KEY, created_at TEXT, undone INTEGER);
            CREATE TABLE document_changes(operation_id TEXT, entity TEXT, row_id INTEGER, phase TEXT, present INTEGER, content TEXT, tags TEXT, day_id INTEGER, parent_id INTEGER, position INTEGER, created_at TEXT, updated_at TEXT, completed_at TEXT, source_task_id INTEGER, client_id TEXT);
            INSERT INTO days VALUES(7, '2026-09-16', '2026-09-16T12:00:00Z');
            INSERT INTO tasks VALUES(11, 'Task', '["work"]', '2026-09-16T12:00:00Z', NULL, NULL, 0, 'task-id');
            INSERT INTO notes VALUES(22, 7, '[Docs](https://example.com)', '["work"]', '2026-09-16T12:00:00Z', '2026-09-16T12:00:00Z', NULL, 'note-id', NULL, 0);
            INSERT INTO sessions VALUES(33, '2026-09-16T12:00:00Z', '2026-09-16T12:30:00Z');
        ''')


def test_sqlite_preflight_and_import_preserve_ids_and_content(tmp_path):
    source = tmp_path / 'still.sqlite3'
    legacy(source)
    copied = inspect(source)
    assert copied['notes'][0]['content'] == '[Docs](https://example.com)'
    url = 'postgresql://127.0.0.1:55432/still_import_test'
    admin = 'postgresql://127.0.0.1:55432/postgres'
    with psycopg.connect(admin, autocommit=True) as db:
        db.execute('DROP DATABASE IF EXISTS still_import_test')
        db.execute('CREATE DATABASE still_import_test')
    try:
        assert apply(copied, url)['notes'] == 1
        with psycopg.connect(url) as db:
            note = db.execute('SELECT id, content, tags FROM notes').fetchone()
            assert note == (22, '[Docs](https://example.com)', ['work'])
        with pytest.raises(ValueError, match='already contains'):
            apply(copied, url)
    finally:
        with psycopg.connect(admin, autocommit=True) as db:
            db.execute('DROP DATABASE IF EXISTS still_import_test')
