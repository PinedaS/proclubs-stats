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
RESTORE_SQL="$(mktemp)"
INT_API_URL="http://127.0.0.1:$API_PORT" INT_JWT_SECRET="$JWT_SECRET" INT_RESTORE_SQL="$RESTORE_SQL" \
  node --test --test-reporter=spec --test-concurrency=1 test/integration/*.int.ts

echo "== Restauración del respaldo en una base vacía"
docker exec "$PG" psql -U postgres -q -c 'create database restore_test'
for f in "$ROOT"/supabase/migrations/*.sql; do
  docker exec -i "$PG" psql -U postgres -d restore_test -v ON_ERROR_STOP=1 -q -f "/supabase/migrations/$(basename "$f")"
done
docker exec -i "$PG" psql -U postgres -d restore_test -v ON_ERROR_STOP=1 -q < "$RESTORE_SQL"
COUNTS_SQL="select string_agg(t || '=' || n, ' ' order by t) from (
  select 'clubs' t, count(*) n from public.clubs union all select 'persons', count(*) from public.persons
  union all select 'accounts', count(*) from public.accounts union all select 'matches', count(*) from public.matches
  union all select 'match_raw', count(*) from public.match_raw union all select 'stats', count(*) from public.player_match_stats
  union all select 'runs', count(*) from public.collector_runs union all select 'members', count(*) from public.member_snapshots
  union all select 'person_stats_sum', sum(goals) from public.person_stats()) x"
ORIG="$(docker exec "$PG" psql -U postgres -tAc "$COUNTS_SQL")"
REST="$(docker exec "$PG" psql -U postgres -d restore_test -tAc "$COUNTS_SQL")"
echo "original:   $ORIG"
echo "restaurada: $REST"
[ "$ORIG" = "$REST" ] || { echo "FALLA: la restauración no coincide"; exit 1; }
# Tras restaurar, una persona nueva debe recibir un ID libre (secuencia movida).
docker exec "$PG" psql -U postgres -d restore_test -v ON_ERROR_STOP=1 -qc "insert into public.persons (display_name) values ('nuevo')"
echo "Restauración OK"

echo "== Coherencia del parser TypeScript vs SQL (match_event_aggregate)"
MISMATCHES="$(docker exec "$PG" psql -U postgres -tAc "
  select count(*) from public.player_match_stats s
  join public.match_raw r on r.match_id = s.match_id
  where s.event_counts is distinct from
        public.parse_event_aggregates(r.payload -> 'players' -> (r.club_id::text) -> s.player_id)")"
ROWS="$(docker exec "$PG" psql -U postgres -tAc "select count(*) from public.player_match_stats where event_counts is not null")"
echo "filas con contadores: $ROWS · diferencias TS vs SQL: $MISMATCHES"
[ "$MISMATCHES" = "0" ] && [ "$ROWS" -gt 0 ] || { echo "FALLA: los parsers no coinciden"; exit 1; }
