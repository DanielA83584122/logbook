from .test_app import client  # noqa: F401
from .test_hierarchy import create


def batch(client, changes):
    response = client.post('/api/document/edit', json={'changes': changes})
    assert response.status_code == 200, response.text
    return response.json()


def history(client, operation, redo=False):
    response = client.post('/api/document/history', json={'operations': [operation], 'redo': redo})
    assert response.status_code == 200, response.text


def test_completed_children_stay_until_immediate_parent_finishes(client):
    root = create(client, 'tasks', 'Project')
    parent = create(client, 'tasks', 'Phase', root['id'])
    later = create(client, 'tasks', 'Later', root['id'])
    first = create(client, 'tasks', 'One', parent['id'])
    second = create(client, 'tasks', 'Two', parent['id'])
    assert client.post(f"/api/tasks/{parent['id']}/complete").status_code == 409
    client.post(f"/api/tasks/{first['id']}/complete")
    rows = {row['id']: row for row in client.get('/api/journal').json()['tasks']}
    assert rows[first['id']]['completed_at']
    assert rows[parent['id']]['child_count'] == 2
    assert rows[parent['id']]['completed_child_count'] == 1
    final = client.post(f"/api/tasks/{second['id']}/complete").json()
    assert final['task_ids'] == [second['id'], parent['id']]
    rows = {row['id']: row for row in client.get('/api/journal').json()['tasks']}
    assert set(rows) == {root['id'], parent['id'], later['id']}
    assert rows[parent['id']]['completed_at']
    assert rows[root['id']]['completed_child_count'] == 1
    assert client.get('/api/export').json()['notes'] == []
    client.post(f"/api/tasks/{later['id']}/complete")
    assert client.get('/api/journal').json()['tasks'] == []
    day = client.get('/api/journal').json()['days'][0]
    assert {row['id'] for row in day['tasks']} == {root['id'], parent['id'], later['id'], first['id'], second['id']}


def test_undo_final_child_reopens_ancestors_and_retains_earlier_children(client):
    parent = create(client, 'tasks', 'Parent')
    first = create(client, 'tasks', 'First', parent['id'])
    last = create(client, 'tasks', 'Last', parent['id'])
    client.post(f"/api/tasks/{first['id']}/complete")
    result = client.post(f"/api/tasks/{last['id']}/complete").json()
    assert client.post(f"/api/tasks/{last['id']}/reopen", json={'completed_at': result['completed_at']}).status_code == 200
    rows = {row['id']: row for row in client.get('/api/journal').json()['tasks']}
    assert len(rows) == 3 and rows[first['id']]['completed_at']
    assert rows[last['id']]['completed_at'] is None and rows[parent['id']]['completed_at'] is None
    assert client.get('/api/export').json()['notes'] == []
    client.post(f"/api/tasks/{last['id']}/complete")
    assert client.get('/api/export').json()['notes'] == []


def test_reopen_keeps_the_task_as_the_same_logbook_entry(client):
    task = create(client, 'tasks', 'Read')
    client.post(f"/api/tasks/{task['id']}/complete")
    client.post(f"/api/tasks/{task['id']}/reopen", json={})
    row = client.get('/api/export').json()['tasks'][0]
    assert row['id'] == task['id'] and row['content'] == 'Read' and row['completed_at'] is None


def test_document_create_edit_undo_redo_keeps_ids_and_markdown(client):
    added = batch(client, [{'kind': 'notes', 'date': '2026-09-16', 'content': '**first**', 'tags': ['work'], 'client_id': 'retry'}])
    note = added['items'][0]
    retry = batch(client, [{'kind': 'notes', 'date': '2026-09-16', 'content': '**first**', 'tags': ['work'], 'client_id': 'retry'}])
    assert retry['operation_id'] is None and retry['items'][0]['id'] == note['id']
    edited = batch(client, [{'kind': 'notes', 'id': note['id'], 'content': '*second*'}])
    history(client, edited['operation_id'])
    assert client.get('/api/export').json()['notes'][0]['content'] == '**first**'
    history(client, added['operation_id'])
    assert client.get('/api/export').json()['notes'] == []
    history(client, added['operation_id'], True)
    history(client, edited['operation_id'], True)
    restored = client.get('/api/export').json()['notes'][0]
    assert restored['id'] == note['id'] and restored['content'] == '*second*' and restored['tags'] == ['work']


