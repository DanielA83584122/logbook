from backend.db import connection
from .test_app import client  # noqa: F401


def note(client, content, tags=None, **extra):
    response = client.post('/api/notes', json={'date': '2026-09-15', 'content': content, 'tags': tags or [], **extra})
    assert response.status_code == 201, response.text
    return response.json()


def test_tag_arrays_are_separate_from_markdown_and_preserved_on_patch(client):
    created = note(client, '**Ship the PR**', ['Work', 'work', '#work', 'health'])
    assert created['tags'] == ['work', 'health']
    with connection() as db:
        stored = db.execute('SELECT content, tags FROM notes WHERE id = ?', (created['id'],)).fetchone()
        assert stored['content'] == '**Ship the PR**'
        assert stored['tags'] == ['work', 'health']
        assert not db.execute("SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tags'").fetchone()
    edited = client.patch(f"/api/notes/{created['id']}", json={'content': '**Shipped the PR**'}).json()
    assert edited['tags'] == ['work', 'health']
    assert client.patch(f"/api/notes/{created['id']}", json={'content': 'Shipped', 'tags': []}).json()['tags'] == []
    assert client.get('/api/tags').json() == []


def test_tag_only_bullets_and_task_completion(client):
    task = client.post('/api/tasks', json={'content': '', 'tags': ['focus']}).json()
    assert task['content'] == ''
    assert client.get('/api/tags').json() == [{'name': 'focus', 'note_count': 0, 'task_count': 1}]
    assert client.post(f"/api/tasks/{task['id']}/complete").status_code == 200
    completed = client.get('/api/export').json()['notes'][0]
    assert completed['tags'] == ['focus']
    assert '#' not in completed['content']
    assert client.get('/api/tags').json() == [{'name': 'focus', 'note_count': 1, 'task_count': 0}]
    client.delete(f"/api/notes/{completed['id']}")
    assert client.get('/api/tags').json() == []
    assert client.post('/api/tasks', json={'content': '', 'tags': []}).status_code == 422


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


def test_postgres_allows_tag_only_rows(client):
    assert note(client, '', tags=['tag-only'])['tags'] == ['tag-only']
