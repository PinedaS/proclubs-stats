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
-- Conciliación (migración 009): EA sumó 2 partidos (40 -> 42) y capturamos m1 y m2.
select pg_temp.assert_eq('conciliación: partidos que EA sumó',
  (select ea_games from public.v_reconciliation where member_name = 'PinedaDS'), 2);
select pg_temp.assert_eq('conciliación: partidos capturados en el mismo período',
  (select cap_games from public.v_reconciliation where member_name = 'PinedaDS'), 2::bigint);
select pg_temp.assert_eq('conciliación: todo cuadra',
  (select status from public.v_reconciliation where member_name = 'PinedaDS'), 'ok'::text);
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

-- Conciliación con un partido perdido: EA dice 45 partidos en la foto siguiente (+5),
-- pero solo capturamos 2. Además, un miembro sin ningún partido capturado no desaparece.
set role service_role;
insert into public.member_snapshots (club_id, member_name, snapshot_date, captured_at, games_played, raw)
values (1330384, 'PinedaDS', '2026-11-03', '2026-11-03T00:00:00Z', 45, '{}'),
       (1330384, 'SinPartidos', '2026-11-01', '2026-11-01T00:00:00Z', 3, '{}'),
       (1330384, 'SinPartidos', '2026-11-03', '2026-11-03T00:00:00Z', 4, '{}');
reset role;
set role anon;
select pg_temp.assert_eq('conciliación: detecta partidos perdidos',
  (select status || ' ' || diff_games from public.v_reconciliation where member_name = 'PinedaDS'), 'faltan -3'::text);
select pg_temp.assert_eq('conciliación: miembro sin partidos capturados sigue apareciendo',
  (select status || ' ' || cap_games from public.v_reconciliation where member_name = 'SinPartidos'), 'faltan 0'::text);
reset role;
delete from public.member_snapshots where snapshot_date = '2026-11-03' or member_name = 'SinPartidos';

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
update public.player_match_stats set seconds_played = 5400 where match_id = 'm2';

-- =============================================================================
-- 4e. Sugerencias del equipo (migración 011).
-- =============================================================================
-- División: los partidos son del 2026-11-01 y la única foto es del 2026-11-02 -> sin dato.
set role anon;
select pg_temp.assert_eq('división: sin foto previa -> sin dato',
  (select count(*) from public.v_player_match_stats where club_division is not null), 0::bigint);
select pg_temp.assert_eq('comparar por división: sin dato',
  (select bucket from public.person_split_stats('division') where person_name = 'Hecodes98'), 'Sin dato'::text);
reset role;
set role service_role;
insert into public.club_snapshots (club_id, snapshot_date, current_division, raw)
values (1330384, '2026-10-30', 5, '{"x":1}'), (1330384, '2026-11-01', 4, '{"x":1}');
reset role;
set role anon;
select pg_temp.assert_eq('división: foto del mismo día (no la anterior ni la siguiente)',
  (select string_agg(distinct club_division::text, ',') from public.v_player_match_stats), '4'::text);
select pg_temp.assert_eq('comparar por división: 2 partidos en 4ª',
  (select bucket || '=' || matches from public.person_split_stats('division') where person_name = 'Hecodes98'), 'División 4=2'::text);

-- Posición recomendada (011/012). Hecodes solo juega de delantero y Pineda solo de medio.
select pg_temp.assert_eq('posición: una fila por persona y posición',
  (select count(*) from public.position_fit()), 4::bigint);
select pg_temp.assert_eq('posición: Hecodes como delantero (2 PJ, índice 100)',
  (select matches || '/' || rating_idx from public.position_fit() where person_name = 'Hecodes98' and player_position = 'forward'), '2/100.0'::text);
select pg_temp.assert_eq('posición: sin calificación donde no jugó',
  (select rating from public.position_fit() where person_name = 'Hecodes98' and player_position = 'midfielder'), null::numeric);
