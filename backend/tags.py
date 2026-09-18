"""Tags are JSON arrays on bullets; Markdown content contains only the note text."""
import json
import re
import unicodedata

NAME = re.compile(r'[\w][\w-]{0,63}', re.UNICODE)


def normalize_tag(value):
    name = unicodedata.normalize('NFKC', value.removeprefix('#')).lower()
    if not NAME.fullmatch(name):
        raise ValueError('Use up to 64 letters, numbers, underscores, or hyphens for a tag.')
    return name


def normalize_tags(values):
    return list(dict.fromkeys(normalize_tag(value) for value in values))


def bullet_dict(row):
    result = dict(row)
    if 'tags' in result and isinstance(result['tags'], str):
        result['tags'] = json.loads(result['tags'])
    return result


def initialize_tags(db):
    if db.execute('PRAGMA user_version').fetchone()[0] >= 5:
        return
    # Version 4's experimental index never changed user content. Replace it
    # with the requested per-bullet tag arrays, preserving existing text.
    for table in ('notes', 'tasks'):
        for suffix in ('insert', 'update', 'delete'):
            db.execute(f'DROP TRIGGER IF EXISTS {table}_tag_{suffix}')
    for table in ('note_tags', 'task_tags', 'tags', 'tag_index_queue'):
        db.execute(f'DROP TABLE IF EXISTS {table}')
    for table in ('notes', 'tasks'):
        if 'tags' not in {r['name'] for r in db.execute(f'PRAGMA table_info({table})')}:
            db.execute(f"ALTER TABLE {table} ADD COLUMN tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags) AND json_type(tags) = 'array')")
    # A bullet can consist only of tag chips. The API validates content OR tags.
    old_sql = {table: db.execute('SELECT sql FROM sqlite_master WHERE name = ?', (table,)).fetchone()[0] for table in ('tasks', 'notes')}
    if any('CHECK(length(trim(content)) > 0)' in sql for sql in old_sql.values()):
        db.commit()
        db.execute('PRAGMA foreign_keys = OFF')
        db.execute('BEGIN IMMEDIATE')
        definitions = [row[0] for row in db.execute("SELECT sql FROM sqlite_master WHERE tbl_name IN ('notes','tasks') AND type IN ('index','trigger') AND sql IS NOT NULL")]
        for table, sql in old_sql.items():
            temporary = f'{table}_with_tags'
            sql = re.sub(r'CREATE TABLE "?' + table + r'"?', 'CREATE TABLE ' + temporary, sql, count=1, flags=re.I)
            sql = sql.replace('CHECK(length(trim(content)) > 0)', '')
            db.execute(sql)
            db.execute(f'INSERT INTO {temporary} SELECT * FROM {table}')
            db.execute(f'DROP TABLE {table}')
            db.execute(f'ALTER TABLE {temporary} RENAME TO {table}')
        for sql in definitions:
            db.execute(sql)
        if db.execute('PRAGMA foreign_key_check').fetchall():
            db.rollback()
            raise RuntimeError('Tag migration would break a bullet reference')
        db.commit()
        db.execute('PRAGMA foreign_keys = ON')
    db.execute('PRAGMA user_version = 5')


def list_tags(db):
    return [dict(row) for row in db.execute('''SELECT name, SUM(note_count) AS note_count, SUM(task_count) AS task_count FROM (
        SELECT value AS name, COUNT(*) AS note_count, 0 AS task_count FROM notes, json_each(notes.tags) GROUP BY value
        UNION ALL
        SELECT value AS name, 0 AS note_count, COUNT(*) AS task_count FROM tasks, json_each(tasks.tags) GROUP BY value
        ) GROUP BY name ORDER BY name''')]


def matching_ids(db, table, name):
    active = ''
    return [r[0] for r in db.execute(f'''WITH RECURSIVE matching(id) AS (
        SELECT item.id FROM {table} item WHERE EXISTS(SELECT 1 FROM json_each(item.tags) WHERE value = ?)
        UNION SELECT child.id FROM {table} child JOIN matching ON child.parent_id = matching.id WHERE 1 {active}
        ) SELECT id FROM matching''', (normalize_tag(name),))]
