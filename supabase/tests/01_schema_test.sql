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
-- Métricas calculadas (migración 006). Hecodes98: m1 1 gol en 5400 s (2-1), m2 0 goles en 5400 s (0-1).
select pg_temp.assert_eq('G por 90 min',
  (select goals_per90 from public.v_person_totals where person_name = 'Hecodes98'), 0.50::numeric);
select pg_temp.assert_eq('goles del equipo en sus partidos',
  (select team_goals from public.v_person_totals where person_name = 'Hecodes98'), 2::bigint);
select pg_temp.assert_eq('participación en goles (G+A / goles del equipo)',
  (select goal_participation_pct from public.v_person_totals where person_name = 'Hecodes98'), 100.0::numeric);
select pg_temp.assert_eq('diferencia de goles con él en cancha',
  (select goal_diff from public.v_person_totals where person_name = 'Hecodes98'), 0::bigint);
select pg_temp.assert_eq('presencia (partidos del club jugados)',
  (select attendance_pct from public.v_person_totals where person_name = 'Hecodes98'), 100.0::numeric);
select pg_temp.assert_eq('forma (calificación de los últimos 5)',
  (select form_rating from public.v_person_totals where person_name = 'Hecodes98'), 6.75::numeric);
select pg_temp.assert_eq('conversión de tiros (1 gol / 4 tiros)',
  (select shot_conversion_pct from public.v_person_totals where person_name = 'Hecodes98'), 25.0::numeric);
select pg_temp.assert_eq('filtro: presencia relativa a los partidos filtrados',
  (select club_matches from public.person_stats(p_match_types => array['leagueMatch']) where person_name = 'Hecodes98'), 1::bigint);

select pg_temp.assert_eq('estado del colector: fallas seguidas',
  (select consecutive_failures from public.v_collector_status), 2::bigint);
select pg_temp.assert_eq('estado del colector: hay última captura exitosa',
  (select last_success_at is not null from public.v_collector_status), true);

reset role;

-- =============================================================================
-- 4b. Datos experimentales (migración 005)
-- =============================================================================
select pg_temp.assert_eq('parse_event_aggregates suma por código',
  public.parse_event_aggregates('{"match_event_aggregate_0":"1:2,174:3","match_event_aggregate_1":"174:1","match_event_aggregate_2":""}'),
  '{"1": 2, "174": 4}'::jsonb);
select pg_temp.assert_eq('parse_event_aggregates sin cadenas -> {}',
  public.parse_event_aggregates('{}'), '{}'::jsonb);
select pg_temp.assert_eq('event_sum suma códigos y trata ausentes como 0',
  public.event_sum('{"105":2,"107":1}', array['105','106','107']), 3);
select pg_temp.assert_eq('event_sum sin contadores -> null',
  public.event_sum(null, array['174']), null::integer);

update public.player_match_stats set event_counts = '{"174": 5, "6": 2}'
 where match_id = 'm1' and player_id = '333';

set role anon;
select pg_temp.assert_eq('person_stats: regates experimentales (null de otro partido se ignora)',
  (select dribbles_exp from public.person_stats() t
     join public.accounts a on a.person_id = t.person_id where a.player_id = '333'), 5::bigint);
select pg_temp.assert_eq('vista por partido: intercepciones experimentales',
  (select interceptions_exp from public.v_player_match_stats where match_id = 'm1' and player_id = '333'), 2);
do $$ begin
  begin
    perform public.parse_event_aggregates('{}');
    raise exception 'FAIL: anon pudo ejecutar parse_event_aggregates';
  exception when insufficient_privilege then raise notice 'PASS anon no ejecuta parse_event_aggregates';
  end;
end $$;
reset role;

-- =============================================================================
-- 4c. Fotos de miembros y fuerza del rival (migración 006)
-- =============================================================================
set role service_role;
insert into public.member_snapshots (club_id, member_name, snapshot_date, captured_at, pro_overall, games_played, raw)
values (1330384, 'PinedaDS', '2026-11-01', '2026-11-01T00:00:00Z', 76, 40, '{"secreto":"x"}'),
       (1330384, 'PinedaDS', '2026-11-02', '2026-11-02T00:00:00Z', 77, 42, '{}');