select pg_temp.assert_eq('posición: no se compara consigo mismo (nadie más es delantero)',
  (select profile_match_pct from public.position_fit() where person_name = 'Hecodes98' and player_position = 'forward'), null::numeric);
select pg_temp.assert_eq('posición: con menos de 3 registros de los demás no hay afinidad',
  (select profile_match_pct from public.position_fit() where person_name = 'Hecodes98' and player_position = 'midfielder'), null::numeric);
select pg_temp.assert_eq('posición: registros de los demás en esa posición',
  (select others_matches from public.position_fit() where person_name = 'Hecodes98' and player_position = 'midfielder'), 2::bigint);
reset role;

-- Reparto del perfil: 3 partidos más con un defensa (444) que hace muchas entradas
-- y no tira. Su perfil se parece más al del medio (Pineda) que al del delantero.
begin;
insert into public.match_raw (match_id, club_id, match_type, payload) values
  ('m3', 1330384, 'friendlyMatch', '{}'), ('m4', 1330384, 'friendlyMatch', '{}'), ('m5', 1330384, 'friendlyMatch', '{}');
insert into public.matches (match_id, club_id, match_type, played_at, goals_for, goals_against, outcome) values
  ('m3', 1330384, 'friendlyMatch', '2026-11-03T20:00:00Z', 1, 0, 'win'),
  ('m4', 1330384, 'friendlyMatch', '2026-11-03T21:00:00Z', 1, 0, 'win'),
  ('m5', 1330384, 'friendlyMatch', '2026-11-03T22:00:00Z', 1, 0, 'win');
insert into public.accounts (player_id, last_known_name) values ('444', 'Defensor');
insert into public.player_match_stats (
  match_id, player_id, playername, position, archetype_id, rating,
  goals, assists, shots, pass_attempts, passes_made, tackle_attempts, tackles_made,
  is_mom, red_cards, saves, goals_conceded, clean_sheets_def, clean_sheets_gk, seconds_played, game_time)
select m, p.player_id, p.n, p.pos, 1, 7.0, p.g, p.a, p.sh, p.pa, p.pm, p.ta, p.tk, false, 0, 0, 0, 0, 0, 5400, 5400
from unnest(array['m3', 'm4', 'm5']) m
cross join (values ('111', 'Hecodes98', 'forward',    1, 0, 3, 10,  8, 2, 1),
                   ('333', 'PinedaDS',  'midfielder', 0, 1, 1, 20, 15, 4, 3),
                   ('444', 'Defensor',  'defender',   0, 0, 0, 12, 10, 6, 5)) p(player_id, n, pos, g, a, sh, pa, pm, ta, tk);
-- Sin contadores experimentales (las pruebas 4b se los pusieron solo a m1/m2).
update public.player_match_stats set event_counts = null;
set local role anon;
select pg_temp.assert_eq('reparto: el defensa se compara con 2 posiciones y suman 100',
  (select count(*) || '/' || sum(profile_match_pct) from public.position_fit() where person_name = 'Defensor' and profile_match_pct is not null), '2/100'::text);
select pg_temp.assert_eq('reparto: el defensa se parece más al medio que al delantero',
  (select bool_and(m.profile_match_pct > f.profile_match_pct)
     from public.position_fit() m join public.position_fit() f on f.person_id = m.person_id
    where m.person_name = 'Defensor' and m.player_position = 'midfielder' and f.player_position = 'forward'), true);
rollback;
set role anon;
reset role;

-- Con y sin: se quita a Pineda de m2 (dentro de una transacción que se deshace).
begin;
delete from public.player_match_stats where match_id = 'm2' and player_id = '333';
set local role anon;
select pg_temp.assert_eq('con y sin: Hecodes con Pineda 1 PJ, sin él 1 PJ',
  (select matches_with || '/' || matches_without from public.with_without_stats() where person_name = 'Hecodes98'), '1/1'::text);
