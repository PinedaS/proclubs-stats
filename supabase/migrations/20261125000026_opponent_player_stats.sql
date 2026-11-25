-- =============================================================================
-- 026 · Estadísticas de los humanos RIVALES, sin identificarlos (pedido del usuario,
-- 2026-11-25): referencia "jugador de nuestro nivel" para "Con el balón".
--
-- Verificado el 2026-11-25: el juego nos empareja por nivel del club (skillRating);
-- 2 de cada 3 rivales están a menos de 100 puntos de nosotros. Por eso todos los
-- humanos de una posición (nuestros + rivales) son una referencia de nuestro nivel.
--
-- Son datos de TERCEROS y el dashboard es público: esta vista expone SOLO números
-- (posición, minutos, pases, tiros, goles, asistencias y algunos contadores). Sin
-- nombre, sin ID de cuenta y sin ID del club rival. match_raw sigue cerrado para anon.
-- Es una vista del dueño (sin security_invoker), como las de la 025, y no llama a
-- funciones (anon no ejecuta parse_event_aggregates): los contadores se leen aquí.
-- =============================================================================

create view public.v_opponent_player_stats as
select
  m.club_id,                                   -- NUESTRO club (para filtrar), no el rival
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
  ev.second_assists_exp
from public.matches m
join public.match_raw r on r.match_id = m.match_id
cross join lateral jsonb_each(
  case when jsonb_typeof(r.payload -> 'players' -> m.opponent_club_id::text) = 'object'
       then r.payload -> 'players' -> m.opponent_club_id::text else '{}'::jsonb end
) pl
cross join lateral (
  -- Contadores "código:cantidad" de match_event_aggregate_0..3 (mismos códigos que la vista
  -- de nuestros jugadores). Sin pares válidos, null (dato desconocido), no 0.
  select
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '97'), 0) end::integer                    as carries_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k in ('105', '106', '107')), 0) end::integer   as possession_lost_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '182'), 0) end::integer                   as should_have_passed_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '152'), 0) end::integer                   as through_passes_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '112'), 0) end::integer                   as beats_exp,
    case when count(*) > 0 then coalesce(sum(c.v) filter (where c.k = '115'), 0) end::integer                   as second_assists_exp
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
  'Estadísticas de cada humano rival por partido, SIN identificarlo (sin nombre, cuenta ni club rival): referencia de "jugador de nuestro nivel". * = contadores experimentales.';

grant select on public.v_opponent_player_stats to anon, authenticated, service_role;
