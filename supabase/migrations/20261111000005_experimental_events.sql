-- =============================================================================
-- 005 · Datos EXPERIMENTALES desde match_event_aggregate_0..3.
--
-- EA no documenta estos campos: son pares "código:cantidad". El significado de
-- cada código viene de la investigación de la comunidad
-- (github.com/Interactive-63/eafc-pro-clubs-api-research), NO de EA.
-- Contrastado contra campos oficiales (2026-11-11): coincidencias del 65 % al 98 %,
-- según el código. Son aproximaciones: el dashboard los marca como experimentales.
--
-- Diseño:
--   * player_match_stats.event_counts guarda TODOS los códigos ({"174": 11, ...}),
--     no solo los que hoy se muestran. Si mañana se descifra otro código, basta
--     con una vista nueva, sin tocar el colector ni reprocesar.
--   * Los partidos ya capturados se rellenan aquí mismo desde match_raw.
-- =============================================================================

alter table public.player_match_stats add column event_counts jsonb;

comment on column public.player_match_stats.event_counts is
  'Contadores de match_event_aggregate_0..3 sumados por código ({"174": 11}). Sin documentar por EA; null si EA no los mandó o venían mal formados.';

-- Interpreta las 4 cadenas "código:cantidad,..." de un jugador. Misma lógica que
-- parseEventAggregates() del colector; la prueba de integración verifica que coinciden.
create function public.parse_event_aggregates(p_player jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(t.code, t.total), '{}'::jsonb)
  from (
    select split_part(pair, ':', 1) as code,
           sum(split_part(pair, ':', 2)::integer) as total
    from unnest(array['match_event_aggregate_0', 'match_event_aggregate_1',
                      'match_event_aggregate_2', 'match_event_aggregate_3']) as k(key)
    cross join lateral unnest(string_to_array(coalesce(p_player ->> k.key, ''), ',')) as pair
    where pair <> ''
    group by 1
  ) t
$$;

-- Suma de varios códigos; null si el partido no tiene contadores.
create function public.event_sum(p_counts jsonb, p_codes text[])
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_counts is null then null
    else (select coalesce(sum((p_counts ->> c)::integer), 0) from unnest(p_codes) as c)::integer
  end
$$;

-- Relleno de los partidos ya guardados.
update public.player_match_stats s
   set event_counts = public.parse_event_aggregates(r.payload -> 'players' -> (r.club_id::text) -> s.player_id)
  from public.match_raw r
 where r.match_id = s.match_id
   and s.event_counts is null;

-- -----------------------------------------------------------------------------
-- Vista por jugador y partido: se agregan columnas al final (lo exige
-- CREATE OR REPLACE VIEW). Sufijo _exp = experimental.
-- -----------------------------------------------------------------------------
create or replace view public.v_player_match_stats
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
  s.seconds_played,
  public.event_sum(s.event_counts, array['174'])               as dribbles_exp,
  public.event_sum(s.event_counts, array['6'])                 as interceptions_exp,
  public.event_sum(s.event_counts, array['108', '109', '110']) as possession_won_exp,
  public.event_sum(s.event_counts, array['105', '106', '107']) as possession_lost_exp,
  public.event_sum(s.event_counts, array['265', '266'])        as aerial_duels_won_exp,
  public.event_sum(s.event_counts, array['2', '3'])            as fouls_exp,
  public.event_sum(s.event_counts, array['95', '213'])         as yellow_cards_exp
from public.player_match_stats s
join public.matches  m on m.match_id  = s.match_id
join public.clubs    c on c.club_id   = m.club_id
join public.accounts a on a.player_id = s.player_id
join public.persons  p on p.person_id = a.person_id;

-- -----------------------------------------------------------------------------
-- person_stats con totales experimentales. Cambia el tipo de retorno, así que
-- hay que borrarla (y la vista que depende de ella) y volver a crearlas.
-- -----------------------------------------------------------------------------
drop view public.v_person_totals;
drop function public.person_stats(text[], timestamptz, timestamptz, text, bigint);

create function public.person_stats(
  p_match_types text[]      default null,
  p_from        timestamptz default null,
  p_to          timestamptz default null,
  p_season      text        default null,
  p_club_id     bigint      default null
)
returns table (
  person_id             bigint,
  person_name           text,
  main_position         text,
  matches               bigint,
  wins                  bigint,
  draws                 bigint,
  losses                bigint,
  goals                 bigint,
  assists               bigint,
  goal_contributions    bigint,
  shots                 bigint,
  passes_made           bigint,
  pass_attempts         bigint,
  pass_accuracy_pct     numeric,
  tackles_made          bigint,
  tackle_attempts       bigint,
  tackle_success_pct    numeric,
  saves                 bigint,
  goals_conceded        bigint,
  clean_sheets_def      bigint,
  clean_sheets_gk       bigint,
  mom_count             bigint,
  mom_pct               numeric,
  red_cards             bigint,
  avg_rating            numeric,
  seconds_played        bigint,
  goals_per_match       numeric,
  assists_per_match     numeric,
  ga_per_match          numeric,
  dribbles_exp          bigint,
  interceptions_exp     bigint,
  possession_won_exp    bigint,
  possession_lost_exp   bigint,
  aerial_duels_won_exp  bigint,
  fouls_exp             bigint,
  yellow_cards_exp      bigint
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
    round((sum(v.goals) + sum(v.assists))::numeric / count(distinct v.match_id), 2) as ga_per_match,
    sum(v.dribbles_exp)                                                         as dribbles_exp,
    sum(v.interceptions_exp)                                                    as interceptions_exp,
    sum(v.possession_won_exp)                                                   as possession_won_exp,
    sum(v.possession_lost_exp)                                                  as possession_lost_exp,
    sum(v.aerial_duels_won_exp)                                                 as aerial_duels_won_exp,
    sum(v.fouls_exp)                                                            as fouls_exp,
    sum(v.yellow_cards_exp)                                                     as yellow_cards_exp
  from public.v_player_match_stats v
  where (p_match_types is null or v.match_type = any (p_match_types))
    and (p_from        is null or v.played_at >= p_from)
    and (p_to          is null or v.played_at <  p_to)
    and (p_season      is null or v.season    =  p_season)
    and (p_club_id     is null or v.club_id   =  p_club_id)
  group by v.person_id, v.person_name
$$;

create view public.v_person_totals
with (security_invoker = true)
as
select * from public.person_stats();

-- -----------------------------------------------------------------------------
-- Permisos (mismo criterio que 002–004).
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger
  on public.v_person_totals from anon, authenticated;
grant select on public.v_person_totals to anon, authenticated, service_role;

-- La vista del dashboard llama a event_sum con los permisos de quien consulta.
grant execute on function public.event_sum(jsonb, text[]) to anon, authenticated, service_role;
grant execute on function public.person_stats(text[], timestamptz, timestamptz, text, bigint)
  to anon, authenticated, service_role;

-- parse_event_aggregates solo se usa en esta migración y en pruebas.
revoke execute on function public.parse_event_aggregates(jsonb) from public, anon, authenticated;
