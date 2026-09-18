"""Task visibility and logbook placement are derived from the normalized task tree."""
from collections import defaultdict

from .stats import parse
from .tags import bullet_dict


def visible_tasks(db):
    rows = [bullet_dict(r) for r in db.execute('SELECT * FROM tasks ORDER BY position, id')]
    children = {}
    for row in rows:
        children.setdefault(row['parent_id'], []).append(row)
    visible = []
    stack = list(reversed([r for r in children.get(None, []) if not r['completed_at']]))
    while stack:
        row = stack.pop()
        direct = children.get(row['id'], [])
        visible.append({**row, 'child_count': len(direct),
                        'completed_child_count': sum(bool(child['completed_at']) for child in direct)})
        if not row['completed_at']:
            stack.extend(reversed(direct))
    return visible


def completed_tasks_by_day(db, zone, tag=None):
    """Return completed *root* task trees keyed by the day their tree finished.

    A completed child remains part of the active to-do tree until its root task
    is complete. Once that happens, the whole tree is shown together in the
    logbook, while retaining task IDs and checkbox completion state.
    """
    rows = [bullet_dict(row) for row in db.execute('SELECT * FROM tasks ORDER BY position, id')]
    children = defaultdict(list)
    by_id = {row['id']: row for row in rows}
    for row in rows:
        children[row['parent_id']].append(row)

    included = None
    if tag:
        included = {row['id'] for row in rows if tag in row['tags']}
        stack = list(included)
        while stack:
            child = stack.pop()
            for descendant in children[child]:
                if descendant['id'] not in included:
                    included.add(descendant['id'])
                    stack.append(descendant['id'])
        for item_id in tuple(included):
            parent = by_id[item_id]['parent_id']
            while parent is not None and parent not in included:
                included.add(parent)
                parent = by_id[parent]['parent_id']

    grouped = defaultdict(list)
    for root in children[None]:
        if not root['completed_at'] or included is not None and root['id'] not in included:
            continue
        day = root['completed_at']
        # ISO 8601 timestamps sort with their date prefix, but conversion here
        # is necessary for the caller's requested timezone.
        local_day = parse(day).astimezone(zone).date().isoformat()
        stack = [root]
        while stack:
            task = stack.pop()
            if included is None or task['id'] in included:
                grouped[local_day].append(task)
            stack.extend(reversed(children[task['id']]))
    return grouped
