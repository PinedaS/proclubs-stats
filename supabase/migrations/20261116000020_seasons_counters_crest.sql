-- =============================================================================
-- 020 · Tres cambios pedidos por el usuario el 2026-11-16:
--   A. Temporadas dentro de cada juego (club_seasons).
--   B. Escudo del club (clubs.team_id, clubs.crest_asset_id).
--   C. Más contadores en v_player_match_stats para "+ Añadir dato".
--
-- A. Temporadas.
-- clubs.season sigue siendo el JUEGO (FC27, FC28). Dentro de cada juego hay
-- varias temporadas de liga de Clubes. Investigado el 2026-11-16 (ver CLAUDE.md):
--   - EA (glosario): los Play-offs son la última semana de cada temporada de liga.
--   - Guía de aficionados PRO11 (no oficial): las temporadas van por fecha, igual
--     para todos los clubes; la temporada 2 de FC 27 va del 22-oct al 3-dic-2026.
--   - EA NO da en la API ni el número ni las fechas de la temporada.
-- Detección automática (colector): cuando bajan los partidos de la temporada que
-- da EA (currentSeason.gamesPlayed), empezó una temporada nueva. Su inicio es el
-- momento de la captura anterior (la última que todavía veía la temporada vieja).
-- Sin verificar con un reinicio real: el primero sería alrededor del 3-dic-2026.
--
-- El dashboard filtra por temporada con su rango de fechas (p_from/p_to de las
-- funciones de siempre): no hace falta cambiar ninguna función de análisis.
-- =============================================================================

create table public.club_seasons (
  club_id         bigint      not null references public.clubs (club_id) on delete cascade,
  -- Número propio, contado desde que empezamos a registrar al club (1, 2, 3…).
  -- EA numera las temporadas del juego a su manera y no lo da en la API.
  season_no       integer     not null check (season_no >= 1),
  started_at      timestamptz not null,
  ended_at        timestamptz,             -- null = temporada en curso
  -- Cómo se supo dónde empieza: inicio del registro o reinicio de los contadores de EA.
  detected_by     text        not null check (detected_by in ('inicio del registro', 'reinicio de EA')),
  -- Fin esperado (estimado, p. ej. por el calendario del juego). Solo para avisar; puede quedar null.
  expected_end_at timestamptz,
  -- Partidos y puntos de la temporada según EA en la última captura de la temporada anterior.
  prev_games      integer,
  prev_points     integer,
  primary key (club_id, season_no),
  check (ended_at is null or ended_at >= started_at)
);

-- Una sola temporada abierta por club.
create unique index club_seasons_one_open on public.club_seasons (club_id) where ended_at is null;

comment on table public.club_seasons is
  'Temporadas de liga dentro de cada juego (clubs.season = juego). Detectadas cuando EA reinicia los contadores de la temporada.';

alter table public.club_seasons enable row level security;
create policy club_seasons_read on public.club_seasons for select to anon, authenticated using (true);
revoke all on public.club_seasons from anon, authenticated;
grant select on public.club_seasons to anon, authenticated;
grant select, insert, update, delete on public.club_seasons to service_role;

-- Clubes ya seguidos: su temporada 1 empieza con su primer partido capturado.
-- Fin esperado: 3-dic-2026 07:00 UTC (calendario de la temporada 2 de FC 27 según
-- PRO11; la temporada 1 terminó el 22-oct a las 06:59 UTC). Es un estimado.
insert into public.club_seasons (club_id, season_no, started_at, detected_by, expected_end_at)
select c.club_id, 1, coalesce(min(m.played_at), c.first_seen_at), 'inicio del registro',
       case when c.season = 'FC27' then timestamptz '2026-12-03 07:00:00+00' end
  from public.clubs c
  left join public.matches m on m.club_id = c.club_id
 group by c.club_id, c.first_seen_at, c.season;

-- =============================================================================
-- Escudo del club (pedido del usuario, 2026-11-16). EA lo manda en
-- currentSeason.clubInfo: teamId (escudo real) y customKit.crestAssetId
-- (escudo propio). La imagen se carga desde la dirección que documenta la
-- investigación de la comunidad (Interactive-63); verificada el 2026-11-16:
-- responde 200 con PNG para el crestAssetId de 100 D CILANTRO.
-- anon ya lee clubs completa.
-- =============================================================================
alter table public.clubs add column team_id bigint, add column crest_asset_id bigint;

