#!/usr/bin/env sh
set -e

if [ -n "$DB_HOST" ]; then
  echo "Attente de PostgreSQL/PostGIS sur ${DB_HOST}:${DB_PORT:-5432}..."
  until pg_isready -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" >/dev/null 2>&1; do
    sleep 1
  done
fi

if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  python manage.py setup_mapgeo_schema --move-public
  python manage.py migrate --noinput
fi

if [ "${SKIP_COLLECTSTATIC:-false}" != "true" ]; then
  python manage.py collectstatic --noinput
fi

exec "$@"