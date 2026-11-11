-- =============================================================================
-- 003 · Vistas y funciones de lectura para el dashboard.
--
-- security_invoker = true: la vista se evalúa con los permisos de QUIEN consulta
-- (anon), no del dueño (postgres). Sin esto, una vista en Supabase se salta RLS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Una fila por jugador y partido, con el contexto del partido y la persona.
-- Base para el detalle por jugador, la evolución y los filtros.
-- -----------------------------------------------------------------------------
create view public.v_player_match_stats
with (security_invoker = true)
as
select
  s.match_id,
  m.club_id,
  c.season,
  m.match_type,
  m.played_at,
  m.outcome,
  m.goals_for,
  m.goals_against,
  m.opponent_name,
  a.person_id,
  p.display_name as person_name,
  s.player_id,
  s.playername,
  s.position,
  s.archetype_id,
  s.rating,
  s.goals,
  s.assists,
  s.shots,
  s.pass_attempts,
  s.passes_made,
  s.tackle_attempts,
  s.tackles_made,
  s.is_mom,
  s.red_cards,
  s.saves,
  s.goals_conceded,
  s.clean_sheets_def,
  s.clean_sheets_gk,
  s.seconds_played
from public.player_match_stats s
join public.matches  m on m.match_id  = s.match_id
join public.clubs    c on c.club_id   = m.club_id
join public.accounts a on a.player_id = s.player_id
join public.persons  p on p.person_id = a.person_id;

-- -----------------------------------------------------------------------------
-- Totales y promedios por persona, con filtros opcionales (null = sin filtro).
-- Es una función y no una vista porque una vista no recibe parámetros, y el
-- dashboard necesita filtrar por tipo de partido y fechas ANTES de agregar.
--
-- Desde supabase-js:
--   supabase.rpc('person_stats', { p_match_types: ['leagueMatch','playoffMatch'],
--                                  p_from: '2026-10-01', p_to: '2027-01-01' })
-- p_to es exclusivo.
-- -----------------------------------------------------------------------------
create function public.person_stats(
  p_match_types text[]      default null,
  p_from        timestamptz default null,
  p_to          timestamptz default null,
  p_season      text        default null,
  p_club_id     bigint      default null
)
returns table (
  person_id           bigint,
  person_name         text,
  main_position       text,
  matches             bigint,
  wins                bigint,
  draws               bigint,
  losses              bigint,
  goals               bigint,
  assists             bigint,
  goal_contributions  bigint,
  shots               bigint,
  passes_made         bigint,
  pass_attempts       bigint,
  pass_accuracy_pct   numeric,
  tackles_made        bigint,
  tackle_attempts     bigint,
  tackle_success_pct  numeric,
  saves               bigint,
  goals_conceded      bigint,
  clean_sheets_def    bigint,
  clean_sheets_gk     bigint,
  mom_count           bigint,
  mom_pct             numeric,
  red_cards           bigint,
  avg_rating          numeric,
  seconds_played      bigint,
  goals_per_match     numeric,
  assists_per_match   numeric,
  ga_per_match        numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    v.person_id,
    v.person_name,
    mode() within group (order by v.position)                                   as main_position,
    count(distinct v.match_id)                                                  as matches,
    count(distinct v.match_id) filter (where v.outcome = 'win')                 as wins,
    count(distinct v.match_id) filter (where v.outcome = 'draw')                as draws,
    count(distinct v.match_id) filter (where v.outcome = 'loss')                as losses,
    sum(v.goals)                                                                as goals,
    sum(v.assists)                                                              as assists,
    sum(v.goals) + sum(v.assists)                                               as goal_contributions,
    sum(v.shots)                                                                as shots,
    sum(v.passes_made)                                                          as passes_made,
    sum(v.pass_attempts)                                                        as pass_attempts,
    round(100.0 * sum(v.passes_made)  / nullif(sum(v.pass_attempts), 0), 1)     as pass_accuracy_pct,
    sum(v.tackles_made)                                                         as tackles_made,
    sum(v.tackle_attempts)                                                      as tackle_attempts,
    round(100.0 * sum(v.tackles_made) / nullif(sum(v.tackle_attempts), 0), 1)   as tackle_success_pct,
    sum(v.saves)                                                                as saves,
    sum(v.goals_conceded)                                                       as goals_conceded,
    sum(v.clean_sheets_def)                                                     as clean_sheets_def,
    sum(v.clean_sheets_gk)                                                      as clean_sheets_gk,
    count(*) filter (where v.is_mom)                                            as mom_count,
    round(100.0 * count(*) filter (where v.is_mom) / count(distinct v.match_id), 1) as mom_pct,
    sum(v.red_cards)                                                            as red_cards,
    round(avg(v.rating), 2)                                                     as avg_rating,
    sum(v.seconds_played)                                                       as seconds_played,
    round(sum(v.goals)::numeric   / count(distinct v.match_id), 2)              as goals_per_match,
    round(sum(v.assists)::numeric / count(distinct v.match_id), 2)              as assists_per_match,
    round((sum(v.goals) + sum(v.assists))::numeric / count(distinct v.match_id), 2) as ga_per_match
  from public.v_player_match_stats v
  where (p_match_types is null or v.match_type = any (p_match_types))
    and (p_from        is null or v.played_at >= p_from)
    and (p_to          is null or v.played_at <  p_to)
    and (p_season      is null or v.season    =  p_season)
    and (p_club_id     is null or v.club_id   =  p_club_id)
  group by v.person_id, v.person_name
$$;

-- Atajo sin filtros (todos los tipos, todas las fechas).
create view public.v_person_totals
with (security_invoker = true)
as
select * from public.person_stats();

-- -----------------------------------------------------------------------------
-- Estado del colector para el aviso "última captura exitosa hace X".
-- Solo usa columnas que anon puede leer (ver migración 002).
-- -----------------------------------------------------------------------------
create view public.v_collector_status
with (security_invoker = true)
as
with last_ok as (
  select max(r.finished_at) as at
  from public.collector_runs r
  where r.status = 'success'
)
select
  (select at from last_ok)                                  as last_success_at,
  (select max(r.started_at) from public.collector_runs r)   as last_run_at,
  (select count(*)
     from public.collector_runs r
    where r.status = 'error'
      and r.started_at > coalesce((select at from last_ok), '-infinity'::timestamptz)
  )                                                         as consecutive_failures;

-- -----------------------------------------------------------------------------
-- Permisos: lectura para el dashboard, nada de escritura.
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger
  on public.v_player_match_stats, public.v_person_totals, public.v_collector_status
  from anon, authenticated;

grant select on public.v_player_match_stats,
                public.v_person_totals,
                public.v_collector_status
  to anon, authenticated;

grant execute on function public.person_stats(text[], timestamptz, timestamptz, text, bigint)
  to anon, authenticated;
