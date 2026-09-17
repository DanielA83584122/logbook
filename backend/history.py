"""Relational before/after images for undoable document edits.

Only changed entity rows are retained. Undo verifies the expected state before
restoring anything, so edits from another window are never silently overwritten.
"""
import uuid
from fastapi import HTTPException
from psycopg.types.json import Jsonb

FIELDS = ['content','tags','day_id','parent_id','position','created_at','updated_at','completed_at','source_task_id','client_id']


def snapshot(db):
    return {table: {r['id']: dict(r) for r in db.execute(f'SELECT * FROM {table}')} for table in ('tasks', 'notes')}


def record(db, before, now):
    after = snapshot(db)
    changes = [(table, row_id) for table in before for row_id in before[table].keys() | after[table].keys()
               if before[table].get(row_id) != after[table].get(row_id)]
    if not changes:
        return None
    operation = str(uuid.uuid4())
    db.execute('INSERT INTO document_operations(id, created_at) VALUES (%s, %s)', (operation, now))
    for table, row_id in changes:
        for phase, state in [('before', before), ('after', after)]:
            row = state[table].get(row_id)
            values = [operation, table, row_id, phase, row is not None] + [Jsonb(row[field]) if row and field == 'tags' else (row or {}).get(field) for field in FIELDS]
            db.execute(f"INSERT INTO document_changes(operation_id, entity, row_id, phase, present, {','.join(FIELDS)}) VALUES ({','.join('%s' for _ in values)})", values)
    return operation


def restore(db, operation, redo=False):
    event = db.execute('SELECT * FROM document_operations WHERE id = %s', (operation,)).fetchone()
    if not event:
        raise HTTPException(404, 'Edit history not found.')
    if bool(event['undone']) != redo:
        return  # retry after a lost response
    expected_phase, desired_phase = ('before', 'after') if redo else ('after', 'before')
    columns = {table: [r['name'] for r in db.execute('SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = %s ORDER BY ordinal_position', (table,))] for table in ('tasks','notes')}
    phases = {}
    for phase in (expected_phase, desired_phase):
        phases[phase] = {(r['entity'], r['row_id']): ({'id': r['row_id'], **{key: r[key] for key in columns[r['entity']] if key != 'id'}} if r['present'] else None)
                         for r in db.execute('SELECT * FROM document_changes WHERE operation_id = %s AND phase = %s', (operation, phase))}
    expected, desired = phases[expected_phase], phases[desired_phase]
    current = snapshot(db)
    for (table, row_id), row in expected.items():
        # Timestamps are audit metadata; a later inverse edit may change them.
        actual = current[table].get(row_id)
        comparable = lambda value: {k: v for k, v in value.items() if k != 'updated_at'} if value else None
        if comparable(actual) != comparable(row):
            raise HTTPException(409, 'This entry changed elsewhere. Undo would overwrite those changes.')
        if desired[(table, row_id)] is None:
            for child in current[table].values():
                if child['parent_id'] == row_id and (table, child['id']) not in desired:
                    raise HTTPException(409, 'New children were added to this entry. Undo would move them.')
    # Detach affected links before restoring parent rows, avoiding transient cycles.
    for table, row_id in desired:
        db.execute(f'UPDATE {table} SET parent_id = NULL WHERE id = %s', (row_id,))
    for table in ('notes', 'tasks'):
        for (entity, row_id), row in desired.items():
            if entity == table and row is None:
                db.execute(f'DELETE FROM {table} WHERE id = %s', (row_id,))
    for table in ('tasks', 'notes'):
        for (entity, _), row in desired.items():
            if entity != table or row is None:
                continue
            restored = {**row, 'parent_id': None}
            keys = columns[table]
            db.execute(f"INSERT INTO {table}({','.join(keys)}) VALUES ({','.join('%s' for _ in keys)}) ON CONFLICT(id) DO UPDATE SET {','.join(k+'=excluded.'+k for k in keys if k != 'id')}", [Jsonb(restored[k]) if k == 'tags' else restored[k] for k in keys])
    for (table, row_id), row in desired.items():
        if row is not None:
            db.execute(f'UPDATE {table} SET parent_id = %s WHERE id = %s', (row['parent_id'], row_id))
    db.execute('UPDATE document_operations SET undone = %s WHERE id = %s', (not redo, operation))