def test_batch_delete_undo_restores_parent_child_order(client):
    parent = create(client, 'notes', 'Parent')
    child = create(client, 'notes', 'Child', parent['id'])
    result = batch(client, [{'kind': 'notes', 'id': parent['id'], 'delete': True}, {'kind': 'notes', 'id': child['id'], 'delete': True}])
    assert client.get('/api/export').json()['notes'] == []
    history(client, result['operation_id'])
    notes = client.get('/api/export').json()['notes']
    assert next(row for row in notes if row['id'] == child['id'])['parent_id'] == parent['id']
    history(client, result['operation_id'], True)
    assert client.get('/api/export').json()['notes'] == []


def test_history_conflict_and_batch_failure_are_atomic(client):
    first = create(client, 'notes', 'First')
    result = batch(client, [{'kind': 'notes', 'id': first['id'], 'content': 'Edited'}])
    client.patch(f"/api/notes/{first['id']}", json={'content': 'Changed in another window'})
    assert client.post('/api/document/history', json={'operations': [result['operation_id']]}).status_code == 409
    assert client.get('/api/export').json()['notes'][0]['content'] == 'Changed in another window'
    response = client.post('/api/document/edit', json={'changes': [{'kind': 'notes', 'id': first['id'], 'content': 'Must roll back'}, {'kind': 'notes', 'content': ''}]})
    assert response.status_code == 422
    assert client.get('/api/export').json()['notes'][0]['content'] == 'Changed in another window'


def test_archive_search_includes_unloaded_nested_notes_and_paginates(client):
    parent = create(client, 'notes', 'Old parent', day='2020-01-01')
    for i in range(5):
        create(client, 'notes', f'Needle {i}', parent['id'], day='2020-01-01')
    result = client.get('/api/search?q=NEEDLE&limit=2').json()
    assert len(result['results']) == 2 and result['next_offset'] == 2
    assert result['results'][0]['date'] == '2020-01-01'
    assert result['results'][0]['parent_id'] == parent['id']
    assert len(client.get('/api/search?q=needle&offset=4&limit=2').json()['results']) == 1
    day = client.get('/api/journal?on=2020-01-01').json()['days']
    assert len(day) == 1 and len(day[0]['notes']) == 6


def test_archive_search_finds_completed_tasks_in_their_logbook_day(client):
    task = create(client, 'tasks', 'A finished searchable task')
    client.post(f"/api/tasks/{task['id']}/complete")
    result = client.get('/api/search?q=searchable').json()['results']
    assert len(result) == 1
    assert (result[0]['id'], result[0]['kind'], result[0]['date']) == (task['id'], 'tasks', '2026-09-16')


def test_new_subtask_under_completed_task_starts_completed_and_reopens_tree(client):
    parent = create(client, 'tasks', 'Already done')
    client.post(f"/api/tasks/{parent['id']}/complete")
    child = create(client, 'tasks', 'Added afterward', parent['id'])
    assert child['completed_at'] and child['parent_id'] == parent['id']
    logbook = client.get('/api/journal').json()['days'][0]['tasks']
    assert {row['id'] for row in logbook} == {parent['id'], child['id']}
    client.post(f"/api/tasks/{child['id']}/reopen", json={})
    todos = {row['id']: row for row in client.get('/api/journal').json()['tasks']}
    assert todos[parent['id']]['completed_at'] is None
    assert todos[child['id']]['completed_at'] is None


def test_removing_last_open_child_finishes_parent_and_undo_restores_it(client):
    parent = create(client, 'tasks', 'Group')
    done = create(client, 'tasks', 'Done', parent['id'])
    remaining = create(client, 'tasks', 'Remove', parent['id'])
    client.post(f"/api/tasks/{done['id']}/complete")
    result = batch(client, [{'kind': 'tasks', 'id': remaining['id'], 'delete': True}])
    assert client.get('/api/journal').json()['tasks'] == []
    assert client.get('/api/export').json()['notes'] == []
    history(client, result['operation_id'])
    tasks = {row['id']: row for row in client.get('/api/journal').json()['tasks']}
    assert len(tasks) == 3 and tasks[parent['id']]['completed_at'] is None
    assert tasks[done['id']]['completed_at']
    assert client.get('/api/export').json()['notes'] == []
