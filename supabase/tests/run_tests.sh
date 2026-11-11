#!/usr/bin/env bash
# Prueba las migraciones en un Postgres 17 desechable (Docker).
# Uso (desde WSL o Linux):  bash supabase/tests/run_tests.sh
set -euo pipefail

CONTAINER=pc-stats-pg-test
IMAGE=postgres:17   # misma versión mayor que usa Supabase
SUPABASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=localtest \
  -v "$SUPABASE_DIR":/supabase:ro \
  "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  # pg_isready puede responder durante el arranque temporal del entrypoint;
  # se confirma con una consulta real.
  if docker exec "$CONTAINER" psql -U postgres -tAc 'select 1' >/dev/null 2>&1; then break; fi
  sleep 1
done
sleep 2
docker exec "$CONTAINER" psql -U postgres -tAc 'select 1' >/dev/null

psql_run() {
  docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"
}

echo "== Roles de Supabase (simulados)"
psql_run -f /supabase/tests/00_supabase_roles.sql

for f in "$SUPABASE_DIR"/migrations/*.sql; do
  echo "== Migración $(basename "$f")"
  psql_run -f "/supabase/migrations/$(basename "$f")"
done

echo "== Pruebas"
# -o /dev/null oculta las filas vacías de assert_eq; los PASS salen como NOTICE.
# Los errores (FAIL o SQL) también se muestran, con su línea.
psql_run -o /dev/null -f /supabase/tests/01_schema_test.sql 2>&1 | sed -n -e 's/.*NOTICE:  //p' -e '/ERROR/p'
echo "TODAS LAS PRUEBAS PASARON"