select pg_temp.assert_eq('con y sin: diferencia de calificación (7,5 - 6,0)',
  (select rating_delta from public.with_without_stats() where person_name = 'Hecodes98'), 1.50::numeric);
select pg_temp.assert_eq('con y sin: diferencia de % victorias',
  (select win_pct_delta from public.with_without_stats() where person_name = 'Hecodes98'), 100.0::numeric);
select pg_temp.assert_eq('con y sin: Pineda nunca jugó sin Hecodes',
  (select matches_without || '/' || coalesce(rating_without::text, '-') from public.with_without_stats() where mate_name = 'Hecodes98'), '0/-'::text);
rollback;

-- =============================================================================
-- 4e2. Promedios tal cual EA (018 deshace la ponderación por minutos de 017).
--      Aunque m2 dure solo 30 min (1800 s), cada partido pesa igual:
--      PinedaDS: (8,00 + 6,50) / 2 = 7,25; Hecodes98: 1 MVP / 2 PJ = 50 %.
-- =============================================================================
begin;
update public.player_match_stats set seconds_played = 1800 where match_id = 'm2';
set local role anon;
select pg_temp.assert_eq('tal cual EA: calificación media de PinedaDS (sin ponderar)',
  (select avg_rating from public.person_stats() t join public.accounts a on a.person_id = t.person_id where a.player_id = '333'), 7.25::numeric);
select pg_temp.assert_eq('tal cual EA: % MVP de Hecodes98 (sin ponderar)',
  (select mom_pct from public.person_stats() where person_name = 'Hecodes98'), 50.0::numeric);
select pg_temp.assert_eq('tal cual EA: partidos jugados',
  (select matches from public.person_stats() where person_name = 'Hecodes98'), 2::bigint);
rollback;

-- =============================================================================
-- 4f. Mejoras (migración 014).
-- =============================================================================
-- La división anotada al capturar tiene prioridad sobre la foto diaria (4ª).
set role service_role;
update public.matches set club_division = 2 where match_id = 'm1';
reset role;
set role anon;
select pg_temp.assert_eq('división: la anotada al capturar gana a la foto diaria',
  (select string_agg(distinct match_id || '=' || club_division, ',' order by match_id || '=' || club_division) from public.v_player_match_stats), 'm1=2,m2=4'::text);
select pg_temp.assert_eq('división: anon lee la columna en matches',
  (select club_division from public.matches where match_id = 'm1'), 2::smallint);
-- Sin pg_net ni vault (Docker) la función responde "no disponible" en vez de fallar.
select pg_temp.assert_eq('disparo: anon NO puede ejecutar dispatch_collector (tras 015 sigue revocado)',
  has_function_privilege('anon', 'public.dispatch_collector()', 'execute'), false);
select pg_temp.assert_eq('estado del disparo: anon lo consulta sin error',
  (select available::text || '/' || token_configured::text from public.dispatch_status()), 'false/false'::text);
reset role;
do $$ begin
  begin
    update public.matches set club_division = 0 where match_id = 'm1';
    raise exception 'FAIL: división 0 aceptada';
  exception when check_violation then raise notice 'PASS división fuera de rango rechazada';
  end;
end $$;
update public.matches set club_division = null;

-- =============================================================================
-- 4g. 019: fotos crudas de EA (ea_snapshots) y división del rival
-- =============================================================================
insert into public.ea_snapshots (for_club_id, club_id, endpoint, snapshot_date, is_opponent, payload) values
  (1330384, 1330384, 'clubs/info', '2026-11-10', false, '{"name":"x"}'),
  (1330384, 999001, 'clubs/overallStats', '2026-11-10', true, '{"skillRating":"1500"}');
insert into public.ea_snapshots (for_club_id, club_id, endpoint, snapshot_date, is_opponent, payload) values
  (1330384, 1330384, 'clubs/info', '2026-11-10', false, '{"name":"y"}')
  on conflict (for_club_id, club_id, endpoint, snapshot_date) do update set payload = excluded.payload;
