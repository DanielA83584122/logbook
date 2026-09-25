"""Tags are JSON arrays on bullets; Markdown content contains only the note text.

A section row is a root journal bullet whose Markdown is a level-1 heading
(`# title #tag`). Its tags apply to every root bullet after it on that date,
and to their descendants, until the next section row. A bullet also inherits
the tags of its ancestors. Inheritance is derived from order, never stored.
"""
import json
import re
import unicodedata
from collections import defaultdict

NAME = re.compile(r'[\w][\w-]{0,63}', re.UNICODE)
SECTION = re.compile(r'#(?:\s|$)')
EMPTY_HEADING = re.compile(r'#{1,6}')


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
            raise RuntimeError('Tag migration would break a bullet reference')
    db.execute('PRAGMA user_version = 5')


def is_section(row):
    """A root journal note whose Markdown starts as a level-1 heading."""
    return row['kind'] == 'note' and row['parent_id'] is None and row.get('day_id') is not None \
        and bool(SECTION.match(row['content'] or ''))


def empty_content(content):
    """Blank text, or a heading marker with nothing after it (an untitled section row)."""
    stripped = content.strip()
    return not stripped or bool(EMPTY_HEADING.fullmatch(stripped))


def inherited_tags(db):
    """Tags each entry carries without holding them itself: {id: [tag, ...]}.

    Day roots inherit the tags of the most recent section row above them; nested
    entries inherit their parent's own and inherited tags. Entries that inherit
    nothing are absent from the result.
    """
    rows = [bullet_dict(r) for r in db.execute(
        'SELECT id, kind, day_id, parent_id, position, content, tags FROM entries ORDER BY day_id, position, id')]
    children = defaultdict(list)
    roots = defaultdict(list)
    for row in rows:
        if row['parent_id'] is None:
            roots[row['day_id']].append(row)
        else:
            children[row['parent_id']].append(row)
    result = {}

    def spread(row, tags):
        inherited = [tag for tag in tags if tag not in row['tags']]
        if inherited:
            result[row['id']] = inherited
        passed = list(dict.fromkeys([*tags, *row['tags']]))
        for child in children[row['id']]:
            spread(child, passed)

    for day_id, day_roots in roots.items():
        current = []
        for root in day_roots:
            if day_id is not None and is_section(root):
                current = root['tags']
                for child in children[root['id']]:
                    spread(child, root['tags'])
                continue
            spread(root, current)
    return result


def list_tags(db, inherited=None):
    inherited = inherited_tags(db) if inherited is None else inherited
    counts = defaultdict(lambda: {'note_count': 0, 'task_count': 0})
    for row in db.execute('SELECT id, kind, tags FROM entries'):
        for name in {*json.loads(row['tags']), *inherited.get(row['id'], [])}:
            counts[name]['note_count' if row['kind'] == 'note' else 'task_count'] += 1
    return [{'name': name, **counts[name]} for name in sorted(counts)]


def matching_ids(db, table, name, inherited=None):
    """Entries of one kind that carry the tag themselves or inherit it from a section row or an ancestor."""
    kind = 'note' if table == 'notes' else 'task'
    name = normalize_tag(name)
    inherited = inherited_tags(db) if inherited is None else inherited
    return [row['id'] for row in db.execute('SELECT id, tags FROM entries WHERE kind = ? ORDER BY id', (kind,))
            if name in json.loads(row['tags']) or name in inherited.get(row['id'], [])]
