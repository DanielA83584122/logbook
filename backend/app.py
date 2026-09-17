from contextlib import asynccontextmanager
from datetime import date as CalendarDate, datetime, timedelta, timezone as dt_timezone
from pathlib import Path
import json
import os
import re
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator, model_validator
from psycopg.types.json import Jsonb

from .db import SCHEMA_VERSION, close_pool, connection, ensure_day, initialize
from .tags import bullet_dict, list_tags, matching_ids, normalize_tag, normalize_tags
from .stats import EMPTY_TOTALS, daily_totals, parse, slices, stamp
from .hierarchy import descendants, next_position, place, remove_preserving_children, validate_parent
from .tasks import visible_tasks
from .history import snapshot, record, restore
from .agent import AgentJournal, AgentQuery, DISCOVERY_LINKS, READ_HEADERS, markdown_journal, read_journal


def utcnow():
    return datetime.now(dt_timezone.utc)


def get_zone(name):
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, "Use a valid IANA timezone, such as America/Los_Angeles.")


@asynccontextmanager
async def lifespan(_app):
    initialize()
    try:
        yield
    finally:
        close_pool()


app = FastAPI(title="Still Logbook API", version="1.0.0", lifespan=lifespan,
              description="Personal focus journal. Timestamps are UTC; daily statistics use the requested IANA timezone.")


class Content(BaseModel):
    content: str = Field(max_length=10000, description="Markdown text only. Tags are separate metadata, not hashtags embedded in content.")
    tags: list[str] | None = Field(default=None, max_length=50, description="Optional list of tag names. Omit when editing to preserve existing tags; use [] to clear them.")

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value):
        return normalize_tags(value) if value is not None else None

    @model_validator(mode="after")
    def nonempty(self):
        if not self.content.strip() and not self.tags:
            raise ValueError("A bullet needs text or a tag.")
        return self


class NewBullet(Content):
    client_id: str | None = Field(default=None, min_length=1, max_length=80)
    parent_id: int | None = Field(default=None, ge=1)
    after_id: int | None = Field(default=None, ge=1)


class NewNote(NewBullet):
    date: CalendarDate


class BulletLocation(BaseModel):
    parent_id: int | None = Field(ge=1)
    after_id: int | None = Field(default=None, ge=1)


class SessionEdit(BaseModel):
    started_at: datetime
    duration_seconds: float = Field(gt=0, le=604800)

    @field_validator("started_at")
    @classmethod
    def aware(cls, value):
        if value.tzinfo is None:
            raise ValueError("Include a timezone offset in started_at.")
        return value.astimezone(dt_timezone.utc)


class StopTimer(BaseModel):
    session_id: int


def required(db, table, item_id):
    # table names are internal constants, never supplied by the caller.
    row = db.execute(f"SELECT * FROM {table} WHERE id = %s", (item_id,)).fetchone()
    if not row:
        raise HTTPException(404, "That item no longer exists.")
    return bullet_dict(row)


def session_dict(row, now=None):
    result = dict(row)
    end = parse(result["ended_at"]) if result["ended_at"] else (now or utcnow())
    result["duration_seconds"] = max(0, (end - parse(result["started_at"])).total_seconds())
    return result


@app.get("/api/health")
def health():
    return {"status": "ok", "storage": "postgresql"}