select pg_temp.assert_eq('ea_snapshots: una fila por club, endpoint y día', (select count(*) from public.ea_snapshots), 2::bigint);
do $$
begin
  begin
    insert into public.ea_snapshots (for_club_id, club_id, endpoint, snapshot_date, payload) values (1330384, 1, 'otro/endpoint', '2026-11-10', '{}');
    raise exception 'FAIL: endpoint desconocido aceptado';
  exception when check_violation then raise notice 'PASS endpoint desconocido rechazado';
  end;
  begin
    update public.matches set opponent_division = 0;
    raise exception 'FAIL: división del rival 0 aceptada';
  exception when check_violation then raise notice 'PASS división del rival fuera de rango rechazada';
  end;
end $$;
update public.matches set opponent_division = 6 where match_id = (select min(match_id) from public.matches);
set role anon;
select pg_temp.assert_eq('anon lee la división del rival', (select count(*) from public.matches where opponent_division = 6), 1::bigint);
do $$
begin
  perform 1 from public.ea_snapshots;
  raise exception 'FAIL: anon pudo leer ea_snapshots';
exception when insufficient_privilege then raise notice 'PASS anon no lee ea_snapshots';
end $$;
reset role;

-- =============================================================================
-- 4h. 020: temporadas, escudo y contadores nuevos
-- =============================================================================
insert into public.club_seasons (club_id, season_no, started_at, ended_at, detected_by) values
  (1330384, 1, '2026-10-22T07:00Z', '2026-12-03T07:00Z', 'calendario del juego'),
  (1330384, 2, '2026-12-03T07:00Z', null, 'reinicio de EA');
do $$
begin
  begin
    insert into public.club_seasons (club_id, season_no, started_at, detected_by) values (1330384, 3, now(), 'reinicio de EA');
    raise exception 'FAIL: dos temporadas abiertas en el mismo club';
  exception when unique_violation then raise notice 'PASS una sola temporada abierta por club';
  end;
  begin
    insert into public.club_seasons (club_id, season_no, started_at, ended_at, detected_by) values (1330384, 9, '2026-12-05', '2026-12-01', 'reinicio de EA');
    raise exception 'FAIL: temporada que termina antes de empezar';
  exception when check_violation then raise notice 'PASS fin anterior al inicio rechazado';
  end;
end $$;
update public.clubs set team_id = 243, crest_asset_id = 99020510 where club_id = 1330384;
set role anon;
select pg_temp.assert_eq('anon lee las temporadas', (select count(*) from public.club_seasons), 2::bigint);
select pg_temp.assert_eq('anon lee el escudo', (select crest_asset_id from public.clubs where club_id = 1330384), 99020510::bigint);
select pg_temp.assert_eq('vista con contadores nuevos', (select count(*) from public.v_player_match_stats where (short_passes_ok_exp is null) <> (dribbles_exp is null) or (out_of_position_severe_exp is null) <> (dribbles_exp is null)), 0::bigint);
select pg_temp.assert_eq('vista con tipos de atajada', (select count(parry_saves) >= 0 from public.v_player_match_stats), true);
select pg_temp.assert_eq('022: vista con media del Pro por partido', (select count(pro_overall) >= 0 from public.v_player_match_stats), true);
select pg_temp.assert_eq('023: vista con humanos del rival', (select count(opponent_humans) >= 0 from public.v_player_match_stats), true);
select pg_temp.assert_eq('023: anon lee los humanos del rival', (select count(opponent_humans) >= 0 from public.matches), true);
select pg_temp.assert_eq('024: vista con contadores nuevos útiles', (select count(outside_goals_exp) + count(corner_assists_exp) + count(backward_passes_ok_exp) + count(aerial_won_def_exp) >= 0 from public.v_player_match_stats), true);
select pg_temp.assert_eq('024: vista con contadores solo guardados', (select count(fb_use_the_ball_exp) + count(penalties_taken_exp) + count(tackles_lost_exp) >= 0 from public.v_player_match_stats), true);
select pg_temp.assert_eq('024: los nuevos son null donde faltan los contadores, igual que los demás', (select count(*) from public.v_player_match_stats where (outside_goals_exp is null) <> (dribbles_exp is null)), 0::bigint);
do $$
begin
  insert into public.club_seasons (club_id, season_no, started_at, detected_by) values (1330384, 5, now(), 'reinicio de EA');
  raise exception 'FAIL: anon pudo escribir temporadas';
