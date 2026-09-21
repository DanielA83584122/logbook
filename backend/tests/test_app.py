import importlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

module = importlib.import_module("backend.app")
NOW = datetime(2026, 9, 16, 18, tzinfo=timezone.utc)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("STILL_DB_PATH", str(tmp_path / "test.sqlite3"))
    monkeypatch.setattr(module, "utcnow", lambda: NOW)
    with TestClient(module.app) as client:
        yield client


def add_session(client, start, seconds):
    response = client.post("/api/sessions", json={"started_at": start, "duration_seconds": seconds})
    assert response.status_code == 201, response.text
    return response.json()


def test_journal_starts_on_local_day_and_persists_notes(client):
    journal = client.get("/api/journal?timezone=Asia/Tokyo").json()
    assert journal["today"] == "2026-09-17"
    assert journal["days"][0]["notes"] == []
    note = client.post("/api/notes", json={"content": "  A thought  ", "date": journal["today"]}).json()
    assert note["content"] == "  A thought  "
    assert client.get("/api/journal?timezone=Asia/Tokyo").json()["days"][0]["notes"][0]["id"] == note["id"]
    assert client.patch(f"/api/notes/{note['id']}", json={"content": "A revised thought"}).status_code == 200
    assert client.delete(f"/api/notes/{note['id']}").status_code == 204
    assert client.get("/api/journal?timezone=Asia/Tokyo").json()["days"][0]["notes"] == []


def test_authentication_flag_defaults_off_and_can_protect_the_api(client, monkeypatch):
    assert client.get('/api/export').status_code == 200
    monkeypatch.setenv('STILL_AUTH_ENABLED', 'true')
    monkeypatch.setenv('STILL_AUTH_PASSWORD', 'private-test-password')
    assert client.get('/api/health').status_code == 200
    assert client.get('/api/export').status_code == 401
    assert client.get('/api/export', auth=('still', 'wrong')).status_code == 401
    assert client.get('/api/export', auth=('still', 'private-test-password')).status_code == 200


def test_task_completion_is_atomic_and_idempotent(client):
    task = client.post("/api/tasks", json={"content": "overdue trainings"}).json()
    for _ in range(2):
        assert client.post(f"/api/tasks/{task['id']}/complete?timezone=Asia/Tokyo").status_code == 200
    data = client.get("/api/journal?timezone=Asia/Tokyo").json()
    assert data["tasks"] == []
    assert [task["content"] for task in data["days"][0]["tasks"]] == ["overdue trainings"]
    assert data["days"][0]["tasks"][0]["completed_at"]
    assert data["days"][0]["date"] == "2026-09-17"
    edited = client.patch(f"/api/tasks/{task['id']}", json={"content": "changed"})
    assert edited.status_code == 200 and edited.json()["content"] == "changed"


def test_concurrent_task_completion_places_one_task_in_the_logbook(client):
    task = client.post("/api/tasks", json={"content": "One thing"}).json()
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: client.post(f"/api/tasks/{task['id']}/complete"), range(4)))
    assert all(r.status_code == 200 for r in results)
    day = client.get("/api/journal").json()["days"][0]
    assert len(day["tasks"]) == 1 and day["tasks"][0]["completed_at"]


def test_timer_start_stop_reset_and_stale_retry(client, monkeypatch):
    first = client.post("/api/timer/start").json()
    assert client.post("/api/timer/start").json()["id"] == first["id"]
    monkeypatch.setattr(module, "utcnow", lambda: NOW + timedelta(minutes=25))
    running = client.get("/api/journal").json()
    assert running["days"][0]["focused_seconds"] == 1500
    stopped = client.post("/api/timer/stop", json={"session_id": first["id"]}).json()
    assert stopped["duration_seconds"] == 1500
    second = client.post("/api/timer/start").json()
    assert second["id"] != first["id"] and second["duration_seconds"] == 0
    client.post("/api/timer/stop", json={"session_id": first["id"]})
    assert client.get("/api/timer").json()["active_session"]["id"] == second["id"]
    assert client.get("/api/stats").json()["total_focused_seconds"] == 1500


def test_concurrent_timer_starts_have_one_session(client):
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: client.post("/api/timer/start").json()["id"], range(4)))
    assert len(set(results)) == 1


def test_midnight_allocates_focus_to_both_days(client):
    session = add_session(client, "2026-09-15T23:30:00-07:00", 5400)
    stats = client.get("/api/stats?start=2026-09-15&end=2026-09-16&timezone=America/Los_Angeles").json()
    assert [d["focused_seconds"] for d in stats["daily"]] == [1800, 3600]
    assert [d["longest_session_seconds"] for d in stats["daily"]] == [1800, 3600]
    assert stats["session_count"] == 1
    assert stats["average_daily_focused_seconds"] == 2700
    detail = client.get("/api/sessions?date=2026-09-16&timezone=America/Los_Angeles").json()[0]
    assert detail["id"] == session["id"]
    assert detail["duration_seconds"] == 5400 and detail["seconds_on_day"] == 3600


@pytest.mark.parametrize("start,seconds,day", [
    ("2026-03-08T00:00:00-08:00", 23 * 3600, "2026-03-08"),
    ("2025-11-02T00:00:00-07:00", 25 * 3600, "2025-11-02"),
])
def test_daylight_saving_days_use_real_elapsed_seconds(client, start, seconds, day):
    add_session(client, start, seconds)
    stats = client.get(f"/api/stats?start={day}&end={day}&timezone=America/Los_Angeles").json()
    assert stats["daily"][0]["focused_seconds"] == seconds


