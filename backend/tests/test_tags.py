import json

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.db import connection


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('STILL_DB_PATH', str(tmp_path / 'tags.sqlite3'))
    with TestClient(app) as client:
        yield client


def note(client, content, tags=None, **extra):
    response = client.post('/api/notes', json={'date': '2026-09-15', 'content': content, 'tags': tags or [], **extra})
    assert response.status_code == 201, response.text
    return response.json()


def test_tag_arrays_are_separate_from_markdown_and_preserved_on_patch(client):
    created = note(client, '**Ship the PR**', ['Work', 'work', '#work', 'health'])
    assert created['tags'] == ['work', 'health']
    with connection() as db:
        stored = db.execute("SELECT content, tags FROM entries WHERE kind = 'note' AND id = ?", (created['id'],)).fetchone()
        assert stored['content'] == '**Ship the PR**'
        assert json.loads(stored['tags']) == ['work', 'health']
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tags'").fetchone()
    edited = client.patch(f"/api/notes/{created['id']}", json={'content': '**Shipped the PR**'}).json()
    assert edited['tags'] == ['work', 'health']
    assert client.patch(f"/api/notes/{created['id']}", json={'content': 'Shipped', 'tags': []}).json()['tags'] == []
    assert client.get('/api/tags').json() == []


def test_tag_only_bullets_and_task_completion(client):
    task = client.post('/api/tasks', json={'content': '', 'tags': ['focus']}).json()
    assert task['content'] == ''
    assert client.get('/api/tags').json() == [{'name': 'focus', 'note_count': 0, 'task_count': 1}]
    assert client.post(f"/api/tasks/{task['id']}/complete").status_code == 200
    completed = client.get('/api/export').json()['tasks'][0]
    assert completed['tags'] == ['focus']
    assert '#' not in completed['content']
    assert client.get('/api/tags').json() == [{'name': 'focus', 'note_count': 0, 'task_count': 1}]
    client.post(f"/api/tasks/{task['id']}/reopen", json={})
    client.delete(f"/api/tasks/{task['id']}")
    assert client.get('/api/tags').json() == []
    assert client.post('/api/tasks', json={'content': '', 'tags': []}).status_code == 422


def test_completed_tagged_task_stays_filterable_in_its_logbook_day(client):
    task = client.post('/api/tasks', json={'content': 'Ship it', 'tags': ['work']}).json()
    client.post(f"/api/tasks/{task['id']}/complete")
    day = client.get('/api/journal?tag=work').json()['days'][0]
    assert day['tasks'][0]['id'] == task['id']


def test_filter_includes_descendants_but_excludes_unmatched_ancestors_and_siblings(client):
    parent = note(client, 'Tagged parent', ['work'])
    child = note(client, 'Untagged child', parent_id=parent['id'])
    grandchild = note(client, 'Nested child', ['other'], parent_id=child['id'])
    unrelated = note(client, 'Unrelated parent')
    tagged_child = note(client, 'Tagged child', ['work'], parent_id=unrelated['id'])
    note(client, 'Unrelated sibling', parent_id=unrelated['id'])
    data = client.get('/api/journal?tag=WORK').json()
    ids = {row['id'] for day in data['days'] for row in day['notes']}
    assert ids == {parent['id'], child['id'], grandchild['id'], tagged_child['id']}
    assert data['tag'] == 'work'
    task = client.post('/api/tasks', json={'content': 'Tagged task', 'tags': ['work']}).json()
    subtask = client.post('/api/tasks', json={'content': 'Child task', 'parent_id': task['id']}).json()
    client.post('/api/tasks', json={'content': 'Other task', 'tags': ['other']})
    assert {row['id'] for row in client.get('/api/journal?tag=work').json()['tasks']} == {task['id'], subtask['id']}


def test_filtered_history_paginates_and_empty_tags_disappear(client):
    for day in range(1, 26):
        note(client, f'Past work {day}', ['work'], date=f'2025-08-{day:02}')
        note(client, f'Other work {day}', ['other'], date=f'2025-07-{day:02}')
    result = client.get('/api/journal?tag=work&limit=14').json()
    assert len(result['days']) == 14
    older = client.get(f"/api/journal?tag=work&limit=14&before={result['next_cursor']}").json()
    assert len(older['days']) == 12
    assert older['next_cursor'] is None
    assert all(row['tags'] == ['work'] for page in [result, older] for day in page['days'] for row in day['notes'])
    assert {tag['name'] for tag in result['tags']} == {'work', 'other'}


