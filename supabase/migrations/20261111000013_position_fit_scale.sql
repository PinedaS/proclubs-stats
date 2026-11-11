-- =============================================================================
-- 013 · position_fit: escala de los rasgos por variación ENTRE JUGADORES.
--
-- Verificado con datos reales (2026-11-11): en 012 la escala era la dispersión
-- entre los PROMEDIOS de cada posición, mucho menor que la variación normal
-- entre jugadores. Todos quedaban "lejos" de todo y el reparto salía extremo
-- (0 % o 100 %), ganando posiciones con muy pocos datos: los mediocampistas
-- con 8 PJ de medio salían con 0 % de medio.
-- Ahora la escala es la dispersión entre perfiles individuales (persona ×
-- posición). Con la misma consulta de prueba, los mediocampistas quedan
-- mayormente "medio" (42–66 %) y el reparto es gradual.
-- Resto igual que 012 (misma firma y columnas).
-- =============================================================================

create or replace function public.position_fit(
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
  long as (
    select pp.person_id, pp.position, f.k, f.v::numeric as v, pp.sec
    from pp
    cross join lateral (values ('g', pp.g), ('a', pp.a), ('sh', pp.sh), ('pm', pp.pm),
                               ('tk', pp.tk), ('sv', pp.sv), ('itc', pp.itc), ('dr', pp.dr)) as f(k, v)
  ),
  pos_tot as (
    select l.position, l.k, sum(l.v) as v, sum(l.sec) as sec from long l group by l.position, l.k
  ),
  -- Dispersión de cada rasgo entre los perfiles individuales (persona × posición).
  scale as (
    select l.k, stddev_pop(l.v * 5400 / l.sec) as sd
    from long l where l.sec > 0 group by l.k
  ),
  person_prof as (
    select l.person_id, l.k, sum(l.v) * 5400 / nullif(sum(l.sec), 0) as x from long l group by l.person_id, l.k
  ),
  people as (select distinct pp.person_id from pp),
  pos_rows as (
    select pp.position, sum(pp.n_rows) as n_rows,
           sum(pp.rating_sum) / nullif(sum(pp.rating_n), 0) as rating
    from pp group by pp.position
  ),
  others as (
    select pe.person_id, pt.position, pt.k,
           (pt.v - coalesce(l.v, 0)) * 5400 / nullif(pt.sec - coalesce(l.sec, 0), 0) as x
    from people pe
    cross join pos_tot pt
    left join long l on l.person_id = pe.person_id and l.position = pt.position and l.k = pt.k
  ),
  -- Distancia² media en unidades estandarizadas (solo rasgos con dispersión).
  dist as (
    select o.person_id, o.position,
           avg(power((p.x - o.x) / s.sd, 2)) as msd
    from others o
    join scale s on s.k = o.k and s.sd > 0
    join person_prof p on p.person_id = o.person_id and p.k = o.k
    join pos_rows pr on pr.position = o.position
    left join pp mine on mine.person_id = o.person_id and mine.position = o.position
    where o.x is not null
      and pr.n_rows - coalesce(mine.n_rows, 0) >= 3
    group by o.person_id, o.position
  ),
  -- Se resta la mínima de cada persona (la más cercana pesa 1) y se acota a 50
  -- para que exp() no se desborde: el reparto no cambia y la suma nunca es 0.
  weights as (
    select d.person_id, d.position,
           exp(-least(d.msd - min(d.msd) over (partition by d.person_id), 50)) as w
    from dist d
  ),
  shares as (
    select w.person_id, w.position, 100 * w.w / sum(w.w) over (partition by w.person_id) as pct
    from weights w
  ),
  names as (select pp.person_id, max(pp.person_name) as person_name from pp group by pp.person_id)
  select pe.person_id, nm.person_name, pr.position,
         coalesce(mine.matches, 0),
         round(coalesce(mine.sec, 0) / 60.0, 0),
         round(mine.rating_sum / nullif(mine.rating_n, 0), 2),
         round(100 * (mine.rating_sum / nullif(mine.rating_n, 0)) / nullif(pr.rating, 0), 1),
         round(sh.pct, 0),
         (pr.n_rows - coalesce(mine.n_rows, 0))::bigint
  from people pe
  join names nm on nm.person_id = pe.person_id
  cross join pos_rows pr
  left join pp mine on mine.person_id = pe.person_id and mine.position = pr.position
  left join shares sh on sh.person_id = pe.person_id and sh.position = pr.position
$$;