def test_stats_include_zero_days_and_daily_longest(client):
    add_session(client, "2026-09-14T08:00:00Z", 3600)
    add_session(client, "2026-09-14T10:00:00Z", 1800)
    add_session(client, "2026-09-15T10:00:00Z", 1800)
    stats = client.get("/api/stats?start=2026-09-14&end=2026-09-16").json()
    assert stats["average_daily_focused_seconds"] == 2400
    assert stats["average_daily_longest_session_seconds"] == 1800
    assert stats["average_active_day_focused_seconds"] == 3600
    assert stats["active_days"] == 2
    assert stats["session_count"] == 3
    assert stats["daily"][-1]["focused_seconds"] == 0
    assert client.get("/api/stats/daily?start=2026-09-14&end=2026-09-16").json()["daily"] == stats["daily"]


def test_session_edit_delete_updates_stats(client):
    session = add_session(client, "2026-09-14T08:00:00Z", 3600)
    edit = client.patch(f"/api/sessions/{session['id']}", json={"started_at": "2026-09-15T08:00:00Z", "duration_seconds": 1800})
    assert edit.status_code == 200
    stats = client.get("/api/stats?start=2026-09-14&end=2026-09-15").json()
    assert [d["focused_seconds"] for d in stats["daily"]] == [0, 1800]
    assert client.delete(f"/api/sessions/{session['id']}").status_code == 204
    assert client.get("/api/stats").json()["total_focused_seconds"] == 0


def test_overlaps_and_future_sessions_are_rejected(client):
    add_session(client, "2026-09-14T08:00:00Z", 3600)
    for start, seconds, status in [
        ("2026-09-14T08:30:00Z", 3600, 409),
        ("2026-09-17T08:00:00Z", 3600, 422),
        ("2026-09-14T08:00:00", 3600, 422),
        ("2026-09-14T08:00:00Z", -1, 422),
    ]:
        assert client.post("/api/sessions", json={"started_at": start, "duration_seconds": seconds}).status_code == status


def test_running_session_cannot_be_edited_or_deleted(client):
    session = client.post("/api/timer/start").json()
    assert client.delete(f"/api/sessions/{session['id']}").status_code == 409
    assert client.patch(f"/api/sessions/{session['id']}", json={"started_at": "2026-09-14T08:00:00Z", "duration_seconds": 10}).status_code == 409


def test_validation_and_pagination(client):
    assert client.get("/api/journal?timezone=bogus").status_code == 422
    assert client.post("/api/tasks", json={"content": "   "}).status_code == 422
    assert client.get("/api/stats?start=2026-09-16&end=2026-09-15").status_code == 422
    assert client.get("/api/stats?start=1900-01-01").status_code == 422
    for day in ("2026-09-10", "2026-09-11", "2026-09-12"):
        client.post("/api/notes", json={"content": day, "date": day})
    first = client.get("/api/journal?limit=2").json()
    assert [d["date"] for d in first["days"]] == ["2026-09-16", "2026-09-12"]
    second = client.get(f"/api/journal?limit=2&before={first['next_cursor']}").json()
    assert [d["date"] for d in second["days"]] == ["2026-09-11", "2026-09-10"]
    assert second["next_cursor"] is None


def test_export_contains_normalized_rows_and_schema_version(client):
    task = client.post("/api/tasks", json={"content": "Read"}).json()
    client.post(f"/api/tasks/{task['id']}/complete")
    data = client.get("/api/export").json()
    assert data["schema_version"] == 8
    assert data["entries"] == data["tasks"]
    assert data["notes"] == []
    assert data["tasks"][0]["completed_at"]


def test_note_creation_retry_does_not_duplicate(client):
    payload = {"date": "2026-09-16", "content": "Keep this thought", "client_id": "test-retry-id"}
    first = client.post("/api/notes", json=payload).json()
    second = client.post("/api/notes", json={**payload, "content": "Keep this updated thought"}).json()
    assert first["id"] == second["id"]
    notes = client.get("/api/journal").json()["days"][0]["notes"]
    assert len(notes) == 1 and notes[0]["content"] == "Keep this updated thought"


@pytest.mark.parametrize("content", [
    "**bold** and *italic*, [docs](https://example.com), `code`, ~~strike~~, ++underline++",
    "Use `` `literal backticks` `` and <JIRA link>",
    "A line  \nwith a hard break  ",
    "```\nconst value = 1;\n```",
    "    indented code\n    stays indented",
    "## Heading",
    "> Quote",
])
def test_markdown_roundtrips_through_sqlite_and_task_completion(client, content):
    from backend.db import connection
    note = client.post("/api/notes", json={"date": "2026-09-16", "content": content}).json()
    task = client.post("/api/tasks", json={"content": content}).json()
    assert note["content"] == task["content"] == content
    for kind, row in [("notes", note), ("tasks", task)]:
        assert client.patch(f"/api/{kind}/{row['id']}", json={"content": content}).json()["content"] == content
        with connection() as db:
            entry_kind = 'note' if kind == 'notes' else 'task'
            assert db.execute("SELECT content FROM entries WHERE kind = ? AND id = ?", (entry_kind, row["id"])).fetchone()["content"] == content
    assert client.post(f"/api/tasks/{task['id']}/complete").status_code == 200
    exported = client.get("/api/export").json()
    assert exported["content_format"] == "markdown"
    completed = next(row for row in exported["tasks"] if row["id"] == task["id"])
    assert completed["content"] == content
    assert completed["completed_at"]
