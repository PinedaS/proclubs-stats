-- =============================================================================
-- 027 · Más datos de los humanos RIVALES, todavía sin identificarlos (pedido del
-- usuario, 2026-11-25): "Puntos fuertes y para mejorar" contra un jugador de nuestro
-- nivel y la sección "Nosotros contra los rivales" de Club.
--
-- Misma regla que la 026: solo números. Sin nombre, sin ID de cuenta, sin ID del club
-- rival y sin match_id. Se agregan columnas AL FINAL (create or replace view exige
-- mantener las de la 026 en el mismo orden) con los mismos nombres y códigos que la
-- vista de nuestros jugadores (v_player_match_stats, 024).
-- =============================================================================

create or replace view public.v_opponent_player_stats as
select
  m.club_id,
  m.played_at,
  m.match_type,
  pl.value ->> 'pos'                                          as position,
  nullif(pl.value ->> 'secondsPlayed', '')::integer           as seconds_played,
  nullif(pl.value ->> 'goals', '')::integer                   as goals,
  nullif(pl.value ->> 'assists', '')::integer                 as assists,
  nullif(pl.value ->> 'shots', '')::integer                   as shots,
  nullif(pl.value ->> 'passesmade', '')::integer              as passes_made,
  nullif(pl.value ->> 'passattempts', '')::integer            as pass_attempts,
  ev.carries_exp,
  ev.possession_lost_exp,
  ev.should_have_passed_exp,
  ev.through_passes_exp,
  ev.beats_exp,
  ev.second_assists_exp,
  -- 027: oficiales
  nullif(pl.value ->> 'rating', '')::numeric                  as rating,
  nullif(pl.value ->> 'tacklesmade', '')::integer             as tackles_made,
  nullif(pl.value ->> 'tackleattempts', '')::integer          as tackle_attempts,
  nullif(pl.value ->> 'saves', '')::integer                   as saves,
  nullif(pl.value ->> 'goalsconceded', '')::integer           as goals_conceded,
  nullif(pl.value ->> 'cleansheetsgk', '')::integer           as clean_sheets_gk,
  nullif(pl.value ->> 'redcards', '')::integer                as red_cards,
  nullif(pl.value ->> 'mom', '')::integer = 1                 as is_mom,
  -- 027: experimentales (mismos códigos que la 024)
  ev.dribbles_exp, ev.interceptions_exp, ev.possession_won_exp, ev.aerial_duels_won_exp,
  ev.fouls_exp, ev.yellow_cards_exp, ev.shots_on_target_exp, ev.shots_off_target_exp,
  ev.forward_passes_ok_exp, ev.forward_passes_failed_exp, ev.best_option_exp, ev.fouls_won_exp,
  ev.penalties_conceded_exp, ev.long_passes_ok_exp, ev.long_passes_failed_exp, ev.first_time_passes_exp,
  ev.offside_passes_exp, ev.box_shots_on_exp, ev.box_shots_off_exp, ev.outside_shots_on_exp,
  ev.outside_shots_off_exp, ev.dispossessed_exp, ev.aerial_won_att_exp, ev.aerial_won_def_exp
from public.matches m
join public.match_raw r on r.match_id = m.match_id
cross join lateral jsonb_each(
  case when jsonb_typeof(r.payload -> 'players' -> m.opponent_club_id::text) = 'object'
       then r.payload -> 'players' -> m.opponent_club_id::text else '{}'::jsonb end
) pl
cross join lateral (
  -- Sin pares válidos, todos en null (dato desconocido), no 0.
  select
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '97'), 0) end::integer                         as carries_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k in ('105', '106', '107')), 0) end::integer        as possession_lost_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '182'), 0) end::integer                        as should_have_passed_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '152'), 0) end::integer                        as through_passes_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '112'), 0) end::integer                        as beats_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '115'), 0) end::integer                        as second_assists_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '174'), 0) end::integer                        as dribbles_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '6'), 0) end::integer                          as interceptions_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k in ('108', '109', '110')), 0) end::integer        as possession_won_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k in ('265', '266')), 0) end::integer               as aerial_duels_won_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k in ('2', '3')), 0) end::integer                   as fouls_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k in ('95', '213')), 0) end::integer                as yellow_cards_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '217'), 0) end::integer                        as shots_on_target_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '218'), 0) end::integer                        as shots_off_target_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '30'), 0) end::integer                         as forward_passes_ok_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '31'), 0) end::integer                         as forward_passes_failed_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '177'), 0) end::integer                        as best_option_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '4'), 0) end::integer                          as fouls_won_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '94'), 0) end::integer                         as penalties_conceded_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '28'), 0) end::integer                         as long_passes_ok_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '29'), 0) end::integer                         as long_passes_failed_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '143'), 0) end::integer                        as first_time_passes_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '153'), 0) end::integer                        as offside_passes_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '13'), 0) end::integer                         as box_shots_on_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '14'), 0) end::integer                         as box_shots_off_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '18'), 0) end::integer                         as outside_shots_on_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '19'), 0) end::integer                         as outside_shots_off_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '158'), 0) end::integer                        as dispossessed_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '265'), 0) end::integer                        as aerial_won_att_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '266'), 0) end::integer                        as aerial_won_def_exp
  from (
    select split_part(kv, ':', 1) as k, split_part(kv, ':', 2)::bigint as v
    from unnest(string_to_array(concat_ws(',',
      pl.value ->> 'match_event_aggregate_0', pl.value ->> 'match_event_aggregate_1',
      pl.value ->> 'match_event_aggregate_2', pl.value ->> 'match_event_aggregate_3'), ',')) as kv
    where kv ~ '^\d+:\d+$'
  ) c
) ev
where m.opponent_club_id is not null;

comment on view public.v_opponent_player_stats is
  'Estadísticas de cada humano rival por partido, SIN identificarlo (sin nombre, cuenta, club rival ni match_id): referencia de "jugador de nuestro nivel". Mismos nombres y códigos que v_player_match_stats. * = contadores experimentales.';

grant select on public.v_opponent_player_stats to anon, authenticated, service_role;
