-- =============================================================================
-- 008 · Rendimiento RELATIVO AL ROL (posición o arquetipo).
--
-- Requisito del usuario: no penalizar a quien rota de posición/arquetipo, sobre
-- todo hacia roles defensivos. En vez de comparar a todos contra todos, cada
-- jugador se compara con el PROMEDIO DEL CLUB EN ESE MISMO ROL (en el rango
-- filtrado). Índice 100 = promedio del rol; 120 = 20 % mejor que el promedio.
-- Si jugó varios roles, el índice final se pondera por los minutos en cada uno.
--
-- No es la fórmula de "mejor jugador" (pospuesta): son datos comparables.
-- =============================================================================

-- Desglose: una fila por persona y rol.
create function public.relative_stats_detail(
  p_group              text        default 'position',   -- 'position' | 'archetype'
  p_match_types        text[]      default null,
  p_from               timestamptz default null,
  p_to                 timestamptz default null,
  p_season             text        default null,
  p_club_id            bigint      default null,
  p_exclude_incomplete boolean     default false
)
returns table (
  person_id bigint, person_name text, group_key text, matches bigint, seconds bigint,
  group_rows bigint,
  rating numeric, group_rating numeric, rating_idx numeric,
  ga90 numeric, group_ga90 numeric, ga90_idx numeric,
  pass_pct numeric, group_pass_pct numeric, pass_idx numeric,
  tackles90 numeric, group_tackles90 numeric, tackles90_idx numeric,
  save_pct numeric, group_save_pct numeric, save_idx numeric,
  interceptions90_exp numeric, group_interceptions90_exp numeric, interceptions90_idx_exp numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select f.*,
           case when p_group = 'archetype' then coalesce(f.archetype_id::text, '?') else f.position end as gkey
    from public.filtered_player_matches(p_match_types, p_from, p_to, p_season, p_club_id, p_exclude_incomplete) f
  ),
  -- Mismas cuentas para el rol completo (g) y para cada persona dentro del rol (pg).
  g as (
    select b.gkey, count(*) as n,
           avg(b.rating) as rating,
           sum(b.goals + b.assists) * 5400.0 / nullif(sum(b.seconds_played), 0) as ga90,
           100.0 * sum(b.passes_made) / nullif(sum(b.pass_attempts), 0) as pass_pct,
           sum(b.tackles_made) * 5400.0 / nullif(sum(b.seconds_played), 0) as tackles90,
           100.0 * sum(b.saves) filter (where b.position = 'goalkeeper')
             / nullif(sum(b.saves + b.goals_conceded) filter (where b.position = 'goalkeeper'), 0) as save_pct,
           sum(b.interceptions_exp) * 5400.0
             / nullif(sum(b.seconds_played) filter (where b.interceptions_exp is not null), 0) as int90
    from base b group by b.gkey
  ),
  pg as (
    select b.person_id, max(b.person_name) as person_name, b.gkey,
           count(distinct b.match_id) as matches, sum(b.seconds_played) as seconds,
           avg(b.rating) as rating,
           sum(b.goals + b.assists) * 5400.0 / nullif(sum(b.seconds_played), 0) as ga90,
           100.0 * sum(b.passes_made) / nullif(sum(b.pass_attempts), 0) as pass_pct,
           sum(b.tackles_made) * 5400.0 / nullif(sum(b.seconds_played), 0) as tackles90,
           100.0 * sum(b.saves) filter (where b.position = 'goalkeeper')
             / nullif(sum(b.saves + b.goals_conceded) filter (where b.position = 'goalkeeper'), 0) as save_pct,
           sum(b.interceptions_exp) * 5400.0
             / nullif(sum(b.seconds_played) filter (where b.interceptions_exp is not null), 0) as int90
    from base b group by b.person_id, b.gkey
  )
  select pg.person_id, pg.person_name, pg.gkey, pg.matches, pg.seconds, g.n,
         round(pg.rating, 2), round(g.rating, 2), round(100 * pg.rating / nullif(g.rating, 0), 1),
         round(pg.ga90, 2), round(g.ga90, 2), round(100 * pg.ga90 / nullif(g.ga90, 0), 1),
         round(pg.pass_pct, 1), round(g.pass_pct, 1), round(100 * pg.pass_pct / nullif(g.pass_pct, 0), 1),
         round(pg.tackles90, 2), round(g.tackles90, 2), round(100 * pg.tackles90 / nullif(g.tackles90, 0), 1),
         round(pg.save_pct, 1), round(g.save_pct, 1), round(100 * pg.save_pct / nullif(g.save_pct, 0), 1),
         round(pg.int90, 2), round(g.int90, 2), round(100 * pg.int90 / nullif(g.int90, 0), 1)
  from pg join g on g.gkey = pg.gkey
$$;

-- Resumen por persona: índices ponderados por los minutos jugados en cada rol.
create function public.relative_stats(
  p_group              text        default 'position',
  p_match_types        text[]      default null,
  p_from               timestamptz default null,
  p_to                 timestamptz default null,
  p_season             text        default null,
  p_club_id            bigint      default null,
  p_exclude_incomplete boolean     default false
)
returns table (
  person_id bigint, person_name text, matches bigint, minutes numeric, roles_played bigint,
  roles text, rating_idx numeric, ga90_idx numeric, pass_idx numeric, tackles90_idx numeric,
  save_idx numeric, interceptions90_idx_exp numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with d as (
    select * from public.relative_stats_detail(p_group, p_match_types, p_from, p_to, p_season, p_club_id, p_exclude_incomplete)
  )
  select d.person_id, max(d.person_name),
         sum(d.matches)::bigint,
         round(sum(d.seconds) / 60.0, 0),
         count(*),
         string_agg(d.group_key, ', ' order by d.seconds desc),
         round(sum(d.rating_idx * d.seconds) / nullif(sum(d.seconds) filter (where d.rating_idx is not null), 0), 1),
         round(sum(d.ga90_idx * d.seconds) / nullif(sum(d.seconds) filter (where d.ga90_idx is not null), 0), 1),
         round(sum(d.pass_idx * d.seconds) / nullif(sum(d.seconds) filter (where d.pass_idx is not null), 0), 1),
         round(sum(d.tackles90_idx * d.seconds) / nullif(sum(d.seconds) filter (where d.tackles90_idx is not null), 0), 1),
         round(sum(d.save_idx * d.seconds) / nullif(sum(d.seconds) filter (where d.save_idx is not null), 0), 1),
         round(sum(d.interceptions90_idx_exp * d.seconds) / nullif(sum(d.seconds) filter (where d.interceptions90_idx_exp is not null), 0), 1)
  from d
  group by d.person_id
$$;

grant execute on function public.relative_stats_detail(text, text[], timestamptz, timestamptz, text, bigint, boolean) to anon, authenticated, service_role;
grant execute on function public.relative_stats(text, text[], timestamptz, timestamptz, text, bigint, boolean)        to anon, authenticated, service_role;