exception when insufficient_privilege then raise notice 'PASS anon no escribe temporadas';
end $$;
reset role;

-- 023: el relleno desde el JSON crudo cuenta los jugadores del rival (mismo UPDATE que la migración).
insert into public.match_raw (match_id, club_id, match_type, payload) values
  ('m23', 1330384, 'leagueMatch', '{"players": {"1330384": {"1": {}}, "777": {"a": {}, "b": {}, "c": {}}}}');
insert into public.matches (match_id, club_id, match_type, played_at, goals_for, goals_against, outcome, opponent_club_id) values
  ('m23', 1330384, 'leagueMatch', '2026-11-05T20:00:00Z', 1, 0, 'win', 777);
update public.matches m
   set opponent_humans = (select count(*)::smallint from jsonb_object_keys(r.payload -> 'players' -> m.opponent_club_id::text))
  from public.match_raw r
 where r.match_id = m.match_id and m.opponent_club_id is not null and m.opponent_humans is null
   and jsonb_typeof(r.payload -> 'players' -> m.opponent_club_id::text) = 'object';
select pg_temp.assert_eq('023: humanos del rival desde el JSON crudo', (select opponent_humans from public.matches where match_id = 'm23'), 3::smallint);
select pg_temp.assert_eq('023: sin JSON del rival queda en null', (select opponent_humans from public.matches where match_id = 'm3'), null::smallint);
do $$
begin
  update public.matches set opponent_humans = 12 where match_id = 'm23';
  raise exception 'FAIL: se aceptaron 12 humanos rivales';
exception when check_violation then raise notice 'PASS 023 rechaza más de 11 humanos';
end $$;

-- 025: vistas de datos de EA que antes no se mostraban (forma real de las respuestas de EA).
insert into public.ea_snapshots (for_club_id, club_id, endpoint, snapshot_date, is_opponent, payload) values
  (1330384, 1330384, 'members/career/stats', '2026-11-20', false, '{"members":[{"name":"Viejo","gamesPlayed":"1","goals":"0","assists":"0","ratingAve":"6.0","manOfTheMatch":"0","favoritePosition":"defender"}]}'),
  (1330384, 1330384, 'members/career/stats', '2026-11-22', false, '{"members":[{"name":"PinedaDS","gamesPlayed":"56","goals":"40","assists":"33","ratingAve":"7.7","manOfTheMatch":"12","favoritePosition":"forward"}],"positionCount":{}}'),
  (1330384, 1330384, 'club/playoffAchievements', '2026-11-22', false, '[{"seasonId":"5","bestDivision":"3"}]'),
  (1330384, 777, 'clubs/overallStats', '2026-11-05', true, '{"skillRating":"1442","gamesPlayed":"23","wins":"9","ties":"3","losses":"11","goals":"63","goalsAgainst":"67","promotions":"2","relegations":"0"}'),
  (1330384, 777, 'currentSeasonLeaderboard', '2026-11-05', true, '{"currentDivision":"5","points":"30","clubInfo":{"name":"Rival 777"}}');
