"""Safely copy one legacy Still SQLite file into an empty Neon database."""
import argparse
import json
import sqlite3
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb
from psycopg.rows import dict_row

from .db import SCHEMA_VERSION, database_url, initialize


TABLES = ('days', 'tasks', 'notes', 'sessions', 'document_operations', 'document_changes')


def rows(source, table):
    order = 'row_id, entity, phase' if table == 'document_changes' else 'id'
    return [dict(row) for row in source.execute(f'SELECT * FROM {table} ORDER BY {order}')]


def inspect(path):
    source = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    source.row_factory = sqlite3.Row
    try:
        available = {row['name'] for row in source.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        missing = set(TABLES) - available
        if missing:
            raise ValueError(f"Not a complete Still SQLite database; missing {', '.join(sorted(missing))}.")
        copied = {table: rows(source, table) for table in TABLES}
    finally:
        source.close()
    ids = {table: {row['id'] for row in copied[table]} for table in ('days', 'tasks', 'notes', 'sessions')}
    if any(row['day_id'] not in ids['days'] for row in copied['notes']):
        raise ValueError('SQLite file has a note that refers to a missing day.')
    if any(row['parent_id'] is not None and row['parent_id'] not in ids['tasks'] for row in copied['tasks']):
        raise ValueError('SQLite file has a task that refers to a missing parent.')
    if any(row['parent_id'] is not None and row['parent_id'] not in ids['notes'] for row in copied['notes']):
        raise ValueError('SQLite file has a note that refers to a missing parent.')
    for table in ('notes', 'tasks'):
        for row in copied[table]:
            try:
                tags = json.loads(row['tags'])
            except (KeyError, TypeError, json.JSONDecodeError) as error:
                raise ValueError(f"{table}:{row['id']} has invalid tag JSON.") from error
            if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
                raise ValueError(f"{table}:{row['id']} tags must be a list of strings.")
    return copied


def target_counts(connection):
    return {table: connection.execute(f'SELECT COUNT(*) AS count FROM {table}').fetchone()['count'] for table in TABLES}


def insert(connection, table, payload):
    if not payload:
        return
    columns = list(payload[0])
    values = ', '.join('%s' for _ in columns)
    query = f"INSERT INTO {table}({', '.join(columns)}) VALUES ({values})"
    for row in payload:
        data = dict(row)
        if table == 'document_operations':
            data['undone'] = bool(data['undone'])
        elif table == 'document_changes':
            data['present'] = bool(data['present'])
        connection.execute(query, [Jsonb(data[column]) if column == 'tags' and data[column] is not None else data[column] for column in columns])


def apply(copied, url):
    initialize(url)
    with psycopg.connect(url, row_factory=dict_row, prepare_threshold=None, application_name='still-sqlite-import') as target:
        target.execute('SELECT pg_advisory_xact_lock(%s)', (731746552,))
        counts = target_counts(target)
        if any(counts.values()):
            raise ValueError('Refusing to import: the Neon database already contains Still data. Use a fresh branch/database or restore from a backup.')
        target.execute('SET CONSTRAINTS ALL DEFERRED')
        for table in TABLES:
            payload = copied[table]
            if table in ('notes', 'tasks'):
                payload = [{**row, 'tags': json.loads(row['tags'])} for row in payload]
            insert(target, table, payload)
        for table in ('days', 'tasks', 'notes', 'sessions'):
            target.execute(f"""SELECT setval(pg_get_serial_sequence('{table}', 'id'),
                              COALESCE((SELECT MAX(id) FROM {table}), 1),
                              (SELECT COUNT(*) > 0 FROM {table}))""")
        after = target_counts(target)
        expected = {table: len(copied[table]) for table in TABLES}
        if after != expected:
            raise RuntimeError(f'Import verification failed: expected {expected}, received {after}.')
        return after


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sqlite', type=Path, default=Path('data/still.sqlite3'), help='Legacy SQLite file to read')
    parser.add_argument('--apply', action='store_true', help='Write only after a successful validation; target must be empty')
    args = parser.parse_args()
    if not args.sqlite.is_file():
        parser.error(f'No SQLite file at {args.sqlite}.')
    copied = inspect(args.sqlite)
    report = {table: len(copied[table]) for table in TABLES}
    print(json.dumps({'sqlite': str(args.sqlite), 'rows': report, 'will_write': args.apply}, indent=2))
    if args.apply:
        print(json.dumps({'imported': apply(copied, database_url(direct=True)), 'schema_version': SCHEMA_VERSION}, indent=2))


if __name__ == '__main__':
    main()
