#!/usr/bin/env bash
# Prueba de integración: repositorio real (supabase-js) -> PostgREST -> Postgres 17,
# con las migraciones del repo. Todo en contenedores desechables.
# Uso (WSL/Linux con Docker):  bash collector/test/integration/run.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
NET=pcstats-int
PG=pcstats-int-pg
API=pcstats-int-api
API_PORT=54321
POSTGREST_IMAGE=postgrest/postgrest:v12.2.3
JWT_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
AUTH_PASS="$(node -e "console.log(require('node:crypto').randomBytes(16).toString('hex'))")"

cleanup() {
  docker rm -f "$API" "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" -e POSTGRES_PASSWORD=localtest \
  -v "$ROOT/supabase":/supabase:ro postgres:17 >/dev/null

for _ in $(seq 1 60); do
  docker exec "$PG" psql -U postgres -tAc 'select 1' >/dev/null 2>&1 && break
  sleep 1
done
sleep 2

psql_run() { docker exec -i "$PG" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

echo "== Esquema"
psql_run -f /supabase/tests/00_supabase_roles.sql
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql_run -f "/supabase/migrations/$(basename "$f")"
done
# Rol con el que PostgREST se conecta y desde el que cambia a anon/service_role (como en Supabase).
psql_run -c "create role authenticator noinherit login password '$AUTH_PASS';
             grant anon, authenticated, service_role to authenticator;"

echo "== PostgREST"
docker run -d --name "$API" --network "$NET" -p "127.0.0.1:$API_PORT:3000" \
  -e PGRST_DB_URI="postgres://authenticator:$AUTH_PASS@$PG:5432/postgres" \
  -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$JWT_SECRET" \
  "$POSTGREST_IMAGE" >/dev/null

for _ in $(seq 1 30); do
  node -e "fetch('http://127.0.0.1:$API_PORT/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" && break
  sleep 1
done

echo "== Pruebas de integración"
cd "$ROOT/collector"
INT_API_URL="http://127.0.0.1:$API_PORT" INT_JWT_SECRET="$JWT_SECRET" \
  node --test --test-reporter=spec test/integration/*.int.ts
