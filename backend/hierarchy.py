"""Ordered adjacency lists shared by journal bullets and to-dos."""
from fastapi import HTTPException

MAX_LEVELS = 8


def get_row(db, table, item_id):
    row = db.execute(f"SELECT * FROM {table} WHERE id = ?", (item_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Bullet not found.")
    return dict(row)


def siblings(db, table, parent_id, day_id=None):
    query = f"SELECT * FROM {table} WHERE parent_id IS ?"
    params = [parent_id]
    if table == "notes":
        query += " AND day_id = ?"
        params.append(day_id)
    return [dict(r) for r in db.execute(query + " ORDER BY position, id", params)]


def descendants(db, table, item_id):
    """Preorder traversal, including the root. No recursion-depth dependency."""
    rows = [dict(r) for r in db.execute(f"SELECT * FROM {table} ORDER BY position, id")]
    children = {}
    by_id = {r["id"]: r for r in rows}
    for row in rows:
        children.setdefault(row["parent_id"], []).append(row)
    stack = [(by_id[item_id], 0)]
    result = []
    while stack:
        row, depth = stack.pop()
        result.append((row, depth))
        stack.extend((child, depth + 1) for child in reversed(children.get(row["id"], [])))
    return result


def validate_parent(db, table, parent_id, day_id=None, item_id=None, allow_completed=False):
    level = 1
    seen = {item_id} if item_id is not None else set()
    cursor = parent_id
    while cursor is not None:
        if cursor in seen:
            raise HTTPException(409, "A bullet cannot be nested inside itself or its descendants.")
        seen.add(cursor)
        parent = get_row(db, table, cursor)
        if table == "notes" and parent["day_id"] != day_id:
            raise HTTPException(409, "Nested notes must belong to the same date.")
        if table == "tasks" and parent["completed_at"] and not allow_completed:
            raise HTTPException(409, "Cannot nest under a completed to-do.")
        level += 1
        cursor = parent["parent_id"]
    height = max((depth for _, depth in descendants(db, table, item_id)), default=0) if item_id else 0
    if level + height > MAX_LEVELS:
        raise HTTPException(422, f"Bullets support up to {MAX_LEVELS} levels.")


def place(db, table, item_id, parent_id, after_id=None, allow_completed_parent=False):
    row = get_row(db, table, item_id)
    day_id = row.get("day_id")
    validate_parent(db, table, parent_id, day_id, item_id, allow_completed_parent)
    group = [r for r in siblings(db, table, parent_id, day_id) if r["id"] != item_id]
    ids = [r["id"] for r in group]
    if after_id is not None and after_id not in ids:
        raise HTTPException(409, "The preceding bullet must be a sibling.")
    index = ids.index(after_id) + 1 if after_id is not None else len(ids)
    ids.insert(index, item_id)
    db.execute(f"UPDATE {table} SET parent_id = ? WHERE id = ?", (parent_id, item_id))
    for position, sibling_id in enumerate(ids):
        db.execute(f"UPDATE {table} SET position = ? WHERE id = ?", (position, sibling_id))
    if row["parent_id"] != parent_id:
        for position, sibling in enumerate(siblings(db, table, row["parent_id"], day_id)):
            db.execute(f"UPDATE {table} SET position = ? WHERE id = ?", (position, sibling["id"]))


def remove_preserving_children(db, table, item_id):
    row = get_row(db, table, item_id)
    group = siblings(db, table, row["parent_id"], row.get("day_id"))
    children = siblings(db, table, item_id, row.get("day_id"))
    ordered = []
    for sibling in group:
        ordered.extend(children if sibling["id"] == item_id else [sibling])
    for position, sibling in enumerate(ordered):
        db.execute(f"UPDATE {table} SET parent_id = ?, position = ? WHERE id = ?",
                   (row["parent_id"], position, sibling["id"]))
    db.execute(f"DELETE FROM {table} WHERE id = ?", (item_id,))


def next_position(db, table, parent_id, day_id=None):
    group = siblings(db, table, parent_id, day_id)
    return max((r["position"] for r in group), default=-1) + 1
