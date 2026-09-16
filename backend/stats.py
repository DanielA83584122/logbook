"""Time-zone aware daily allocation. Durations are elapsed UTC seconds, including DST."""
from datetime import datetime, time, timedelta, timezone

UTC = timezone.utc


def stamp(value):
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def slices(session, zone, now):
    start = parse(session["started_at"])
    end = parse(session["ended_at"]) if session["ended_at"] else now
    cursor = start
    if end == start:
        yield start.astimezone(zone).date().isoformat(), 0, stamp(start), stamp(end)
    while cursor < end:
        day = cursor.astimezone(zone).date()
        midnight = datetime.combine(day + timedelta(days=1), time.min, zone).astimezone(UTC)
        stop = min(end, midnight)
        yield day.isoformat(), (stop - cursor).total_seconds(), stamp(cursor), stamp(stop)
        cursor = stop


def daily_totals(sessions, zone, now):
    result = {}
    for session in sessions:
        for day, seconds, start, end in slices(session, zone, now):
            entry = result.setdefault(day, {
                "focused_seconds": 0, "longest_session_seconds": 0,
                "session_count": 0, "first_started_at": None, "last_ended_at": None,
            })
            entry["focused_seconds"] += seconds
            entry["longest_session_seconds"] = max(entry["longest_session_seconds"], seconds)
            entry["session_count"] += 1
            entry["first_started_at"] = min(entry["first_started_at"] or start, start)
            entry["last_ended_at"] = max(entry["last_ended_at"] or end, end)
    return result


EMPTY_TOTALS = {
    "focused_seconds": 0, "longest_session_seconds": 0, "session_count": 0,
    "first_started_at": None, "last_ended_at": None,
}