update public.matches set opponent_skill_rating = 1600 where match_id = 'm1';
update public.matches set opponent_skill_rating = 1400 where match_id = 'm2';
reset role;

set role anon;
select pg_temp.assert_eq('miembro: última media del Pro',
  (select pro_overall from public.v_member_latest where member_name = 'PinedaDS'), 77::smallint);
select pg_temp.assert_eq('miembro: partidos que EA sumó desde la primera foto',
  (select ea_games_since_first from public.v_member_latest where member_name = 'PinedaDS'), 2);
select pg_temp.assert_eq('miembro: partidos capturados desde la primera foto (m1 y m2 son del 1-nov)',
  (select captured_since_first from public.v_member_latest where member_name = 'PinedaDS'), 2::bigint);
select pg_temp.assert_eq('miembro: enlazado con su persona por gamertag',
  (select person_id is not null from public.v_member_latest where member_name = 'PinedaDS'), true);
select pg_temp.assert_eq('fuerza media de los rivales',
  (select avg_opponent_skill from public.person_stats() t
     join public.accounts a on a.person_id = t.person_id where a.player_id = '333'), 1500::numeric);
do $$ begin
  begin
    perform raw from public.member_snapshots;
    raise exception 'FAIL: anon pudo leer member_snapshots.raw';
  exception when insufficient_privilege then raise notice 'PASS anon no lee member_snapshots.raw';
  end;
  begin
    insert into public.member_snapshots (club_id, member_name, snapshot_date, raw) values (1330384, 'x', current_date, '{}');
    raise exception 'FAIL: anon pudo insertar fotos de miembros';
  exception when insufficient_privilege then raise notice 'PASS anon no inserta fotos de miembros';
  end;
end $$;
reset role;

-- =============================================================================
-- 4c2. Rendimiento relativo al rol (migración 008).
--      Para tener un rol compartido, PinedaDS juega de delantero en m2:
--      delanteros = Hecodes m1 (7,5; 1 gol), Hecodes m2 (6,0; 1 asist.), Pineda m2 (6,5; 0)
--      promedio de calificación de delanteros = 6,667; G+A/90 de delanteros = 2·5400/16200 = 0,667
-- =============================================================================
update public.player_match_stats set position = 'forward' where match_id = 'm2' and player_id = '333';
set role anon;
select pg_temp.assert_eq('relativo: Pineda como delantero (6,5 / 6,667)',
  (select rating_idx from public.relative_stats_detail('position') where person_name <> 'Hecodes98' and group_key = 'forward'), 97.5::numeric);
-- 6,75 / 6,6666… = 1,01249… (la media periódica queda apenas por encima de 20/3) -> 101,2
select pg_temp.assert_eq('relativo: Hecodes como delantero (6,75 / 6,667)',
  (select rating_idx from public.relative_stats_detail('position') where person_name = 'Hecodes98' and group_key = 'forward'), 101.2::numeric);
select pg_temp.assert_eq('relativo: Pineda solo en su rol de medio = 100',
  (select rating_idx from public.relative_stats_detail('position') where person_name <> 'Hecodes98' and group_key = 'midfielder'), 100.0::numeric);
select pg_temp.assert_eq('relativo: índice final ponderado por minutos (97,5 y 100 con 5400 s cada uno)',
  (select rating_idx from public.relative_stats('position') t join public.accounts a on a.person_id = t.person_id where a.player_id = '333'), 98.8::numeric);
select pg_temp.assert_eq('relativo: G+A/90 de Hecodes vs delanteros (1,0 / 0,667)',
  (select ga90_idx from public.relative_stats_detail('position') where person_name = 'Hecodes98' and group_key = 'forward'), 150.0::numeric);
select pg_temp.assert_eq('relativo: roles jugados por Pineda',
  (select roles_played from public.relative_stats('position') t join public.accounts a on a.person_id = t.person_id where a.player_id = '333'), 2::bigint);
