-- Pruebas del esquema. Se corren con ON_ERROR_STOP: el primer fallo detiene todo.
-- Cada prueba imprime "PASS ..." como NOTICE.

-- Helper: falla si a <> b.
create function pg_temp.assert_eq(label text, got anyelement, expected anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from expected then
    raise exception 'FAIL %: obtuve %, esperaba %', label, got, expected;
  end if;
  raise notice 'PASS %', label;
end $$;

-- =============================================================================
-- 1. Escrituras del colector (service_role) con upsert idempotente
-- =============================================================================
set role service_role;

insert into public.clubs (club_id, name, platform, season)
values (1330384, 'Aston Huila', 'common-gen5', 'FC27')
on conflict (club_id) do update set name = excluded.name;

insert into public.collector_runs (runner, club_id) values ('test', 1330384);

-- Se ejecuta dos veces para probar idempotencia.
\ir 02_collector_batch.sql
\ir 02_collector_batch.sql

select pg_temp.assert_eq('upsert no duplica partidos',       (select count(*) from public.matches), 2::bigint);
select pg_temp.assert_eq('upsert no duplica match_raw',      (select count(*) from public.match_raw), 2::bigint);
select pg_temp.assert_eq('upsert no duplica stats',          (select count(*) from public.player_match_stats), 4::bigint);
select pg_temp.assert_eq('upsert no duplica cuentas',        (select count(*) from public.accounts), 3::bigint);
select pg_temp.assert_eq('trigger no crea personas huérfanas', (select count(*) from public.persons), 3::bigint);
select pg_temp.assert_eq('upsert actualiza el nombre',
  (select last_known_name from public.accounts where player_id = '333'), 'PinedaDS'::text);

update public.collector_runs set status = 'success', finished_at = now(), matches_seen = 2, matches_new = 2;
insert into public.collector_runs (runner, status, finished_at) values ('test', 'error', now());
insert into public.collector_runs (runner, status, finished_at) values ('test', 'error', now());

reset role;

-- La CHECK de consistencia de collector_runs.
do $$ begin
  begin
    insert into public.collector_runs (runner, status) values ('test', 'success');
    raise exception 'FAIL: success sin finished_at fue aceptado';
  exception when check_violation then raise notice 'PASS check finished_at/status';
  end;
end $$;

-- =============================================================================
-- 2. Unir las dos cuentas de Hecodes98
-- =============================================================================
select public.merge_persons(
  (select person_id from public.accounts where player_id = '111'),
  (select person_id from public.accounts where player_id = '222'));

select pg_temp.assert_eq('merge deja 2 personas', (select count(*) from public.persons), 2::bigint);
select pg_temp.assert_eq('merge une las cuentas',
  (select count(distinct person_id) from public.accounts where player_id in ('111', '222')), 1::bigint);

-- =============================================================================
-- 3. El dashboard (anon) solo lee
-- =============================================================================
set role anon;

select pg_temp.assert_eq('anon lee matches',   (select count(*) from public.matches), 2::bigint);
select pg_temp.assert_eq('anon lee la vista de detalle', (select count(*) from public.v_player_match_stats), 4::bigint);

do $$ begin
  begin
    insert into public.matches (match_id, club_id, match_type, played_at, goals_for, goals_against)
    values ('x', 1330384, 'leagueMatch', now(), 0, 0);
    raise exception 'FAIL: anon pudo insertar en matches';
  exception when insufficient_privilege then raise notice 'PASS anon no inserta';
  end;
  begin
    update public.persons set display_name = 'hack';
    raise exception 'FAIL: anon pudo actualizar persons';
  exception when insufficient_privilege then raise notice 'PASS anon no actualiza';
  end;
  begin
    delete from public.player_match_stats;
    raise exception 'FAIL: anon pudo borrar stats';
  exception when insufficient_privilege then raise notice 'PASS anon no borra';
  end;
  begin
    perform 1 from public.match_raw;
    raise exception 'FAIL: anon pudo leer match_raw';
  exception when insufficient_privilege then raise notice 'PASS anon no lee match_raw';
  end;
  begin
    perform error_message from public.collector_runs;
    raise exception 'FAIL: anon pudo leer error_message';
  exception when insufficient_privilege then raise notice 'PASS anon no lee error_message';
  end;
  begin
    perform public.merge_persons(1, 2);
    raise exception 'FAIL: anon pudo ejecutar merge_persons';
  exception when insufficient_privilege then raise notice 'PASS anon no ejecuta merge_persons';
  end;
  begin
    perform public.purge_club(1330384);
    raise exception 'FAIL: anon pudo ejecutar purge_club';
  exception when insufficient_privilege then raise notice 'PASS anon no ejecuta purge_club';
  end;
end $$;

select pg_temp.assert_eq('anon lee columnas permitidas de collector_runs',
  (select count(*) from (select run_id, status, started_at from public.collector_runs) t), 3::bigint);

-- =============================================================================
-- 4. Estadísticas por persona (como anon, igual que el dashboard)
-- =============================================================================
select pg_temp.assert_eq('Hecodes98: partidos (2 cuentas, 1 persona)',
  (select matches from public.v_person_totals where person_name = 'Hecodes98'), 2::bigint);
select pg_temp.assert_eq('Hecodes98: goles',
  (select goals from public.v_person_totals where person_name = 'Hecodes98'), 1::bigint);
select pg_temp.assert_eq('Hecodes98: G+A',
  (select goal_contributions from public.v_person_totals where person_name = 'Hecodes98'), 2::bigint);
select pg_temp.assert_eq('Hecodes98: % MVP',
  (select mom_pct from public.v_person_totals where person_name = 'Hecodes98'), 50.0::numeric);
select pg_temp.assert_eq('Hecodes98: calificación media',
  (select avg_rating from public.v_person_totals where person_name = 'Hecodes98'), 6.75::numeric);
-- La persona de la cuenta 333 se creó con su nombre viejo; se busca por cuenta.
select pg_temp.assert_eq('PinedaDS: victorias/derrotas',
  (select wins || '-' || draws || '-' || losses from public.v_person_totals t
    join public.accounts a on a.person_id = t.person_id where a.player_id = '333'), '1-0-1'::text);
select pg_temp.assert_eq('PinedaDS: precisión de pase',
  (select pass_accuracy_pct from public.v_person_totals t
    join public.accounts a on a.person_id = t.person_id where a.player_id = '333'), 75.0::numeric);
select pg_temp.assert_eq('filtro por tipo: solo liga',
  (select matches from public.person_stats(p_match_types => array['leagueMatch']) where person_name = 'Hecodes98'), 1::bigint);
select pg_temp.assert_eq('filtro por fecha (p_to exclusivo)',
  (select count(*) from public.person_stats(p_to => '2026-11-02T00:00:00Z')), 2::bigint);
select pg_temp.assert_eq('filtro por fecha excluye todo',
  (select count(*) from public.person_stats(p_to => '2026-11-01T00:00:00Z')), 0::bigint);
select pg_temp.assert_eq('estado del colector: fallas seguidas',
  (select consecutive_failures from public.v_collector_status), 2::bigint);
select pg_temp.assert_eq('estado del colector: hay última captura exitosa',
  (select last_success_at is not null from public.v_collector_status), true);

reset role;

-- =============================================================================
-- 5. Borrar el club de prueba
-- =============================================================================
select public.purge_club(1330384);

select pg_temp.assert_eq('purge: sin partidos',  (select count(*) from public.matches), 0::bigint);
select pg_temp.assert_eq('purge: sin raw',       (select count(*) from public.match_raw), 0::bigint);
select pg_temp.assert_eq('purge: sin cuentas',   (select count(*) from public.accounts), 0::bigint);
select pg_temp.assert_eq('purge: sin personas',  (select count(*) from public.persons), 0::bigint);
select pg_temp.assert_eq('purge: runs conservados', (select count(*) from public.collector_runs), 3::bigint);