def test_tag_validation_and_failed_creates_do_not_leave_tags(client):
    assert client.post('/api/tasks', json={'content': 'Bad', 'tags': ['not a tag']}).status_code == 422
    assert client.post('/api/tasks', json={'content': 'Bad', 'tags': ['unused'], 'parent_id': 999}).status_code in (404, 422)
    assert client.get('/api/tags').json() == []
    assert client.get('/api/journal?tag=not%20valid').status_code == 422


def test_migration_keeps_content_ids_and_hierarchy_while_allowing_tag_only_rows(tmp_path, monkeypatch):
    import sqlite3
    from backend.db import initialize
    path = tmp_path / 'old.sqlite3'
    monkeypatch.setenv('STILL_DB_PATH', str(path))
    with sqlite3.connect(path) as db:
        db.executescript('''
        CREATE TABLE days(id INTEGER PRIMARY KEY, date TEXT UNIQUE, created_at TEXT);
        CREATE TABLE tasks(id INTEGER PRIMARY KEY, content TEXT NOT NULL CHECK(length(trim(content)) > 0), created_at TEXT, completed_at TEXT, parent_id INTEGER REFERENCES tasks(id), position INTEGER DEFAULT 0, client_id TEXT);
        CREATE TABLE notes(id INTEGER PRIMARY KEY, day_id INTEGER REFERENCES days(id), content TEXT NOT NULL CHECK(length(trim(content)) > 0), created_at TEXT, updated_at TEXT, source_task_id INTEGER UNIQUE REFERENCES tasks(id), client_id TEXT, parent_id INTEGER REFERENCES notes(id), position INTEGER DEFAULT 0);
        INSERT INTO days VALUES(1, '2026-09-16', '2026-09-16T12:00:00Z');
        INSERT INTO tasks VALUES(1, 'Parent', 'created', 'completed', NULL, 0, 'task1');
        INSERT INTO tasks VALUES(2, 'Child', 'created', 'completed', 1, 0, 'task2');
        INSERT INTO notes VALUES(1, 1, 'Parent note', 'created', 'updated', 1, 'note1', NULL, 0);
        INSERT INTO notes VALUES(2, 1, 'Child note with literal #text', 'created', 'updated', 2, 'note2', 1, 0);
        PRAGMA user_version = 3;
        ''')
        old_notes = db.execute('SELECT * FROM notes ORDER BY id').fetchall()
        old_tasks = db.execute('SELECT * FROM tasks ORDER BY id').fetchall()
    initialize(); initialize()
    with connection() as db:
        notes = [dict(row) for row in db.execute("SELECT * FROM entries WHERE kind = 'note' ORDER BY id")]
        tasks = [dict(row) for row in db.execute("SELECT * FROM entries WHERE kind = 'task' ORDER BY id")]
        assert [row['content'] for row in notes] == ['Parent note', 'Child note with literal #text']
        assert notes[1]['parent_id'] == notes[0]['id']
        assert [row['content'] for row in tasks] == ['Parent', 'Child']
        assert tasks[1]['parent_id'] == tasks[0]['id']
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        db.execute("INSERT INTO entries(kind, day_id, content, tags, created_at) VALUES ('note', 1, '', '[\"tag-only\"]', 'created')")
        assert db.execute('PRAGMA user_version').fetchone()[0] == 11


def section_day(client):
    """Rows created in order: a plain root, a tagged section, its rows, a title-only section, a trailing root."""
    before = note(client, 'Before any section')
    section = note(client, '# fence and hedge #garden #house', ['garden', 'house'])
    first = note(client, 'Moved the bench')
    parent = note(client, 'Reading notes', ['reading'])
    child = note(client, 'Chapter four', parent_id=parent['id'])
    closing = note(client, '# other things')
    after = note(client, 'Not in the section')
    return before, section, first, parent, child, closing, after