update public.member_snapshots set raw = '{"nationality":{"label":"Colombia","isoCode":"CO"}}' where member_name = 'PinedaDS' and snapshot_date = '2026-11-02';
set role anon;
select pg_temp.assert_eq('025: carrera, solo la foto más reciente', (select count(*) from public.v_member_career where club_id = 1330384), 1::bigint);
select pg_temp.assert_eq('025: carrera, partidos de PinedaDS', (select games_played from public.v_member_career where member_name = 'PinedaDS'), 56);
select pg_temp.assert_eq('025: carrera, calificación', (select rating_avg from public.v_member_career where member_name = 'PinedaDS'), 7.7::numeric);
select pg_temp.assert_eq('025: play-off, un logro', (select entry ->> 'bestDivision' from public.v_playoff_achievements where club_id = 1330384), '3');
select pg_temp.assert_eq('025: rival, nivel', (select skill_rating from public.v_opponent_snapshots where opponent_club_id = 777), 1442);
select pg_temp.assert_eq('025: rival, división y nombre', (select current_division || ' ' || name from public.v_opponent_snapshots where opponent_club_id = 777), '5 Rival 777');
select pg_temp.assert_eq('025: perfil, nacionalidad', (select nationality from public.v_member_profile where member_name = 'PinedaDS'), 'Colombia');
do $$
begin
  perform 1 from public.ea_snapshots limit 1;
  raise exception 'FAIL: anon pudo leer ea_snapshots';
exception when insufficient_privilege then raise notice 'PASS 025 anon sigue sin leer ea_snapshots';
end $$;
do $$
begin
  perform raw from public.member_snapshots limit 1;
  raise exception 'FAIL: anon pudo leer member_snapshots.raw';
exception when insufficient_privilege then raise notice 'PASS 025 anon sigue sin leer el JSON crudo de miembros';
end $$;
reset role;

-- 026: humanos rivales sin identificar (forma real de players[<rival>] en el JSON de EA).
insert into public.match_raw (match_id, club_id, match_type, payload) values
  ('m26', 1330384, 'leagueMatch', '{"players": {"1330384": {"1": {"pos": "forward"}}, "888": {"9001": {"playername": "Tercero", "pos": "midfielder", "secondsPlayed": "5400", "goals": "1", "assists": "2", "shots": "3", "passesmade": "20", "passattempts": "25", "match_event_aggregate_0": "97:7,105:1,106:2", "match_event_aggregate_1": "182:4,152:3,112:2,115:1"}, "9002": {"playername": "Otro", "pos": "forward", "secondsPlayed": "2700", "goals": "0", "assists": "0", "shots": "1", "passesmade": "5", "passattempts": "8"}}}}');
insert into public.matches (match_id, club_id, match_type, played_at, goals_for, goals_against, outcome, opponent_club_id) values
  ('m26', 1330384, 'leagueMatch', '2026-11-06T20:00:00Z', 0, 1, 'loss', 888);
