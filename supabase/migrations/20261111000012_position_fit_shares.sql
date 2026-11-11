-- =============================================================================
-- 012 · position_fit: la afinidad de perfil pasa a ser un REPARTO entre posiciones.
--
-- Verificado con datos reales (2026-11-11): la similitud coseno de 011 daba
-- valores engañosos para posiciones "intermedias" (un mediocampista con 8 PJ de
-- medio salía con 7 % de afinidad con el medio): el perfil típico del medio
-- queda cerca del centro y su dirección es inestable.
--
-- Ahora: distancia entre su perfil (estandarizado) y el perfil de los DEMÁS en
-- cada posición; luego se reparte el 100 % entre las posiciones comparables,
-- con más peso a la más cercana (exp(-distancia² media)). Lectura:
-- "su forma de jugar es 60 % de medio, 30 % de delantero, 10 % de defensa".
-- Solo entran posiciones donde los demás suman 3+ registros (jugador × partido);
-- con menos, el perfil de la posición no es confiable y queda en null.
-- Misma firma y columnas que en 011.
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
  scale as (
    select pt.k, avg(pt.v * 5400 / pt.sec) as mu, stddev_pop(pt.v * 5400 / pt.sec) as sd
    from pos_tot pt where pt.sec > 0 group by pt.k
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
