-- =============================================================================
-- 011 · Sugerencias del equipo (Campuzano, 2026-11-11):
--   1. Posición recomendada: rendimiento en cada posición jugada + afinidad del
--      perfil del jugador con el perfil típico de cada posición.
--   2. División: a qué división del club corresponde cada partido, para no
--      comparar 2 partidos en 6ª con 30 en 2ª.
--   3. "Química" con y sin: cómo rinde cada jugador cuando juega con otro
--      compañero frente a cuando no.
--
-- Ninguna es la fórmula de "mejor jugador" (pospuesta): solo muestran datos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. División del club en cada partido (columna nueva al final de la vista).
--    EA no la incluye en el partido. Se toma de la foto diaria club_snapshots:
--    la del mismo día (UTC) o la última anterior. Es una APROXIMACIÓN:
--      * la foto del día se pisa en cada ejecución, así que un partido jugado
--        el día de un ascenso puede quedar con la división nueva;
--      * los partidos anteriores a la primera foto quedan sin dato (null).
-- -----------------------------------------------------------------------------
create or replace view public.v_player_match_stats
with (security_invoker = true)
as
select
  s.match_id, m.club_id, c.season, m.match_type, m.played_at, m.outcome, m.goals_for, m.goals_against,
  m.opponent_name, a.person_id, p.display_name as person_name, s.player_id, s.playername, s.position,
  s.archetype_id, s.rating, s.goals, s.assists, s.shots, s.pass_attempts, s.passes_made, s.tackle_attempts,
  s.tackles_made, s.is_mom, s.red_cards, s.saves, s.goals_conceded, s.clean_sheets_def, s.clean_sheets_gk,
  s.seconds_played,
  public.event_sum(s.event_counts, array['174'])               as dribbles_exp,
  public.event_sum(s.event_counts, array['6'])                 as interceptions_exp,
  public.event_sum(s.event_counts, array['108', '109', '110']) as possession_won_exp,
  public.event_sum(s.event_counts, array['105', '106', '107']) as possession_lost_exp,
  public.event_sum(s.event_counts, array['265', '266'])        as aerial_duels_won_exp,
  public.event_sum(s.event_counts, array['2', '3'])            as fouls_exp,
  public.event_sum(s.event_counts, array['95', '213'])         as yellow_cards_exp,
  m.opponent_skill_rating,
  public.event_sum(s.event_counts, array['217'])               as shots_on_target_exp,
  public.event_sum(s.event_counts, array['218'])               as shots_off_target_exp,
  public.event_sum(s.event_counts, array['115'])               as second_assists_exp,
  count(*) over (partition by s.match_id)                      as team_size,
  (m.winner_by_dnf or max(s.seconds_played) over (partition by s.match_id) < 4860) as incomplete,
  s.platform,
  public.event_sum(s.event_counts, array['30'])                as forward_passes_ok_exp,
  public.event_sum(s.event_counts, array['31'])                as forward_passes_failed_exp,
  public.event_sum(s.event_counts, array['152'])               as through_passes_exp,
  public.event_sum(s.event_counts, array['111'])               as in_position_exp,
  public.event_sum(s.event_counts, array['219'])               as out_of_position_exp,
  public.event_sum(s.event_counts, array['177'])               as best_option_exp,
  public.event_sum(s.event_counts, array['182'])               as should_have_passed_exp,
  public.event_sum(s.event_counts, array['4'])                 as fouls_won_exp,
  public.event_sum(s.event_counts, array['104'])               as offsides_exp,
  public.event_sum(s.event_counts, array['94'])                as penalties_conceded_exp,
  public.event_sum(s.event_counts, array['36'])                as crosses_ok_exp,
  public.event_sum(s.event_counts, array['37'])                as crosses_failed_exp,
  -- 011
  (select cs.current_division
     from public.club_snapshots cs
    where cs.club_id = m.club_id
      and cs.snapshot_date <= (m.played_at at time zone 'UTC')::date
      and cs.current_division is not null
    order by cs.snapshot_date desc
    limit 1)                                                   as club_division