@app.get("/api/journal")
def journal(timezone: str = "UTC", before: CalendarDate | None = None, tag: str | None = None, on: CalendarDate | None = None,
            limit: Annotated[int, Query(ge=1, le=100)] = 21):
    zone = get_zone(timezone)
    try:
        tag = normalize_tag(tag) if tag else None
    except ValueError as error:
        raise HTTPException(422, str(error))
    now = utcnow()
    today = now.astimezone(zone).date().isoformat()
    with connection() as db:
        sessions = [dict(r) for r in db.execute("SELECT * FROM sessions ORDER BY started_at")]
        totals = daily_totals(sessions, zone, now)
        dates = {r["date"] for r in db.execute("SELECT date FROM days")}
        dates.update(totals)
        dates.add(today)
        note_ids = matching_ids(db, "notes", tag) if tag else None
        task_ids = set(matching_ids(db, "tasks", tag)) if tag else None
        if note_ids is not None:
            dates = {r["date"] for r in db.execute("SELECT DISTINCT days.date FROM days JOIN notes ON notes.day_id = days.id WHERE notes.id = ANY(%s)", (note_ids,))}
        if tag:
            dates.add(today)
        ordered = sorted((d for d in dates if (before is None or d < before.isoformat()) and (on is None or d == str(on))), reverse=True)
        selected = ordered[:limit]
        notes = {}
        if selected:
            placeholders = ",".join("%s" for _ in selected)
            for row in db.execute(f"SELECT notes.*, days.date FROM notes JOIN days ON notes.day_id = days.id WHERE days.date IN ({placeholders}) ORDER BY notes.position, notes.id", selected):
                if note_ids is None or row["id"] in note_ids:
                    notes.setdefault(row["date"], []).append(bullet_dict(row))
        days = [{"date": d, "notes": notes.get(d, []), **totals.get(d, EMPTY_TOTALS)} for d in selected]
        tasks = visible_tasks(db)
        if task_ids is not None:
            tasks = [task for task in tasks if task["id"] in task_ids]
        active = next((session_dict(s, now) for s in sessions if s["ended_at"] is None), None)
        return {"today": today, "content_format": "markdown", "tag": normalize_tag(tag) if tag else None, "tags": list_tags(db), "days": days, "tasks": tasks, "active_session": active,
                "server_time": stamp(now), "next_cursor": selected[-1] if len(ordered) > limit else None}


@app.get("/api/tags")
def tags():
    with connection() as db:
        return list_tags(db)


class DocumentChange(BaseModel):
    kind: Literal['notes', 'tasks']
    id: int | None = Field(default=None, ge=1)
    delete: bool = False
    content: str = Field(default='', max_length=10000)
    tags: list[str] | None = None
    date: CalendarDate | None = None
    parent_id: int | None = None
    after_id: int | None = None
    client_id: str | None = None
    move: bool = False


class DocumentBatch(BaseModel):
    changes: list[DocumentChange] = Field(min_length=1, max_length=1000)


@app.post('/api/document/edit')
def edit_document(body: DocumentBatch, timezone: str = "UTC"):
    now = stamp(utcnow())
    with connection(write=True) as db:
        before = snapshot(db)
        results = []
        for change in body.changes:
            table = change.kind
            item_id = change.id
            if item_id is None and change.client_id:
                existing = db.execute(f'SELECT id FROM {table} WHERE client_id = %s', (change.client_id,)).fetchone()
                item_id = existing['id'] if existing else None
            row = required(db, table, item_id) if item_id else None
            if table == 'tasks' and row and row['completed_at']:
                raise HTTPException(409, 'Reopen this completed task before editing it.')
            if change.delete:
                if row:
                    remove_preserving_children(db, table, item_id)
                results.append(None)
                continue
            if change.move and row:
                place(db, table, item_id, change.parent_id, change.after_id)
            else:
                try:
                    value = Content(content=change.content, tags=change.tags if change.tags is not None else (row or {}).get('tags', []))
                except ValueError as error:
                    raise HTTPException(422, str(error))
                encoded = value.tags or []
                if row:
                    if row['content'] != value.content or row['tags'] != (value.tags or []):
                        db.execute(f'UPDATE {table} SET content = %s, tags = %s WHERE id = %s', (value.content, Jsonb(encoded), item_id))
                        if table == 'notes':
                            db.execute('UPDATE notes SET updated_at = %s WHERE id = %s', (now, item_id))
                else:
                    if table == 'notes':
                        if not change.date:
                            raise HTTPException(422, 'A note needs a date.')
                        day_id = ensure_day(db, change.date, now)
                        validate_parent(db, table, change.parent_id, day_id)
                        cursor = db.execute('INSERT INTO notes(day_id, content, tags, created_at, updated_at, parent_id, client_id) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id', (day_id, value.content, Jsonb(encoded), now, now, change.parent_id, change.client_id))
                        item_id = cursor.fetchone()['id']
                    else:
                        validate_parent(db, table, change.parent_id)
                        cursor = db.execute('INSERT INTO tasks(content, tags, created_at, parent_id, client_id) VALUES (%s, %s, %s, %s, %s) RETURNING id', (value.content, Jsonb(encoded), now, change.parent_id, change.client_id))
                        item_id = cursor.fetchone()['id']
                    place(db, table, item_id, change.parent_id, change.after_id)
            results.append(required(db, table, item_id))
        parents = [before['tasks'][change.id]['parent_id'] for change in body.changes if change.kind == 'tasks' and change.id in before['tasks']]
        finished = finish_ready_parents(db, parents, get_zone(timezone), utcnow())
        return {'items': results, 'operation_id': record(db, before, now), 'completed_task_ids': finished}


