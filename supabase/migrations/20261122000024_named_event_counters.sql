-- =============================================================================
-- 024 · Contadores nuevos de match_event_aggregate, con nombre (pedido del usuario,
-- 2026-11-22: "verifica todo, corrige lo equivocado, muestra lo útil y guarda el resto").
--
-- Fuente de los significados: la comunidad (Interactive-63/eafc-pro-clubs-api-research y
-- su issue #1), NO EA. Cada uno se contrastó con los campos oficiales en nuestros 176
-- registros jugador × partido antes de usarlo (ver docs/datos-ea.md, "Verificación 2026-11-22").
-- Los datos ya estaban guardados en player_match_stats.event_counts y en match_raw: esta
-- migración solo les pone nombre en la vista. No cambia ni borra nada.
--
-- Correcciones (en el dashboard, no aquí): dangerous_tackles_exp (163) y clean_tackles_exp
-- (164) se dejan en la vista con su nombre viejo (create or replace view no permite
-- renombrar), pero el dashboard ya no los usa: 164 es igual a las entradas ganadas
-- (168/176) y 163 es una parte de las entradas perdidas, no de las faltas.
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
  s.parry_saves, s.punch_saves, s.reflex_saves, s.cross_saves, s.ball_dive_saves, s.good_direction_saves,
  -- 022: media del Pro observada justo después del partido (por arquetipo)
  s.pro_overall,
  -- 023: humanos del rival (el MVP se elige entre los humanos de los dos equipos)
  m.opponent_humans,
  -- 024 · Útiles, verificados con nuestros datos (se muestran en el dashboard)
  public.event_sum(s.event_counts, array['238', '239', '48']) as outside_goals_exp,
  public.event_sum(s.event_counts, array['128']) as first_time_goals_exp,
  public.event_sum(s.event_counts, array['117']) as corner_assists_exp,
  public.event_sum(s.event_counts, array['265']) as aerial_won_att_exp,
  public.event_sum(s.event_counts, array['266']) as aerial_won_def_exp,
  public.event_sum(s.event_counts, array['32']) as backward_passes_ok_exp,
  public.event_sum(s.event_counts, array['33']) as backward_passes_failed_exp,
  public.event_sum(s.event_counts, array['34']) as sideways_passes_ok_exp,
  public.event_sum(s.event_counts, array['35']) as sideways_passes_failed_exp,
  -- 024 · Solo guardados (sin verificar o poco útiles; no se muestran)
  public.event_sum(s.event_counts, array['1']) as tackles_lost_exp,
  public.event_sum(s.event_counts, array['123']) as chipped_goals_exp,
  public.event_sum(s.event_counts, array['125']) as headed_goals_exp,
  public.event_sum(s.event_counts, array['203']) as penalties_taken_exp,
  public.event_sum(s.event_counts, array['46']) as penalty_goals_exp,
  public.event_sum(s.event_counts, array['157']) as crosses_attempted_exp,
  public.event_sum(s.event_counts, array['151']) as bad_passes_exp,
  public.event_sum(s.event_counts, array['96']) as red_card_trigger_exp,
  public.event_sum(s.event_counts, array['99']) as out_of_position_sev1_exp,
  public.event_sum(s.event_counts, array['100']) as out_of_position_sev2_exp,
  public.event_sum(s.event_counts, array['101']) as out_of_position_sev3_exp,
  public.event_sum(s.event_counts, array['175']) as fb_no_good_option_exp,
  public.event_sum(s.event_counts, array['176']) as fb_good_option_exp,
  public.event_sum(s.event_counts, array['179']) as fb_should_have_shot_exp,
  public.event_sum(s.event_counts, array['183']) as fb_chose_to_pass_exp,
  public.event_sum(s.event_counts, array['207']) as fb_pick_your_pass_exp,
  public.event_sum(s.event_counts, array['212']) as fb_use_the_ball_exp
from public.player_match_stats s
join public.matches  m on m.match_id  = s.match_id
join public.clubs    c on c.club_id   = m.club_id
join public.accounts a on a.player_id = s.player_id
join public.persons  p on p.person_id = a.person_id;
