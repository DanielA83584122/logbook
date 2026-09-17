"""Create and reset a local PostgreSQL test database. Never targets Neon."""
import os
import sys

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from .db import initialize, reset_database


def is_local(info):
    return info.get('host', 'localhost') in {'localhost', '127.0.0.1', '::1'}


def main():
    url = os.environ.get('POSTGRES_TEST_URL') or os.environ.get('STILL_E2E_DATABASE_URL')
    if not url:
        raise RuntimeError('Set POSTGRES_TEST_URL or STILL_E2E_DATABASE_URL to a local test database.')
    info = conninfo_to_dict(url)
    name = info.get('dbname', '')
    if not is_local(info) or not name.startswith('still_'):
        raise RuntimeError('Test reset only permits a local database whose name starts with still_.')
    admin_url = make_conninfo(url, dbname='postgres')
    with psycopg.connect(admin_url, autocommit=True, prepare_threshold=None) as admin:
        exists = admin.execute('SELECT 1 FROM pg_database WHERE datname = %s', (name,)).fetchone()
        if not exists:
            admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    reset_database(url)
    initialize(url)


if __name__ == '__main__':
    main()
