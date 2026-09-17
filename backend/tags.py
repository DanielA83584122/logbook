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


def list_tags(db):
    return [dict(row) for row in db.execute('''SELECT name, SUM(note_count)::bigint AS note_count, SUM(task_count)::bigint AS task_count FROM (
        SELECT value AS name, COUNT(*) AS note_count, 0 AS task_count FROM notes, jsonb_array_elements_text(notes.tags) AS tag(value) GROUP BY value
        UNION ALL
        SELECT value AS name, 0 AS note_count, COUNT(*) AS task_count FROM tasks, jsonb_array_elements_text(tasks.tags) AS tag(value) WHERE completed_at IS NULL GROUP BY value
        ) GROUP BY name ORDER BY name''')]


def matching_ids(db, table, name):
    return [r['id'] for r in db.execute(f'''WITH RECURSIVE matching(id) AS (
        SELECT item.id FROM {table} item WHERE item.tags @> %s::jsonb
        UNION SELECT child.id FROM {table} child JOIN matching ON child.parent_id = matching.id
        ) SELECT id FROM matching''', (json.dumps([normalize_tag(name)]),))]
