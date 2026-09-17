"""PostgreSQL storage for Neon. Runtime access never falls back to SQLite."""
import os
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
from threading import Lock

import psycopg
from dotenv import load_dotenv
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict
from psycopg_pool import ConnectionPool

from .stats import stamp

SCHEMA_VERSION = 7
WRITE_LOCK = 731746552
ROOT = Path(__file__).resolve().parents[1]
_pool = None
_pool_guard = Lock()


class Database:
    """Small DB-API facade that keeps qmark calls in focused test assertions usable."""
    def __init__(self, raw):
        self.raw = raw

    def execute(self, query, params=None):
        # Application SQL uses psycopg's native %s placeholders. This is only
        # compatibility for assertion-only test queries retained from SQLite.
        if params is not None and '?' in query:
            query = query.replace('?', '%s')
        return self.raw.execute(query, params)

    def __getattr__(self, name):
        return getattr(self.raw, name)


def database_url(*, direct=False):
    load_dotenv(ROOT / '.env', override=False)
    direct_value = os.environ.get('DATABASE_URL_DIRECT')
    value = direct_value if direct else os.environ.get('DATABASE_URL')
    if not value:
        variable = 'DATABASE_URL_DIRECT' if direct else 'DATABASE_URL'
        raise RuntimeError(f'Set {variable} in .env to your Neon PostgreSQL connection string.')
    try:
        info = conninfo_to_dict(value)
    except psycopg.ProgrammingError:
        raise RuntimeError('DATABASE_URL must be a valid PostgreSQL connection string.') from None
    if not info.get('dbname'):
        raise RuntimeError('DATABASE_URL must include a database name.')
    hosts = info.get('host', '').split(',')
    if any(host.endswith('.neon.tech') for host in hosts) and info.get('sslmode') not in ('require', 'verify-ca', 'verify-full'):
        raise RuntimeError('Neon connections require sslmode=require or stronger.')
    if direct and any('-pooler.' in host for host in hosts):
        raise RuntimeError("DATABASE_URL_DIRECT must use Neon’s non-pooled endpoint for migrations.")
    return value


def wire_row(cursor):
    """Keep the existing API's ISO date/time strings while storing native PG types."""
    names = [column.name for column in cursor.description] if cursor.description else []
    def row(values):
        return {name: stamp(value) if isinstance(value, datetime) else value.isoformat() if isinstance(value, date) else value
                for name, value in zip(names, values)}
    return row


def pool():
    global _pool
    with _pool_guard:
        if _pool is None:
            _pool = ConnectionPool(database_url(), min_size=0, max_size=5, timeout=30, max_idle=60,
                                   kwargs={'row_factory': wire_row, 'prepare_threshold': None, 'connect_timeout': 15,
                                           'application_name': 'still-logbook'}, open=False)
            _pool.open()
        return _pool


def close_pool():
    global _pool
    with _pool_guard:
        if _pool is not None:
            _pool.close()
            _pool = None


def reset_database(url):
    """Test helper: recreate only a deliberately named local PostgreSQL database."""
    info = conninfo_to_dict(url)
    if info.get('host', 'localhost') not in {'localhost', '127.0.0.1', '::1'} or not info.get('dbname', '').startswith('still_'):
        raise RuntimeError('Test database reset only permits local databases named still_*.')
    close_pool()
    with psycopg.connect(url, autocommit=True, prepare_threshold=None) as db:
        db.execute('DROP SCHEMA IF EXISTS public CASCADE')
        db.execute('CREATE SCHEMA public')


@contextmanager
def connection(*, write=False):
    with pool().connection() as db:
        with db.transaction():
            if write:
                # Serialize the personal journal's compound edits across workers.
                # Transaction-scoped locks work with Neon's transaction pooler.
                db.execute('SELECT pg_advisory_xact_lock(%s)', (WRITE_LOCK,))
            else:
                db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            yield Database(db)


def initialize(url=None):
    # No session state or session-scoped locks: every migration is one transaction.
    with psycopg.connect(url or database_url(direct=True), row_factory=wire_row, prepare_threshold=None,
                         connect_timeout=15, application_name='still-migrate') as db:
        db.execute('SELECT pg_advisory_xact_lock(%s)', (WRITE_LOCK,))
        db.execute('''CREATE TABLE IF NOT EXISTS schema_migrations (
                      version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())''')
        versions = {row['version'] for row in db.execute('SELECT version FROM schema_migrations')}
        if versions - {SCHEMA_VERSION}:
            raise RuntimeError('This database uses a schema version this application does not support.')
        if SCHEMA_VERSION not in versions:
            db.execute((Path(__file__).parent / 'migrations' / '007_postgres.sql').read_text())
            db.execute('INSERT INTO schema_migrations(version) VALUES (%s)', (SCHEMA_VERSION,))


def ensure_day(db, day, now):
    return db.execute('''INSERT INTO days(date, created_at) VALUES (%s, %s)
                        ON CONFLICT(date) DO UPDATE SET date = EXCLUDED.date RETURNING id''', (str(day), now)).fetchone()['id']