from public.player_match_stats s
join public.matches  m on m.match_id  = s.match_id
join public.clubs    c on c.club_id   = m.club_id
join public.accounts a on a.player_id = s.player_id
join public.persons  p on p.person_id = a.person_id;

-- -----------------------------------------------------------------------------
-- 2. Comparar: nuevo agrupamiento p_split = 'division' (misma firma).
-- -----------------------------------------------------------------------------
create or replace function public.person_split_stats(
  p_split              text,
  p_match_types        text[]      default null,
  p_from               timestamptz default null,
  p_to                 timestamptz default null,
  p_season             text        default null,
  p_club_id            bigint      default null,
  p_exclude_incomplete boolean     default false
)
returns table (
  person_id bigint, person_name text, bucket text, bucket_order integer, matches bigint,
  wins bigint, draws bigint, losses bigint, win_pct numeric, goals bigint, assists bigint,
  ga_per90 numeric, avg_rating numeric, mom_pct numeric, avg_opponent_skill numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select * from public.filtered_player_matches(p_match_types, p_from, p_to, p_season, p_club_id, p_exclude_incomplete)
  ),
  med as (
    select percentile_cont(0.5) within group (order by x.opp) as m
    from (select distinct b.match_id, b.opponent_skill_rating as opp from base b where b.opponent_skill_rating is not null) x
  ),
  tagged as (
    select b.*,
      case p_split
        when 'rival' then case when b.opponent_skill_rating is null then 'Sin dato'
                               when b.opponent_skill_rating >= (select m from med) then 'Rival fuerte'
                               else 'Rival débil' end
        when 'type' then case b.match_type when 'leagueMatch' then 'Liga' when 'playoffMatch' then 'Play-off' else 'Amistoso' end
        when 'team_size' then b.team_size || ' jugadores'
        when 'division' then case when b.club_division is null then 'Sin dato' else 'División ' || b.club_division end
      end as bucket,
      case p_split
        when 'rival' then case when b.opponent_skill_rating is null then 3
                               when b.opponent_skill_rating >= (select m from med) then 1 else 2 end
        when 'type' then case b.match_type when 'leagueMatch' then 1 when 'playoffMatch' then 2 else 3 end
        when 'team_size' then b.team_size::integer
        when 'division' then coalesce(b.club_division::integer, 99)  -- 1ª primero; "Sin dato" al final
      end as bucket_order
    from base b
  )
  select t.person_id, t.person_name, t.bucket, t.bucket_order,
         count(distinct t.match_id),
         count(distinct t.match_id) filter (where t.outcome = 'win'),
         count(distinct t.match_id) filter (where t.outcome = 'draw'),
         count(distinct t.match_id) filter (where t.outcome = 'loss'),
         round(100.0 * count(distinct t.match_id) filter (where t.outcome = 'win') / count(distinct t.match_id), 1),
         sum(t.goals), sum(t.assists),
         round((sum(t.goals) + sum(t.assists)) * 5400.0 / nullif(sum(t.seconds_played), 0), 2),
         round(avg(t.rating), 2),
         round(100.0 * count(*) filter (where t.is_mom) / count(distinct t.match_id), 1),
         round(avg(t.opponent_skill_rating), 0)
  from tagged t
  where t.bucket is not null
  group by t.person_id, t.person_name, t.bucket, t.bucket_order
$$;