class HistoryDirection(BaseModel):
    redo: bool = False


class HistoryBatch(HistoryDirection):
    operations: list[str] = Field(min_length=1, max_length=1000)


@app.post('/api/document/history')
def restore_document_batch(body: HistoryBatch):
    with connection(write=True) as db:
        for operation in body.operations:
            restore(db, operation, body.redo)
    return {'restored': True}


@app.post('/api/document/history/{operation_id}')
def restore_document(operation_id: str, body: HistoryDirection):
    with connection(write=True) as db:
        restore(db, operation_id, body.redo)
    return {'restored': True}


@app.get("/api/search")
def search(q: Annotated[str, Query(min_length=1, max_length=200)],
           offset: Annotated[int, Query(ge=0)] = 0, limit: Annotated[int, Query(ge=1, le=100)] = 40):
    terms = q.casefold().split()
    with connection() as db:
        rows = [{**bullet_dict(r), 'kind': 'notes'} for r in db.execute(
            'SELECT notes.*, days.date FROM notes JOIN days ON notes.day_id = days.id ORDER BY days.date DESC, notes.position, notes.id')]
        rows = [{**r, 'kind': 'tasks', 'date': None} for r in visible_tasks(db)] + rows
        matches = [r for r in rows if terms and all(term in (r['content'] + ' ' + ' '.join('#' + tag for tag in r['tags'])).casefold() for term in terms)]
        return {'results': matches[offset:offset + limit], 'next_offset': offset + limit if len(matches) > offset + limit else None}


