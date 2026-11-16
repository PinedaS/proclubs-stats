-- =============================================================================
-- 017 · Calificación media y % MVP ponderados por MINUTOS jugados.
--
-- Pedido del usuario (2026-11-16): hay jugadores que entran desde la banca y
-- partidos cortos. Verificado con datos reales: un jugador jugó 47 de 92 min y
-- su partido pesaba igual que uno completo en la calificación media y el % MVP.
-- Ahora cada partido pesa según sus segundos de juego:
--   * avg_rating = Σ(calificación × segundos) / Σ(segundos con calificación)
--   * mom_pct    = segundos en partidos donde fue MVP / segundos totales × 100
-- Con todos los partidos completos da lo mismo que antes. El resto de person_stats
-- no cambia (las métricas "por 90" ya usaban los minutos).
-- Misma firma y columnas que en 007 (create or replace).
-- =============================================================================

create or replace function public.person_stats(
  p_match_types        text[]      default null,
  p_from               timestamptz default null,
  p_to                 timestamptz default null,
  p_season             text        default null,
  p_club_id            bigint      default null,
  p_exclude_incomplete boolean     default false
)
returns table (
  person_id bigint, person_name text, main_position text, matches bigint, wins bigint, draws bigint,
  losses bigint, goals bigint, assists bigint, goal_contributions bigint, shots bigint, passes_made bigint,
  pass_attempts bigint, pass_accuracy_pct numeric, tackles_made bigint, tackle_attempts bigint,
  tackle_success_pct numeric, saves bigint, goals_conceded bigint, clean_sheets_def bigint,
  clean_sheets_gk bigint, mom_count bigint, mom_pct numeric, red_cards bigint, avg_rating numeric,
  seconds_played bigint, goals_per_match numeric, assists_per_match numeric, ga_per_match numeric,
  dribbles_exp bigint, interceptions_exp bigint, possession_won_exp bigint, possession_lost_exp bigint,
  aerial_duels_won_exp bigint, fouls_exp bigint, yellow_cards_exp bigint,
  minutes_played numeric, goals_per90 numeric, assists_per90 numeric, ga_per90 numeric,
  shot_conversion_pct numeric, save_pct numeric, clean_sheets bigint, team_goals bigint,
  goal_participation_pct numeric, goal_diff bigint, club_matches bigint, attendance_pct numeric,
  form_rating numeric, rating_stddev numeric, avg_opponent_skill numeric,
  shots_on_target_exp bigint, shot_accuracy_exp_pct numeric, second_assists_exp bigint,
  -- 007
  platforms text,
  incomplete_matches bigint,
  avg_team_size numeric,
  forward_pass_pct_exp numeric,
  through_passes_exp bigint,
  in_position_pct_exp numeric,
  best_option_pct_exp numeric,
  fouls_won_exp bigint,
  offsides_exp bigint,
  penalties_conceded_exp bigint,
  cross_pct_exp numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select * from public.filtered_player_matches(p_match_types, p_from, p_to, p_season, p_club_id, p_exclude_incomplete)
  ),
  agg as (
    select
      v.person_id, v.person_name,
      mode() within group (order by v.position) as main_position,
      count(distinct v.match_id) as matches,
      count(distinct v.match_id) filter (where v.outcome = 'win')  as wins,
      count(distinct v.match_id) filter (where v.outcome = 'draw') as draws,
      count(distinct v.match_id) filter (where v.outcome = 'loss') as losses,
      sum(v.goals) as goals, sum(v.assists) as assists, sum(v.shots) as shots,
      sum(v.passes_made) as passes_made, sum(v.pass_attempts) as pass_attempts,
      sum(v.tackles_made) as tackles_made, sum(v.tackle_attempts) as tackle_attempts,
      sum(v.saves) as saves, sum(v.goals_conceded) as goals_conceded,
      sum(v.clean_sheets_def) as clean_sheets_def, sum(v.clean_sheets_gk) as clean_sheets_gk,
      count(*) filter (where v.is_mom) as mom_count, sum(v.red_cards) as red_cards,
      sum(v.seconds_played) filter (where v.is_mom) as mom_seconds,
      round(sum(v.rating * v.seconds_played) / nullif(sum(v.seconds_played) filter (where v.rating is not null), 0), 2) as avg_rating,
      sum(v.seconds_played) as seconds_played,
      sum(v.dribbles_exp) as dribbles_exp, sum(v.interceptions_exp) as interceptions_exp,
      sum(v.possession_won_exp) as possession_won_exp, sum(v.possession_lost_exp) as possession_lost_exp,
      sum(v.aerial_duels_won_exp) as aerial_duels_won_exp, sum(v.fouls_exp) as fouls_exp,
      sum(v.yellow_cards_exp) as yellow_cards_exp,
      sum(v.saves) filter (where v.position = 'goalkeeper') as gk_saves,
      sum(v.goals_conceded) filter (where v.position = 'goalkeeper') as gk_conceded,
      sum(v.shots_on_target_exp) as shots_on_target_exp, sum(v.shots_off_target_exp) as shots_off_target_exp,
      sum(v.second_assists_exp) as second_assists_exp,
      string_agg(distinct v.platform, ', ') as platforms,
      count(distinct v.match_id) filter (where v.incomplete) as incomplete_matches,
      round(avg(v.team_size), 1) as avg_team_size,
      sum(v.forward_passes_ok_exp) as fwd_ok, sum(v.forward_passes_failed_exp) as fwd_ko,
      sum(v.through_passes_exp) as through_passes_exp,
      sum(v.in_position_exp) as in_pos, sum(v.out_of_position_exp) as out_pos,
      sum(v.best_option_exp) as best_opt, sum(v.should_have_passed_exp) as bad_opt,
      sum(v.fouls_won_exp) as fouls_won_exp, sum(v.offsides_exp) as offsides_exp,
      sum(v.penalties_conceded_exp) as penalties_conceded_exp,
      sum(v.crosses_ok_exp) as cross_ok, sum(v.crosses_failed_exp) as cross_ko
    from base v
    group by v.person_id, v.person_name
  ),
  person_match as (
    select b.person_id, b.match_id, max(b.played_at) as played_at, max(b.goals_for) as gf,
           max(b.goals_against) as ga, max(b.opponent_skill_rating) as opp_skill, avg(b.rating) as rating
    from base b group by b.person_id, b.match_id
  ),
  ranked as (
    select pm.*, row_number() over (partition by pm.person_id order by pm.played_at desc) as rn
    from person_match pm
  ),
  per_person as (
    select r.person_id, sum(r.gf) as team_goals, sum(r.gf - r.ga) as goal_diff,
           avg(r.opp_skill) as avg_opp_skill, avg(r.rating) filter (where r.rn <= 5) as form_rating,
           stddev_samp(r.rating) as rating_stddev
    from ranked r group by r.person_id
  ),
  club as (select count(distinct b.match_id) as n from base b)
  select
    a.person_id, a.person_name, a.main_position, a.matches, a.wins, a.draws, a.losses,
    a.goals, a.assists, a.goals + a.assists, a.shots, a.passes_made, a.pass_attempts,
    round(100.0 * a.passes_made / nullif(a.pass_attempts, 0), 1),
    a.tackles_made, a.tackle_attempts,
    round(100.0 * a.tackles_made / nullif(a.tackle_attempts, 0), 1),
    a.saves, a.goals_conceded, a.clean_sheets_def, a.clean_sheets_gk, a.mom_count,
    round(100.0 * coalesce(a.mom_seconds, 0) / nullif(a.seconds_played, 0), 1),
    a.red_cards, a.avg_rating, a.seconds_played,
    round(a.goals::numeric / a.matches, 2), round(a.assists::numeric / a.matches, 2),
    round((a.goals + a.assists)::numeric / a.matches, 2),
    a.dribbles_exp, a.interceptions_exp, a.possession_won_exp, a.possession_lost_exp,
    a.aerial_duels_won_exp, a.fouls_exp, a.yellow_cards_exp,
    round(a.seconds_played / 60.0, 0),
    round(a.goals * 5400.0 / nullif(a.seconds_played, 0), 2),
    round(a.assists * 5400.0 / nullif(a.seconds_played, 0), 2),
    round((a.goals + a.assists) * 5400.0 / nullif(a.seconds_played, 0), 2),
    round(100.0 * a.goals / nullif(a.shots, 0), 1),
    round(100.0 * a.gk_saves / nullif(a.gk_saves + a.gk_conceded, 0), 1),
    a.clean_sheets_def + a.clean_sheets_gk,
    p.team_goals,
    round(100.0 * (a.goals + a.assists) / nullif(p.team_goals, 0), 1),
    p.goal_diff, c.n,
    round(100.0 * a.matches / nullif(c.n, 0), 1),
    round(p.form_rating, 2), round(p.rating_stddev, 2), round(p.avg_opp_skill, 0),
    a.shots_on_target_exp,
    round(100.0 * a.shots_on_target_exp / nullif(a.shots_on_target_exp + a.shots_off_target_exp, 0), 1),
    a.second_assists_exp,
    a.platforms, a.incomplete_matches, a.avg_team_size,
    round(100.0 * a.fwd_ok / nullif(a.fwd_ok + a.fwd_ko, 0), 1),
    a.through_passes_exp,
    round(100.0 * a.in_pos / nullif(a.in_pos + a.out_pos, 0), 1),
    round(100.0 * a.best_opt / nullif(a.best_opt + a.bad_opt, 0), 1),
    a.fouls_won_exp, a.offsides_exp, a.penalties_conceded_exp,
    round(100.0 * a.cross_ok / nullif(a.cross_ok + a.cross_ko, 0), 1)
  from agg a
  join per_person p on p.person_id = a.person_id
  cross join club c
$$;