set role anon;
select pg_temp.assert_eq('026: dos humanos rivales', (select count(*) from public.v_opponent_player_stats where played_at = '2026-11-06T20:00:00Z'), 2::bigint);
select pg_temp.assert_eq('026: conducciones y pérdidas del medio rival', (select carries_exp || '/' || possession_lost_exp from public.v_opponent_player_stats where position = 'midfielder' and played_at = '2026-11-06T20:00:00Z'), '7/3');
select pg_temp.assert_eq('026: pase peor, filtrados, superados y 2ª asist.', (select should_have_passed_exp || '/' || through_passes_exp || '/' || beats_exp || '/' || second_assists_exp from public.v_opponent_player_stats where position = 'midfielder' and played_at = '2026-11-06T20:00:00Z'), '4/3/2/1');
select pg_temp.assert_eq('026: oficiales del medio rival', (select goals || '/' || assists || '/' || shots || '/' || passes_made || '/' || pass_attempts || '/' || seconds_played from public.v_opponent_player_stats where position = 'midfielder' and played_at = '2026-11-06T20:00:00Z'), '1/2/3/20/25/5400');
select pg_temp.assert_eq('026: sin contadores queda en null, no en 0', (select carries_exp from public.v_opponent_player_stats where position = 'forward' and played_at = '2026-11-06T20:00:00Z'), null::integer);
reset role;
-- 027: más datos del mismo rival (agregados a m26 con la forma real de EA).
update public.match_raw set payload = jsonb_set(payload, '{players,888,9001}', (payload #> '{players,888,9001}') || '{"rating": "7.80", "tacklesmade": "4", "tackleattempts": "6", "saves": "0", "goalsconceded": "1", "cleansheetsgk": "0", "redcards": "0", "mom": "1", "match_event_aggregate_2": "6:5,108:2,109:1,265:1,266:2,13:2,19:1,30:9,31:3,177:6,158:2"}'::jsonb)
 where match_id = 'm26';
set role anon;
select pg_temp.assert_eq('027: calificación y entradas del medio rival', (select rating || '/' || tackles_made || '/' || tackle_attempts from public.v_opponent_player_stats where position = 'midfielder' and played_at = '2026-11-06T20:00:00Z'), '7.80/4/6');
select pg_temp.assert_eq('027: MVP del rival', (select is_mom from public.v_opponent_player_stats where position = 'midfielder' and played_at = '2026-11-06T20:00:00Z'), true);
select pg_temp.assert_eq('027: intercep., recuperaciones y aéreos', (select interceptions_exp || '/' || possession_won_exp || '/' || aerial_duels_won_exp || '/' || aerial_won_att_exp || '/' || aerial_won_def_exp from public.v_opponent_player_stats where position = 'midfielder' and played_at = '2026-11-06T20:00:00Z'), '5/3/3/1/2');
select pg_temp.assert_eq('027: tiros por zona, pase adelante, mejor opción y quitados', (select box_shots_on_exp || '/' || outside_shots_off_exp || '/' || forward_passes_ok_exp || '/' || forward_passes_failed_exp || '/' || best_option_exp || '/' || dispossessed_exp from public.v_opponent_player_stats where position = 'midfielder' and played_at = '2026-11-06T20:00:00Z'), '2/1/9/3/6/2');
select pg_temp.assert_eq('027: los contadores de la 026 siguen iguales', (select carries_exp || '/' || possession_lost_exp || '/' || should_have_passed_exp from public.v_opponent_player_stats where position = 'midfielder' and played_at = '2026-11-06T20:00:00Z'), '7/3/4');
reset role;
select pg_temp.assert_eq('026: la vista no expone nombres, cuentas ni el club rival',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'v_opponent_player_stats'
     and column_name in ('playername', 'player_id', 'person_id', 'person_name', 'opponent_club_id', 'opponent_name', 'match_id')), 0::bigint);
set role anon;
do $$
begin
  perform 1 from public.match_raw limit 1;
  raise exception 'FAIL: anon pudo leer match_raw';
exception when insufficient_privilege then raise notice 'PASS 026 anon sigue sin leer match_raw';
end $$;
reset role;

-- =============================================================================
-- 5. Borrar el club de prueba
-- =============================================================================
select public.purge_club(1330384);
select pg_temp.assert_eq('purge: sin temporadas', (select count(*) from public.club_seasons), 0::bigint);
select pg_temp.assert_eq('purge: sin fotos crudas de EA', (select count(*) from public.ea_snapshots), 0::bigint);

select pg_temp.assert_eq('purge: sin partidos',  (select count(*) from public.matches), 0::bigint);
select pg_temp.assert_eq('purge: sin raw',       (select count(*) from public.match_raw), 0::bigint);
select pg_temp.assert_eq('purge: sin cuentas',   (select count(*) from public.accounts), 0::bigint);
select pg_temp.assert_eq('purge: sin personas',  (select count(*) from public.persons), 0::bigint);
select pg_temp.assert_eq('purge: runs conservados', (select count(*) from public.collector_runs), 3::bigint);
select pg_temp.assert_eq('purge: sin fotos de miembros', (select count(*) from public.member_snapshots), 0::bigint);
