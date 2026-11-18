#!/usr/bin/env bash
# Start, stop or reset the throwaway PostgreSQL cluster used for local development.
# Requires the PostgreSQL server binaries (initdb, pg_ctl, createdb).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT/.devdata/pg"
LOG_FILE="$ROOT/.devdata/pg.log"
PORT="${COEDIT_PG_PORT:-55433}"
PGBIN="$(dirname "$(command -v initdb)")"

if [ ! -x "$PGBIN/initdb" ]; then
  if [ -d /usr/lib/postgresql ]; then
    PGBIN="/usr/lib/postgresql/$(ls /usr/lib/postgresql | sort -V | tail -1)/bin"
  fi
fi

start() {
  if [ ! -d "$DATA_DIR" ]; then
    echo "Initialising PostgreSQL cluster in $DATA_DIR"
    "$PGBIN/initdb" -D "$DATA_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
  fi
  if "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then
    echo "PostgreSQL already listening on 127.0.0.1:$PORT"
  else
    "$PGBIN/pg_ctl" -D "$DATA_DIR" -l "$LOG_FILE" \
      -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" start >/dev/null
    echo "PostgreSQL listening on 127.0.0.1:$PORT"
  fi
  "$PGBIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres coedit 2>/dev/null || true
  "$PGBIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres coedit_test 2>/dev/null || true
}

stop() {
  if [ -d "$DATA_DIR" ]; then
    "$PGBIN/pg_ctl" -D "$DATA_DIR" stop -m fast >/dev/null 2>&1 || true
    echo "PostgreSQL stopped"
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  reset)
    stop
    rm -rf "$DATA_DIR"
    start
    ;;
  *)
    echo "Usage: $0 {start|stop|reset}" >&2
    exit 1
    ;;
esac
