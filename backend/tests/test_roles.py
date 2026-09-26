"""Waiting rows: what a to-do waits on, nested under it."""
import sqlite3

from .test_app import client  # noqa: F401
from .test_document import batch, history


def note(client, content, **extra):
    response = client.post('/api/notes', json={'date': '2026-09-16', 'content': content, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def task(client, content, **extra):
    response = client.post('/api/tasks', json={'content': content, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def test_roles_are_validated_per_kind_and_kept_on_edit(client):
    plain = note(client, 'a plain bullet')
    assert plain['role'] == ''
    assert client.post('/api/notes', json={'date': '2026-09-16', 'content': 'no', 'role': 'scratch'}).status_code == 422
    assert client.post('/api/tasks', json={'content': 'no', 'role': 'wait'}).status_code == 422
    assert client.post('/api/notes', json={'date': '2026-09-16', 'content': 'no', 'role': 'wait'}).status_code == 422
    parent = task(client, 'Fence quote')
    waiting = task(client, "the neighbour's answer", parent_id=parent['id'], role='wait')
    assert waiting['role'] == 'wait'
    assert client.patch(f"/api/tasks/{waiting['id']}", json={'content': 'their answer'}).json()['role'] == 'wait'
    rows = {row['id']: row for row in client.get('/api/journal').json()['tasks']}
    assert rows[parent['id']]['child_count'] == 0
    assert rows[waiting['id']]['role'] == 'wait'


def test_waiting_rows_hold_a_parent_open_and_settle_when_it_finishes(client):
    parent = task(client, 'Fence quote')
    step = task(client, 'Ask two builders', parent_id=parent['id'])
    waiting = task(client, "the neighbour's answer", parent_id=parent['id'], role='wait')
    assert client.post(f"/api/tasks/{step['id']}/complete").json()['task_ids'] == [step['id']]
    rows = {row['id']: row for row in client.get('/api/journal').json()['tasks']}
    assert not rows[parent['id']]['completed_at']
    assert rows[parent['id']]['child_count'] == 1 and rows[parent['id']]['completed_child_count'] == 1
    # Settling the last thing it waited on finishes the ready parent and moves the tree to the logbook.
    assert client.post(f"/api/tasks/{waiting['id']}/complete").json()['task_ids'] == [waiting['id'], parent['id']]
    assert client.get('/api/journal').json()['tasks'] == []
    day = client.get('/api/journal').json()['days'][0]
    assert {row['id']: row['role'] for row in day['tasks']} == {parent['id']: '', step['id']: '', waiting['id']: 'wait'}
    # Reopening the parent keeps the settled waiting row settled.
    client.post(f"/api/tasks/{parent['id']}/reopen", json={})
    rows = {row['id']: row for row in client.get('/api/journal').json()['tasks']}
    assert not rows[parent['id']]['completed_at'] and not rows[step['id']]['completed_at']
    assert rows[waiting['id']]['completed_at']
    # A to-do that only waits stays open when the wait is settled: waiting is not a step.
    alone = task(client, 'Call the bank')
    answer = task(client, 'their callback', parent_id=alone['id'], role='wait')
    assert client.post(f"/api/tasks/{answer['id']}/complete").json()['task_ids'] == [answer['id']]
    rows = {row['id']: row for row in client.get('/api/journal').json()['tasks']}
    assert not rows[alone['id']]['completed_at'] and rows[answer['id']]['completed_at']
    assert client.post(f"/api/tasks/{alone['id']}/complete").status_code == 200
    # Completing a parent by hand settles what it still waits on rather than refusing.
    second = task(client, 'the council', parent_id=parent['id'], role='wait')
    client.post(f"/api/tasks/{step['id']}/complete")
    assert client.post(f"/api/tasks/{parent['id']}/complete").status_code == 200
    day = client.get('/api/journal').json()['days'][0]
    assert all(row['completed_at'] for row in day['tasks'])
    assert {row['id'] for row in day['tasks']} >= {parent['id'], second['id']}


def test_waiting_rows_are_undoable_and_survive_a_migration(client, tmp_path, monkeypatch):
    parent = task(client, 'Fence quote')
    created = batch(client, [{'kind': 'tasks', 'content': 'the second quote', 'role': 'wait', 'parent_id': parent['id'], 'client_id': 'wait-1'}])
    row = created['items'][0]
    assert row['role'] == 'wait'
    history(client, created['operation_id'])
    assert [r['content'] for r in client.get('/api/export').json()['tasks']] == ['Fence quote']
    history(client, created['operation_id'], redo=True)
    assert client.get('/api/export').json()['tasks'][1]['role'] == 'wait'
    agent = client.get('/api/agent/journal', params={'start': '2026-09-16', 'end': '2026-09-16'}).json()
    assert agent['tasks'][0]['children'][0]['role'] == 'wait'

    # A database from before roles gains the columns without losing its history.
    from backend.db import db_path, initialize
    path = db_path()
    with sqlite3.connect(path) as db:
        db.execute('ALTER TABLE entries DROP COLUMN role')
        db.execute('ALTER TABLE document_changes DROP COLUMN role')
        db.execute('PRAGMA user_version = 11')
    initialize()
    with sqlite3.connect(path) as db:
        db.row_factory = sqlite3.Row
        assert db.execute('PRAGMA user_version').fetchone()[0] == 13
        assert db.execute("SELECT role FROM entries WHERE id = ?", (row['id'],)).fetchone()['role'] == ''
        assert db.execute('SELECT COUNT(*) FROM document_changes').fetchone()[0] > 0
    # Version 12 briefly allowed folded scratch notes; on upgrade they are plain bullets again.
    with sqlite3.connect(path) as db:
        db.execute('ALTER TABLE entries DROP COLUMN role')
        db.execute("ALTER TABLE entries ADD COLUMN role TEXT NOT NULL DEFAULT '' CHECK(role IN ('', 'scratch', 'wait'))")
        db.execute("UPDATE entries SET role = 'scratch' WHERE id = ?", (parent['id'],))
        db.execute("UPDATE entries SET role = 'wait' WHERE id = ?", (row['id'],))
        db.execute('PRAGMA user_version = 12')
    initialize()
    tasks = {r['id']: r for r in client.get('/api/export').json()['tasks']}
    assert tasks[parent['id']]['role'] == '' and tasks[row['id']]['role'] == 'wait'