-- -----------------------------------------------------------------------------
-- 3. Posición recomendada. Una fila por persona y posición (las 4 que existan
--    en los datos filtrados), juegue o no en ella:
--    * rating / rating_idx: su calificación en esa posición frente al promedio
--      del club en esa posición (100 = promedio; igual que relative_stats).
--      Solo si la jugó.
--    * profile_match_pct: qué tanto su perfil de juego (goles, asistencias,
--      tiros, pases, entradas, atajadas, intercepciones* y regates* por 90 min,
--      en TODOS sus partidos) se parece al perfil típico de los DEMÁS jugadores
--      en esa posición. Similitud coseno de los perfiles estandarizados,
--      llevada a 0–100 (50 = sin parecido; 100 = mismo patrón).
--      Se excluye a la propia persona del perfil de la posición, para que no
--      "se parezca a sí misma".
--    * others_matches: partidos-jugador de los demás en esa posición; con
--      pocos, el perfil de la posición no es confiable.
-- -----------------------------------------------------------------------------
create function public.position_fit(
  p_match_types        text[]      default null,
  p_from               timestamptz default null,
  p_to                 timestamptz default null,
  p_season             text        default null,
  p_club_id            bigint      default null,
  p_exclude_incomplete boolean     default false
)
returns table (
  person_id bigint, person_name text, player_position text, matches bigint, minutes numeric,
  rating numeric, rating_idx numeric, profile_match_pct numeric, others_matches bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select f.*
    from public.filtered_player_matches(p_match_types, p_from, p_to, p_season, p_club_id, p_exclude_incomplete) f
    where f.seconds_played > 0
  ),
  -- Totales por persona y posición.
  pp as (
    select b.person_id, max(b.person_name) as person_name, b.position,
           count(distinct b.match_id) as matches, count(*) as n_rows,
           sum(b.seconds_played)::numeric as sec,
           sum(b.rating) as rating_sum, count(b.rating) as rating_n,
           sum(b.goals) as g, sum(b.assists) as a, sum(b.shots) as sh, sum(b.passes_made) as pm,
           sum(b.tackles_made) as tk, sum(b.saves) as sv,
           sum(coalesce(b.interceptions_exp, 0)) as itc, sum(coalesce(b.dribbles_exp, 0)) as dr
    from base b
    group by b.person_id, b.position
  ),
  -- Formato largo: una fila por (persona, posición, rasgo).
  long as (
    select pp.person_id, pp.position, f.k, f.v::numeric as v, pp.sec
    from pp
    cross join lateral (values ('g', pp.g), ('a', pp.a), ('sh', pp.sh), ('pm', pp.pm),
                               ('tk', pp.tk), ('sv', pp.sv), ('itc', pp.itc), ('dr', pp.dr)) as f(k, v)
  ),
  pos_tot as (
    select l.position, l.k, sum(l.v) as v, sum(l.sec) as sec from long l group by l.position, l.k
  ),
  -- Escala de cada rasgo: centro y dispersión entre los perfiles de las posiciones.
  scale as (
    select pt.k, avg(pt.v * 5400 / pt.sec) as mu, stddev_pop(pt.v * 5400 / pt.sec) as sd
    from pos_tot pt where pt.sec > 0 group by pt.k
  ),
  person_prof as (
    select l.person_id, l.k, sum(l.v) * 5400 / nullif(sum(l.sec), 0) as x from long l group by l.person_id, l.k
  ),
  people as (select distinct pp.person_id from pp),
  -- Perfil de cada posición SIN la persona evaluada.
  others as (
    select pe.person_id, pt.position, pt.k,
           (pt.v - coalesce(l.v, 0)) * 5400 / nullif(pt.sec - coalesce(l.sec, 0), 0) as x
    from people pe
    cross join pos_tot pt
    left join long l on l.person_id = pe.person_id and l.position = pt.position and l.k = pt.k
  ),
  z as (
    select o.person_id, o.position,
           (o.x - s.mu) / nullif(s.sd, 0) as zo,
           (p.x - s.mu) / nullif(s.sd, 0) as zp
    from others o
    join scale s on s.k = o.k
    join person_prof p on p.person_id = o.person_id and p.k = o.k
  ),
  sim as (
    select z.person_id, z.position,
           sum(z.zo * z.zp) / nullif(sqrt(sum(z.zo * z.zo)) * sqrt(sum(z.zp * z.zp)), 0) as cos
    from z where z.zo is not null and z.zp is not null
    group by z.person_id, z.position
  ),
  pos_rows as (
    select pp.position, sum(pp.n_rows) as n_rows,
           sum(pp.rating_sum) / nullif(sum(pp.rating_n), 0) as rating
    from pp group by pp.position
  ),
  names as (select pp.person_id, max(pp.person_name) as person_name from pp group by pp.person_id)
  select pe.person_id, nm.person_name, pr.position,
         coalesce(mine.matches, 0),
         round(coalesce(mine.sec, 0) / 60.0, 0),
         round(mine.rating_sum / nullif(mine.rating_n, 0), 2),
         round(100 * (mine.rating_sum / nullif(mine.rating_n, 0)) / nullif(pr.rating, 0), 1),
         round(50 * (si.cos + 1), 0),
         (pr.n_rows - coalesce(mine.n_rows, 0))::bigint
  from people pe
  join names nm on nm.person_id = pe.person_id
  cross join pos_rows pr
  left join pp mine on mine.person_id = pe.person_id and mine.position = pr.position
  left join sim si on si.person_id = pe.person_id and si.position = pr.position