select pg_temp.assert_eq('relativo por arquetipo: devuelve filas',
  (select count(*) > 0 from public.relative_stats('archetype')), true);
reset role;
update public.player_match_stats set position = 'midfielder' where match_id = 'm2' and player_id = '333';

-- =============================================================================
-- 4d. Análisis (migración 007). Datos: m1 liga 2-1 (Hecodes 1 gol MVP, Pineda),
--     m2 amistoso 0-1 (Hecodes con su 2ª cuenta, Pineda). 2 jugadores por partido.
-- =============================================================================
set role service_role;
insert into public.club_snapshots (club_id, snapshot_date, skill_rating, current_division, season_points, raw)
values (1330384, '2026-11-02', 1595, 3, 47, '{"x":1}');
reset role;

set role anon;
select pg_temp.assert_eq('dupla: partidos juntos',
  (select matches from public.pair_stats()), 2::bigint);
select pg_temp.assert_eq('dupla: % victorias juntos',
  (select win_pct from public.pair_stats()), 50.0::numeric);
select pg_temp.assert_eq('dupla: diferencia de goles juntos',
  (select goal_diff from public.pair_stats()), 0::bigint);
select pg_temp.assert_eq('por posición: Hecodes98 como delantero',
  (select matches from public.position_stats() where person_name = 'Hecodes98' and player_position = 'forward'), 2::bigint);
select pg_temp.assert_eq('récords: más goles en un partido',
  (select max_goals_match from public.person_records() where person_name = 'Hecodes98'), 1::bigint);
select pg_temp.assert_eq('récords: racha goleadora',
  (select longest_scoring_streak from public.person_records() where person_name = 'Hecodes98'), 1::bigint);
select pg_temp.assert_eq('récords: invicto actual (el último partido fue derrota)',
  (select current_unbeaten_streak from public.person_records() where person_name = 'Hecodes98'), 0::bigint);
select pg_temp.assert_eq('comparar por tipo: liga',
  (select win_pct from public.person_split_stats('type') where person_name = 'Hecodes98' and bucket = 'Liga'), 100.0::numeric);
select pg_temp.assert_eq('comparar por tipo: amistoso',
  (select win_pct from public.person_split_stats('type') where person_name = 'Hecodes98' and bucket = 'Amistoso'), 0.0::numeric);
select pg_temp.assert_eq('comparar por tamaño del equipo',
  (select matches from public.person_split_stats('team_size') where person_name = 'Hecodes98' and bucket = '2 jugadores'), 2::bigint);
select pg_temp.assert_eq('comparar por rival: m1 (1600) fuerte, m2 (1400) débil',
  (select string_agg(bucket || '=' || matches, ',' order by bucket_order) from public.person_split_stats('rival') where person_name = 'Hecodes98'),
  'Rival fuerte=1,Rival débil=1'::text);
select pg_temp.assert_eq('foto del club: anon lee el nivel',
  (select skill_rating from public.club_snapshots), 1595);
do $$ begin
  begin
    perform raw from public.club_snapshots;
    raise exception 'FAIL: anon pudo leer club_snapshots.raw';
  exception when insufficient_privilege then raise notice 'PASS anon no lee club_snapshots.raw';
  end;
end $$;
reset role;

-- Partido incompleto: m2 con 3000 s de juego para todos (< 4860).
update public.player_match_stats set seconds_played = 3000 where match_id = 'm2';
set role anon;
select pg_temp.assert_eq('incompleto: se marca en la vista',
  (select bool_and(incomplete) from public.v_player_match_stats where match_id = 'm2'), true);
select pg_temp.assert_eq('incompleto: se puede excluir del ranking',
  (select matches from public.person_stats(p_exclude_incomplete => true) where person_name = 'Hecodes98'), 1::bigint);
select pg_temp.assert_eq('incompleto: se cuenta aparte',
  (select incomplete_matches from public.person_stats() where person_name = 'Hecodes98'), 1::bigint);
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
select pg_temp.assert_eq('purge: sin fotos de miembros', (select count(*) from public.member_snapshots), 0::bigint);