def test_section_row_tags_apply_to_following_roots_until_the_next_section(client):
    before, section, first, parent, child, closing, after = section_day(client)
    data = client.get('/api/journal?tag=garden').json()
    ids = {row['id'] for day in data['days'] for row in day['notes']}
    assert ids == {section['id'], first['id'], parent['id'], child['id']}
    by_id = {row['id']: row for day in data['days'] for row in day['notes']}
    assert by_id[section['id']]['inherited_tags'] == []
    assert by_id[first['id']]['inherited_tags'] == ['garden', 'house']
    assert by_id[child['id']]['inherited_tags'] == ['garden', 'house', 'reading']
    assert by_id[first['id']]['tags'] == []
    unfiltered = {row['id']: row for day in client.get('/api/journal').json()['days'] for row in day['notes']}
    assert unfiltered[before['id']]['inherited_tags'] == []
    assert unfiltered[after['id']]['inherited_tags'] == []
    assert unfiltered[closing['id']]['inherited_tags'] == []
    assert client.get('/api/tags').json() == [
        {'name': 'garden', 'note_count': 4, 'task_count': 0},
        {'name': 'house', 'note_count': 4, 'task_count': 0},
        {'name': 'reading', 'note_count': 2, 'task_count': 0},
    ]
    assert {row['id'] for row in client.get('/api/search?q=%23house').json()['results']} == {section['id'], first['id'], parent['id'], child['id']}


def test_completed_task_tree_inside_a_section_inherits_its_tags(client):
    from datetime import datetime, timezone
    today = datetime.now(timezone.utc).date().isoformat()
    note(client, '# shipping #work', ['work'], date=today)
    task = client.post('/api/tasks', json={'content': 'Ship it'}).json()
    sub = client.post('/api/tasks', json={'content': 'Write the notes', 'parent_id': task['id']}).json()
    client.post(f"/api/tasks/{sub['id']}/complete")
    day = client.get('/api/journal?tag=work').json()['days'][0]
    assert {row['id'] for row in day['tasks']} == {task['id'], sub['id']}
    assert {row['id']: row['inherited_tags'] for row in day['tasks']} == {task['id']: ['work'], sub['id']: ['work']}
    assert client.get('/api/tags').json() == [{'name': 'work', 'note_count': 1, 'task_count': 2}]


def test_section_rows_cannot_hold_nested_bullets(client):
    section = note(client, '# fence #garden', ['garden'])
    response = client.post('/api/notes', json={'date': '2026-09-15', 'content': 'Nested', 'parent_id': section['id']})
    assert response.status_code == 409
    row = note(client, 'A root row')
    moved = client.post('/api/document/edit', json={'changes': [{'kind': 'notes', 'id': row['id'], 'move': True, 'parent_id': section['id']}]})
    assert moved.status_code == 409
    assert client.get('/api/journal?on=2026-09-15').json()['days'][0]['notes'][1]['parent_id'] is None


def test_untitled_section_row_needs_a_tag(client):
    assert client.post('/api/notes', json={'date': '2026-09-15', 'content': '#'}).status_code == 422
    assert client.post('/api/notes', json={'date': '2026-09-15', 'content': '# '}).status_code == 422
    tagged = client.post('/api/notes', json={'date': '2026-09-15', 'content': '# #garden', 'tags': ['garden']})
    assert tagged.status_code == 201
    row = note(client, 'Inside the untitled section')
    assert client.get('/api/journal?tag=garden&on=2026-09-15').json()['days'][0]['notes'][1]['id'] == row['id']


def test_agent_journal_reports_inherited_tags_and_matches_through_them(client):
    before, section, first, parent, child, closing, after = section_day(client)
    data = client.get('/api/agent/journal', params={'start': '2026-09-15', 'end': '2026-09-15', 'tag': 'garden'}).json()
    bullets = {row['id']: row for row in data['days'][0]['bullets']}
    assert set(bullets) == {section['id'], first['id'], parent['id']}
    assert bullets[first['id']]['matched'] is True
    assert bullets[first['id']]['inherited_tags'] == ['garden', 'house']
    assert bullets[parent['id']]['children'][0]['inherited_tags'] == ['garden', 'house', 'reading']
    markdown = client.get('/journal.md', params={'start': '2026-09-15', 'end': '2026-09-15', 'tag': 'garden'}).text
    assert '"inherited_tags": ["garden", "house"]' in markdown