$$;

-- -----------------------------------------------------------------------------
-- 4. Con y sin: para cada persona A y cada compañero B, cómo le va a A en los
--    partidos con B frente a los partidos sin B. Es una CORRELACIÓN: no prueba
--    que B cause la diferencia (también influyen rival, posición, etc.).
-- -----------------------------------------------------------------------------
create function public.with_without_stats(
  p_match_types        text[]      default null,
  p_from               timestamptz default null,
  p_to                 timestamptz default null,
  p_season             text        default null,
  p_club_id            bigint      default null,
  p_exclude_incomplete boolean     default false
)
returns table (
  person_id bigint, person_name text, mate_id bigint, mate_name text,
  matches_with bigint, matches_without bigint,
  rating_with numeric, rating_without numeric, rating_delta numeric,
  win_pct_with numeric, win_pct_without numeric, win_pct_delta numeric,
  ga90_with numeric, ga90_without numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select * from public.filtered_player_matches(p_match_types, p_from, p_to, p_season, p_club_id, p_exclude_incomplete)
  ),
  pm as (
    select b.person_id, max(b.person_name) as person_name, b.match_id, max(b.outcome) as outcome,
           avg(b.rating) as rating, sum(b.goals + b.assists) as ga, sum(b.seconds_played) as sec
    from base b group by b.person_id, b.match_id
  ),
  names as (select pm.person_id, max(pm.person_name) as person_name from pm group by pm.person_id),
  tagged as (
    select x.*, m.person_id as mate_id,
           exists (select 1 from pm y where y.match_id = x.match_id and y.person_id = m.person_id) as with_mate
    from pm x
    join names m on m.person_id <> x.person_id
  ),
  agg as (
    select t.person_id, t.mate_id,
           count(*) filter (where t.with_mate) as n_with,
           count(*) filter (where not t.with_mate) as n_without,
           avg(t.rating) filter (where t.with_mate) as r_with,
           avg(t.rating) filter (where not t.with_mate) as r_without,
           100.0 * count(*) filter (where t.with_mate and t.outcome = 'win') / nullif(count(*) filter (where t.with_mate), 0) as w_with,
           100.0 * count(*) filter (where not t.with_mate and t.outcome = 'win') / nullif(count(*) filter (where not t.with_mate), 0) as w_without,
           sum(t.ga) filter (where t.with_mate) * 5400.0 / nullif(sum(t.sec) filter (where t.with_mate), 0) as ga_with,
           sum(t.ga) filter (where not t.with_mate) * 5400.0 / nullif(sum(t.sec) filter (where not t.with_mate), 0) as ga_without
    from tagged t
    group by t.person_id, t.mate_id
  )
  select a.person_id, p.person_name, a.mate_id, m.person_name,
         a.n_with, a.n_without,
         round(a.r_with, 2), round(a.r_without, 2), round(a.r_with - a.r_without, 2),
         round(a.w_with, 1), round(a.w_without, 1), round(a.w_with - a.w_without, 1),
         round(a.ga_with, 2), round(a.ga_without, 2)
  from agg a
  join names p on p.person_id = a.person_id
  join names m on m.person_id = a.mate_id
  where a.n_with > 0
$$;

grant execute on function public.position_fit(text[], timestamptz, timestamptz, text, bigint, boolean)       to anon, authenticated, service_role;
grant execute on function public.with_without_stats(text[], timestamptz, timestamptz, text, bigint, boolean) to anon, authenticated, service_role;