@app.post("/api/notes", status_code=201)
def add_note(body: NewNote):
    now = stamp(utcnow())
    with connection(write=True) as db:
        if body.client_id:
            existing = db.execute("SELECT notes.*, days.date FROM notes JOIN days ON days.id = notes.day_id WHERE client_id = %s", (body.client_id,)).fetchone()
            if existing:
                tags = body.tags if body.tags is not None else existing["tags"]
                db.execute("UPDATE notes SET content = %s, tags = %s, updated_at = %s WHERE id = %s", (body.content, Jsonb(tags), now, existing["id"]))
                return {**bullet_dict(existing), "content": body.content, "tags": tags, "updated_at": now}
        day_id = ensure_day(db, body.date, now)
        validate_parent(db, "notes", body.parent_id, day_id)
        cursor = db.execute("INSERT INTO notes(day_id, content, created_at, updated_at, client_id, parent_id, tags) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                            (day_id, body.content, now, now, body.client_id, body.parent_id, Jsonb(body.tags or [])))
        item_id = cursor.fetchone()['id']
        place(db, "notes", item_id, body.parent_id, body.after_id)
        return {**required(db, "notes", item_id), "date": str(body.date)}


@app.patch("/api/notes/{note_id}")
def edit_note(note_id: int, body: Content):
    with connection(write=True) as db:
        note = required(db, "notes", note_id)
        tags = body.tags if body.tags is not None else note["tags"]
        db.execute("UPDATE notes SET content = %s, tags = %s, updated_at = %s WHERE id = %s", (body.content, Jsonb(tags), stamp(utcnow()), note_id))
        return required(db, "notes", note_id)


@app.delete("/api/notes/{note_id}", status_code=204)
def delete_note(note_id: int):
    with connection(write=True) as db:
        required(db, "notes", note_id)
        remove_preserving_children(db, "notes", note_id)


@app.patch("/api/notes/{note_id}/location")
def move_note(note_id: int, body: BulletLocation):
    with connection(write=True) as db:
        place(db, "notes", note_id, body.parent_id, body.after_id)
        db.execute("UPDATE notes SET updated_at = %s WHERE id = %s", (stamp(utcnow()), note_id))
        return required(db, "notes", note_id)


@app.post("/api/tasks", status_code=201)
def add_task(body: NewBullet):
    with connection(write=True) as db:
        if body.client_id:
            existing = db.execute("SELECT * FROM tasks WHERE client_id = %s", (body.client_id,)).fetchone()
            if existing:
                if existing["completed_at"]:
                    raise HTTPException(409, "That to-do has already been completed.")
                tags = body.tags if body.tags is not None else existing["tags"]
                db.execute("UPDATE tasks SET content = %s, tags = %s WHERE id = %s", (body.content, Jsonb(tags), existing["id"]))
                return {**bullet_dict(existing), "content": body.content, "tags": tags}
        validate_parent(db, "tasks", body.parent_id)
        cursor = db.execute("INSERT INTO tasks(content, created_at, parent_id, client_id, tags) VALUES (%s, %s, %s, %s, %s) RETURNING id",
                            (body.content, stamp(utcnow()), body.parent_id, body.client_id, Jsonb(body.tags or [])))
        item_id = cursor.fetchone()['id']
        place(db, "tasks", item_id, body.parent_id, body.after_id)
        return required(db, "tasks", item_id)


@app.patch("/api/tasks/{task_id}/location")
def move_task(task_id: int, body: BulletLocation, timezone: str = "UTC"):
    with connection(write=True) as db:
        task = required(db, "tasks", task_id)
        if task["completed_at"]:
            raise HTTPException(409, "Cannot move a completed to-do.")
        place(db, "tasks", task_id, body.parent_id, body.after_id)
        finish_ready_parents(db, [task["parent_id"]], get_zone(timezone), utcnow())
        return required(db, "tasks", task_id)


@app.patch("/api/tasks/{task_id}")
def edit_task(task_id: int, body: Content):
    with connection(write=True) as db:
        task = required(db, "tasks", task_id)
        if task["completed_at"]:
            raise HTTPException(409, "That task is already in your journal.")
        tags = body.tags if body.tags is not None else task["tags"]
        db.execute("UPDATE tasks SET content = %s, tags = %s WHERE id = %s", (body.content, Jsonb(tags), task_id))
        return required(db, "tasks", task_id)


def completed_content(content):
    # A block needs to begin on its own line to retain its Markdown meaning.
    block = re.match(r"^(?: {4}|\t| {0,3}(?:#{1,6}(?:\s|$)|>|`{3,}|~{3,}|[-+*]\s|\d+[.)]\s))", content)
    setext = re.match(r"^[^\n]+\n {0,3}(?:=+|-+)\s*(?:\n|$)", content)
    return "finished" + ("\n\n" if block or setext else " ") + content


def finish_task(db, task, now, day_id):
    completed_ids = []
    child = task
    while child and not child['completed_at']:
        position = next_position(db, "notes", None, day_id)
        cursor = db.execute("INSERT INTO notes(day_id, content, created_at, updated_at, source_task_id, parent_id, position) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                           (day_id, completed_content(child["content"]), stamp(now), stamp(now), child["id"], None, position))
        item_id = cursor.fetchone()['id']
        db.execute("UPDATE notes SET tags = %s WHERE id = %s", (Jsonb(child["tags"]), item_id))
        completed_ids.append(child['id'])
        db.execute("UPDATE tasks SET completed_at = %s WHERE id = %s", (stamp(now), child["id"]))
        parent = child['parent_id']
        if parent is None or db.execute('SELECT 1 FROM tasks WHERE parent_id = %s AND completed_at IS NULL', (parent,)).fetchone():
            break
        child = required(db, 'tasks', parent)
    return completed_ids


def finish_ready_parents(db, parents, zone, now):
    completed = []
    for parent in set(parents):
        if parent is None:
            continue
        row = db.execute('SELECT * FROM tasks WHERE id = %s', (parent,)).fetchone()
        children = db.execute('SELECT completed_at FROM tasks WHERE parent_id = %s', (parent,)).fetchall()
        if row and not row['completed_at'] and children and all(child['completed_at'] for child in children):
            day_id = ensure_day(db, now.astimezone(zone).date(), stamp(now))
            completed.extend(finish_task(db, bullet_dict(row), now, day_id))
    return completed


@app.post("/api/tasks/{task_id}/complete")
def complete_task(task_id: int, timezone: str = "UTC"):
    zone = get_zone(timezone)
    now = utcnow()
    with connection(write=True) as db:
        task = required(db, "tasks", task_id)
        if task["completed_at"]:
            return {"completed": True, "task_ids": [], "completed_at": task['completed_at']}
        if db.execute('SELECT 1 FROM tasks WHERE parent_id = %s AND completed_at IS NULL', (task_id,)).fetchone():
            raise HTTPException(409, 'Complete the children to finish this parent.')
        day_id = ensure_day(db, now.astimezone(zone).date(), stamp(now))
        completed_ids = finish_task(db, task, now, day_id)
        return {"completed": True, "task_ids": completed_ids, "completed_at": stamp(now)}


class ReopenTask(BaseModel):
    completed_at: str | None = None
    record_history: bool = False


@app.post('/api/tasks/{task_id}/reopen')
def reopen_task(task_id: int, body: ReopenTask):
    with connection(write=True) as db:
        before = snapshot(db) if body.record_history else None
        task = required(db, 'tasks', task_id)
        if not task['completed_at']:
            return {'reopened': []}
        if body.completed_at and task['completed_at'] != body.completed_at:
            raise HTTPException(409, 'This task has changed since that completion.')
        # Reopening a completed group also reopens its children. A leaf reopens
        # only itself and completed ancestors, retaining its completed siblings.
        reopen = [r['id'] for r, _ in descendants(db, 'tasks', task_id) if r['completed_at']]
        parent = task['parent_id']
        while parent is not None:
            ancestor = required(db, 'tasks', parent)
            if ancestor['completed_at']:
                reopen.append(parent)
            parent = ancestor['parent_id']
        for item_id in reopen:
            note = db.execute('SELECT * FROM notes WHERE source_task_id = %s', (item_id,)).fetchone()
            if note:
                # Preserve a journal entry the user has edited since completion.
                source = required(db, 'tasks', item_id)
                if note['updated_at'] != note['created_at'] or note['content'] != completed_content(source['content']) or note['tags'] != source['tags']:
                    db.execute('UPDATE notes SET source_task_id = NULL WHERE id = %s', (note['id'],))
                else:
                    remove_preserving_children(db, 'notes', note['id'])
            db.execute('UPDATE tasks SET completed_at = NULL WHERE id = %s', (item_id,))
        return {'reopened': reopen, 'operation_id': record(db, before, stamp(utcnow())) if before is not None else None}


@app.delete("/api/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, timezone: str = "UTC"):
    with connection(write=True) as db:
        task = required(db, "tasks", task_id)
        if task["completed_at"]:
            raise HTTPException(409, "Edit the completed note in your journal instead.")
        remove_preserving_children(db, "tasks", task_id)
        finish_ready_parents(db, [task["parent_id"]], get_zone(timezone), utcnow())


@app.get("/api/timer")
def timer():
    with connection() as db:
        row = db.execute("SELECT * FROM sessions WHERE ended_at IS NULL").fetchone()
        return {"active_session": session_dict(row) if row else None, "server_time": stamp(utcnow())}


@app.post("/api/timer/start")
def start_timer():
    with connection(write=True) as db:
        row = db.execute("SELECT * FROM sessions WHERE ended_at IS NULL").fetchone()
        if row:
            return session_dict(row)
        cursor = db.execute("INSERT INTO sessions(started_at) VALUES (%s) RETURNING id", (stamp(utcnow()),))
        item_id = cursor.fetchone()['id']
        return session_dict(required(db, "sessions", item_id))


@app.post("/api/timer/stop")
def stop_timer(body: StopTimer):
    with connection(write=True) as db:
        row = required(db, "sessions", body.session_id)
        if not row["ended_at"]:
            db.execute("UPDATE sessions SET ended_at = %s WHERE id = %s", (stamp(utcnow()), body.session_id))
        return session_dict(required(db, "sessions", body.session_id))


@app.get("/api/sessions")
def list_sessions(date: CalendarDate, timezone: str = "UTC"):
    zone = get_zone(timezone)
    now = utcnow()
    with connection() as db:
        result = []
        for row in db.execute("SELECT * FROM sessions ORDER BY started_at DESC"):
            parts = list(slices(row, zone, now))
            part = next((p for p in parts if p[0] == str(date)), None)
            if part:
                result.append({**session_dict(row, now), "seconds_on_day": part[1]})
        return result


def validate_session(db, body, exclude_id=None):
    start = body.started_at
    end = start + timedelta(seconds=body.duration_seconds)
    if end > utcnow() + timedelta(seconds=1):
        raise HTTPException(422, "A saved session cannot end in the future.")
    for row in db.execute("SELECT * FROM sessions"):
        if row["id"] == exclude_id:
            continue
        other_end = parse(row["ended_at"]) if row["ended_at"] else datetime.max.replace(tzinfo=dt_timezone.utc)
        if start < other_end and end > parse(row["started_at"]):
            raise HTTPException(409, "This overlaps another focus session. Adjust the start or duration.")
    return stamp(start), stamp(end)


@app.post("/api/sessions", status_code=201)
def create_session(body: SessionEdit):
    with connection(write=True) as db:
        start, end = validate_session(db, body)
        cursor = db.execute("INSERT INTO sessions(started_at, ended_at) VALUES (%s, %s) RETURNING id", (start, end))
        item_id = cursor.fetchone()['id']
        return session_dict(required(db, "sessions", item_id))


@app.patch("/api/sessions/{session_id}")
def edit_session(session_id: int, body: SessionEdit):
    with connection(write=True) as db:
        row = required(db, "sessions", session_id)
        if row["ended_at"] is None:
            raise HTTPException(409, "Stop this session before editing it.")
        start, end = validate_session(db, body, session_id)
        db.execute("UPDATE sessions SET started_at = %s, ended_at = %s WHERE id = %s", (start, end, session_id))
        return session_dict(required(db, "sessions", session_id))


@app.delete("/api/sessions/{session_id}", status_code=204)
def delete_session(session_id: int):
    with connection(write=True) as db:
        row = required(db, "sessions", session_id)
        if row["ended_at"] is None:
            raise HTTPException(409, "Stop this session before deleting it.")
        db.execute("DELETE FROM sessions WHERE id = %s", (session_id,))


def stats_data(start, end, timezone):
    zone = get_zone(timezone)
    now = utcnow()
    end = end or now.astimezone(zone).date()
    start = start or end - timedelta(days=6)
    count = (end - start).days + 1
    if not 1 <= count <= 3660:
        raise HTTPException(422, "Choose an ordered date range of at most 3,660 days.")
    with connection() as db:
        # Completed sessions only: statistics stay reproducible while a timer runs.
        sessions = [dict(r) for r in db.execute("SELECT * FROM sessions WHERE ended_at IS NOT NULL")]
        totals = daily_totals(sessions, zone, now)
        notes = {r["date"]: r["count"] for r in db.execute("SELECT days.date, COUNT(notes.id) AS count FROM days JOIN notes ON days.id = notes.day_id GROUP BY days.date")}
        completed = {}
        for row in db.execute("SELECT completed_at FROM tasks WHERE completed_at IS NOT NULL"):
            d = parse(row["completed_at"]).astimezone(zone).date().isoformat()
            completed[d] = completed.get(d, 0) + 1
    daily = []
    for i in range(count):
        d = (start + timedelta(days=i)).isoformat()
        daily.append({"date": d, **totals.get(d, EMPTY_TOTALS), "note_count": notes.get(d, 0), "completed_task_count": completed.get(d, 0)})
    active_days = sum(d["focused_seconds"] > 0 for d in daily)
    total = sum(d["focused_seconds"] for d in daily)
    longest_total = sum(d["longest_session_seconds"] for d in daily)
    session_count = sum(any(start.isoformat() <= p[0] <= end.isoformat() for p in slices(s, zone, now)) for s in sessions)
    return {"timezone": timezone, "start": str(start), "end": str(end), "day_count": count,
            "active_days": active_days, "total_focused_seconds": total, "session_count": session_count,
            "average_daily_focused_seconds": total / count,
            "average_daily_longest_session_seconds": longest_total / count,
            "average_active_day_focused_seconds": total / active_days if active_days else 0,
            "average_active_day_longest_session_seconds": longest_total / active_days if active_days else 0,
            "daily": daily, "includes_running_session": False}


@app.get("/api/stats")
def stats(start: CalendarDate | None = None, end: CalendarDate | None = None, timezone: str = "UTC"):
    return stats_data(start, end, timezone)


@app.get("/api/stats/daily")
def daily_stats(start: CalendarDate | None = None, end: CalendarDate | None = None, timezone: str = "UTC"):
    result = stats_data(start, end, timezone)
    return {key: result[key] for key in ("timezone", "start", "end", "daily", "includes_running_session")}


@app.get("/api/export")
def export():
    with connection() as db:
        return {"schema_version": SCHEMA_VERSION, "storage": "postgresql", "content_format": "markdown", "exported_at": stamp(utcnow()),
                **{table: [bullet_dict(r) for r in db.execute(f"SELECT * FROM {table} ORDER BY 1, 2")]
                   for table in ("days", "notes", "tasks", "sessions")}}


def agent_snapshot(query):
    zone = get_zone(query.timezone)
    now = utcnow()
    try:
        end = query.end or now.astimezone(zone).date()
        start = query.start or end - timedelta(days=29)
        if not 1 <= (end - start).days + 1 <= 3660:
            raise ValueError('Choose an ordered date range of at most 3,660 days.')
        query = query.model_copy(update={
            'start': start, 'end': end, 'tag': normalize_tag(query.tag) if query.tag else None,
            'q': query.q.strip() if query.q else None,
        })
        with connection() as db:
            return read_journal(db, query, zone, now)
    except (ValueError, OverflowError) as error:
        raise HTTPException(422, str(error))


class AgentJSONResponse(JSONResponse):
    def render(self, content):
        return json.dumps(content, ensure_ascii=False, allow_nan=False, indent=2).encode('utf-8')


class MarkdownResponse(PlainTextResponse):
    media_type = 'text/markdown'


@app.get('/api/agent/journal', response_model=AgentJournal, response_class=AgentJSONResponse, tags=['Agent reads'],
         summary='Read a queryable logbook snapshot, including collapsed descendants',
         description='Read-only, versioned JSON. All calendar days are included; q/tag filter bullets, never focus totals. '
                     'Times are UTC and durations are seconds. next_url preserves filters and omits repeated to-dos.')
def agent_journal(query: Annotated[AgentQuery, Query()], response: Response):
    response.headers.update(READ_HEADERS)
    return agent_snapshot(query)


@app.get('/journal.md', response_class=MarkdownResponse, tags=['Agent reads'], summary='Read the same query as Markdown, without JavaScript')
def agent_markdown(query: Annotated[AgentQuery, Query()]):
    return MarkdownResponse(markdown_journal(agent_snapshot(query)), headers=READ_HEADERS)


@app.get('/llms.txt', response_class=PlainTextResponse, tags=['Agent reads'], summary='Discover the logbook data contract and query examples')
def agent_guide():
    return PlainTextResponse(Path(__file__).with_name('agent-guide.md').read_text(), headers={'Link': DISCOVERY_LINKS})


dist = Path(os.environ.get('STILL_DIST_PATH', Path(__file__).resolve().parents[1] / 'dist'))
if dist.is_dir():
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
    app.mount("/fonts", StaticFiles(directory=dist / "fonts"), name="fonts")

    @app.get("/")
    def index(request: Request, query: Annotated[AgentQuery, Query()]):
        choices = []
        for index, part in enumerate(request.headers.get('accept', 'text/html').split(',')):
            media, *parameters = part.strip().lower().split(';')
            try:
                quality = next((float(p.strip()[2:]) for p in parameters if p.strip().startswith('q=')), 1)
            except ValueError:
                continue
            if quality > 0 and media in ('text/html', '*/*', 'application/json', 'text/markdown'):
                choices.append((quality, -index, media))
        preferred = max(choices)[2] if choices else 'text/html'
        headers = {**READ_HEADERS, 'Vary': 'Accept'}
        if preferred == 'text/markdown':
            return MarkdownResponse(markdown_journal(agent_snapshot(query)), headers=headers)
        if preferred == 'application/json':
            return AgentJSONResponse(agent_snapshot(query).model_dump(mode='json'), headers=headers)
        return FileResponse(dist / "index.html", headers=headers)

    @app.get("/favicon.svg")
    def favicon():
        return FileResponse(dist / "favicon.svg")