comment on column public.clubs.crest_asset_id is 'Escudo propio del club (customKit.crestAssetId de EA). Imagen: .../crests/256x256/l<id>.png';

update public.clubs c
   set team_id = nullif(s.raw #>> '{currentSeason,clubInfo,teamId}', '')::bigint,
       crest_asset_id = nullif(s.raw #>> '{currentSeason,clubInfo,customKit,crestAssetId}', '')::bigint
  from (select distinct on (club_id) club_id, raw from public.club_snapshots order by club_id, snapshot_date desc) s
 where s.club_id = c.club_id
   and s.raw #>> '{currentSeason,clubInfo,teamId}' ~ '^[0-9]+$';

-- =============================================================================
-- Más contadores en la vista (experimentales, sufijo _exp), según el mapeo de
-- la comunidad (Interactive-63, "Confirmed / high confidence"), y los tipos de
-- atajada (oficiales, ya en columnas). Se agregan AL FINAL de la vista, así
-- CREATE OR REPLACE no cambia las columnas existentes. El dashboard los suma
-- por persona para "+ Añadir dato".
-- =============================================================================
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
  coalesce(m.club_division, (select cs.current_division
     from public.club_snapshots cs
    where cs.club_id = m.club_id
      and cs.snapshot_date <= (m.played_at at time zone 'UTC')::date
      and cs.current_division is not null
    order by cs.snapshot_date desc
    limit 1))                                                  as club_division,
  -- 020: pases por distancia y tipo
  public.event_sum(s.event_counts, array['24'])                as short_passes_ok_exp,
  public.event_sum(s.event_counts, array['25'])                as short_passes_failed_exp,
  public.event_sum(s.event_counts, array['26'])                as medium_passes_ok_exp,
  public.event_sum(s.event_counts, array['27'])                as medium_passes_failed_exp,
  public.event_sum(s.event_counts, array['28'])                as long_passes_ok_exp,
  public.event_sum(s.event_counts, array['29'])                as long_passes_failed_exp,
  public.event_sum(s.event_counts, array['143'])               as first_time_passes_exp,
  public.event_sum(s.event_counts, array['144'])               as switches_exp,
  public.event_sum(s.event_counts, array['147'])               as flair_passes_exp,
  public.event_sum(s.event_counts, array['153'])               as offside_passes_exp,
  public.event_sum(s.event_counts, array['118'])               as through_ball_assists_exp,
  -- tiro y gol
  public.event_sum(s.event_counts, array['13'])                as box_shots_on_exp,
  public.event_sum(s.event_counts, array['14'])                as box_shots_off_exp,
  public.event_sum(s.event_counts, array['18'])                as outside_shots_on_exp,
  public.event_sum(s.event_counts, array['19'])                as outside_shots_off_exp,
  public.event_sum(s.event_counts, array['131'])               as weak_foot_goals_exp,
  public.event_sum(s.event_counts, array['136'])               as post_goals_exp,
  -- regate
  public.event_sum(s.event_counts, array['97'])                as carries_exp,
  public.event_sum(s.event_counts, array['112'])               as beats_exp,
  public.event_sum(s.event_counts, array['38'])                as skill_beats_exp,
  -- defensa
  public.event_sum(s.event_counts, array['229'])               as standing_tackles_exp,
  public.event_sum(s.event_counts, array['230'])               as sliding_tackles_exp,
  public.event_sum(s.event_counts, array['163'])               as dangerous_tackles_exp,
  public.event_sum(s.event_counts, array['164'])               as clean_tackles_exp,
  public.event_sum(s.event_counts, array['158'])               as dispossessed_exp,
  public.event_sum(s.event_counts, array['156'])               as crosses_blocked_exp,
  public.event_sum(s.event_counts, array['10'])                as corners_conceded_exp,
  public.event_sum(s.event_counts, array['145'])               as corners_taken_exp,
  public.event_sum(s.event_counts, array['102', '103'])        as out_of_position_severe_exp,
  -- atajadas por tipo (oficiales)
  s.parry_saves, s.punch_saves, s.reflex_saves, s.cross_saves, s.ball_dive_saves, s.good_direction_saves
from public.player_match_stats s
join public.matches  m on m.match_id  = s.match_id
join public.clubs    c on c.club_id   = m.club_id
join public.accounts a on a.player_id = s.player_id
join public.persons  p on p.person_id = a.person_id;
