-- =============================================================================
-- 007 · Foto diaria del club, plataforma por cuenta, tamaño del equipo,
--       partidos incompletos, más experimentales y funciones de análisis
--       (comparativas, duplas, por posición, récords y rachas).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Foto diaria del club: clubs/overallStats + ranking de la temporada actual.
-- -----------------------------------------------------------------------------
create table public.club_snapshots (
  club_id            bigint      not null references public.clubs (club_id) on delete cascade,
  snapshot_date      date        not null,
  captured_at        timestamptz not null default now(),
  skill_rating       integer,
  current_division   smallint,
  best_division      smallint,
  season_points      integer,
  season_games       integer,
  season_wins        integer,
  season_draws       integer,
  season_losses      integer,
  season_goals       integer,
  season_goals_against integer,
  games_played       integer,   -- históricos del club
  wins               integer,
  draws              integer,
  losses             integer,
  promotions         integer,
  relegations        integer,
  win_streak         integer,
  unbeaten_streak    integer,
  raw                jsonb       not null,
  primary key (club_id, snapshot_date)
);

alter table public.club_snapshots enable row level security;
create policy club_snapshots_read on public.club_snapshots for select to anon, authenticated using (true);
revoke all on public.club_snapshots from anon, authenticated;
grant select (club_id, snapshot_date, captured_at, skill_rating, current_division, best_division, season_points,
              season_games, season_wins, season_draws, season_losses, season_goals, season_goals_against,
              games_played, wins, draws, losses, promotions, relegations, win_streak, unbeaten_streak)
  on public.club_snapshots to anon, authenticated;
grant select, insert, update, delete on public.club_snapshots to service_role;

-- -----------------------------------------------------------------------------
-- 2. Plataforma (ps5, pc, xbox-series…), según derivedLabels del SDK.
-- -----------------------------------------------------------------------------
alter table public.player_match_stats add column platform text;
alter table public.accounts           add column platform text;

update public.player_match_stats s
   set platform = r.payload -> 'players' -> (r.club_id::text) -> s.player_id -> 'derivedLabels' ->> 'exactPlatform'
  from public.match_raw r
 where r.match_id = s.match_id and s.platform is null;

update public.accounts a
   set platform = x.platform
  from (select distinct on (s.player_id) s.player_id, s.platform
          from public.player_match_stats s join public.matches m on m.match_id = s.match_id
         where s.platform is not null
         order by s.player_id, m.played_at desc) x
 where x.player_id = a.player_id and a.platform is null;

-- -----------------------------------------------------------------------------
-- 3. Vista por partido: tamaño del equipo, partido incompleto, plataforma y
--    más experimentales (columnas nuevas al final).
--    incomplete: abandono (winner_by_dnf) o nadie de nuestro equipo llegó a
--    4860 s de juego (90 % de un partido normal de 5400 s).
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
  -- 007
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
  public.event_sum(s.event_counts, array['37'])                as crosses_failed_exp
from public.player_match_stats s
join public.matches  m on m.match_id  = s.match_id
join public.clubs    c on c.club_id   = m.club_id
join public.accounts a on a.player_id = s.player_id
join public.persons  p on p.person_id = a.person_id;

-- -----------------------------------------------------------------------------
-- 4. Filas filtradas: base común de TODAS las funciones de análisis.
-- -----------------------------------------------------------------------------
create function public.filtered_player_matches(
  p_match_types        text[]      default null,
  p_from               timestamptz default null,
  p_to                 timestamptz default null,
  p_season             text        default null,
  p_club_id            bigint      default null,
  p_exclude_incomplete boolean     default false
)
returns setof public.v_player_match_stats
language sql
stable
security invoker
set search_path = ''
as $$
  select v.*
  from public.v_player_match_stats v
  where (p_match_types is null or v.match_type = any (p_match_types))
    and (p_from        is null or v.played_at >= p_from)
    and (p_to          is null or v.played_at <  p_to)
    and (p_season      is null or v.season    =  p_season)
    and (p_club_id     is null or v.club_id   =  p_club_id)
    and (not coalesce(p_exclude_incomplete, false) or not v.incomplete)
$$;

-- -----------------------------------------------------------------------------
-- 5. person_stats: + filtro de incompletos, plataformas y más experimentales.
-- -----------------------------------------------------------------------------
drop view public.v_person_totals;
drop function public.person_stats(text[], timestamptz, timestamptz, text, bigint);

create function public.person_stats(
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
      round(avg(v.rating), 2) as avg_rating, sum(v.seconds_played) as seconds_played,
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
    round(100.0 * a.mom_count / a.matches, 1),
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

create view public.v_person_totals
with (security_invoker = true)
as
select * from public.person_stats();

-- -----------------------------------------------------------------------------
-- 6. Comparativas: rendimiento de cada persona partido por "grupo".
--    p_split: 'rival' (fuerte/débil según la mediana del nivel rival en el rango),
--             'type' (liga / play-off / amistoso), 'team_size' (nº de jugadores).
-- -----------------------------------------------------------------------------
create function public.person_split_stats(
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
      end as bucket,
      case p_split
        when 'rival' then case when b.opponent_skill_rating is null then 3
                               when b.opponent_skill_rating >= (select m from med) then 1 else 2 end
        when 'type' then case b.match_type when 'leagueMatch' then 1 when 'playoffMatch' then 2 else 3 end
        when 'team_size' then b.team_size::integer
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
-- 7. Duplas: resultados de cada pareja de personas cuando juegan juntas.
-- -----------------------------------------------------------------------------
create function public.pair_stats(
  p_match_types        text[]      default null,
  p_from               timestamptz default null,
  p_to                 timestamptz default null,
  p_season             text        default null,
  p_club_id            bigint      default null,
  p_exclude_incomplete boolean     default false
)
returns table (
  person_a_id bigint, person_a text, person_b_id bigint, person_b text, matches bigint,
  wins bigint, draws bigint, losses bigint, win_pct numeric, goals_for_avg numeric,
  goals_against_avg numeric, goal_diff bigint, combined_ga bigint
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
           max(b.goals_for) as gf, max(b.goals_against) as ga, sum(b.goals + b.assists) as ga_contrib
    from base b group by b.person_id, b.match_id
  )
  select x.person_id, x.person_name, y.person_id, y.person_name,
         count(*),
         count(*) filter (where x.outcome = 'win'),
         count(*) filter (where x.outcome = 'draw'),
         count(*) filter (where x.outcome = 'loss'),
         round(100.0 * count(*) filter (where x.outcome = 'win') / count(*), 1),
         round(avg(x.gf), 2), round(avg(x.ga), 2),
         sum(x.gf - x.ga),
         sum(x.ga_contrib + y.ga_contrib)::bigint
  from pm x
  join pm y on y.match_id = x.match_id and y.person_id > x.person_id
  group by x.person_id, x.person_name, y.person_id, y.person_name
$$;

-- -----------------------------------------------------------------------------
-- 8. Por posición: rendimiento de cada persona en cada posición que jugó.
-- -----------------------------------------------------------------------------
create function public.position_stats(
  p_match_types        text[]      default null,
  p_from               timestamptz default null,
  p_to                 timestamptz default null,
  p_season             text        default null,
  p_club_id            bigint      default null,
  p_exclude_incomplete boolean     default false
)
returns table (
  person_id bigint, person_name text, player_position text, matches bigint, avg_rating numeric,
  goals bigint, assists bigint, ga_per90 numeric, pass_accuracy_pct numeric,
  tackle_success_pct numeric, mom_pct numeric, win_pct numeric, clean_sheets bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.person_id, b.person_name, b.position,
         count(distinct b.match_id),
         round(avg(b.rating), 2),
         sum(b.goals), sum(b.assists),
         round((sum(b.goals) + sum(b.assists)) * 5400.0 / nullif(sum(b.seconds_played), 0), 2),
         round(100.0 * sum(b.passes_made) / nullif(sum(b.pass_attempts), 0), 1),
         round(100.0 * sum(b.tackles_made) / nullif(sum(b.tackle_attempts), 0), 1),
         round(100.0 * count(*) filter (where b.is_mom) / count(distinct b.match_id), 1),
         round(100.0 * count(distinct b.match_id) filter (where b.outcome = 'win') / count(distinct b.match_id), 1),
         sum(b.clean_sheets_def + b.clean_sheets_gk)
  from public.filtered_player_matches(p_match_types, p_from, p_to, p_season, p_club_id, p_exclude_incomplete) b
  group by b.person_id, b.person_name, b.position
$$;

-- -----------------------------------------------------------------------------
-- 9. Récords y rachas por persona (rachas en partidos consecutivos que jugó).
-- -----------------------------------------------------------------------------
create function public.person_records(
  p_match_types        text[]      default null,
  p_from               timestamptz default null,
  p_to                 timestamptz default null,
  p_season             text        default null,
  p_club_id            bigint      default null,
  p_exclude_incomplete boolean     default false
)
returns table (
  person_id bigint, person_name text, max_goals_match bigint, hat_tricks bigint,
  max_assists_match bigint, max_ga_match bigint, best_rating numeric,
  longest_scoring_streak bigint, longest_mom_streak bigint, longest_unbeaten_streak bigint,
  current_unbeaten_streak bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with pm as (
    select b.person_id, max(b.person_name) as person_name, b.match_id, max(b.played_at) as played_at,
           sum(b.goals) as goals, sum(b.assists) as assists, max(b.rating) as rating,
           bool_or(b.is_mom) as mom, max(b.outcome) as outcome
    from public.filtered_player_matches(p_match_types, p_from, p_to, p_season, p_club_id, p_exclude_incomplete) b
    group by b.person_id, b.match_id
  ),
  seq as (
    select pm.*,
           row_number() over (partition by pm.person_id order by pm.played_at) as n,
           row_number() over (partition by pm.person_id order by pm.played_at desc) as n_desc
    from pm
  ),
  -- "Islas": partidos consecutivos que cumplen la condición comparten (n - rank dentro de la condición).
  flags as (
    select s.*,
           s.n - row_number() over (partition by s.person_id, (s.goals > 0) order by s.played_at) as g_scoring,
           s.n - row_number() over (partition by s.person_id, s.mom order by s.played_at) as g_mom,
           s.n - row_number() over (partition by s.person_id, (s.outcome <> 'loss') order by s.played_at) as g_unbeaten
    from seq s
  ),
  streaks as (
    select f.person_id,
           max(c) filter (where kind = 'scoring')  as scoring,
           max(c) filter (where kind = 'mom')      as mom,
           max(c) filter (where kind = 'unbeaten') as unbeaten
    from (
      select person_id, 'scoring' as kind, count(*) as c from flags where goals > 0 group by person_id, g_scoring
      union all
      select person_id, 'mom', count(*) from flags where mom group by person_id, g_mom
      union all
      select person_id, 'unbeaten', count(*) from flags where outcome <> 'loss' group by person_id, g_unbeaten
    ) f
    group by f.person_id
  ),
  current_unbeaten as (
    -- Partidos sin perder desde el más reciente hacia atrás.
    select s.person_id,
           coalesce(min(s.n_desc) filter (where s.outcome = 'loss') - 1, count(*)) as c
    from seq s group by s.person_id
  )
  select pm.person_id, max(pm.person_name),
         max(pm.goals), count(*) filter (where pm.goals >= 3), max(pm.assists),
         max(pm.goals + pm.assists), max(pm.rating),
         coalesce(max(st.scoring), 0), coalesce(max(st.mom), 0), coalesce(max(st.unbeaten), 0),
         max(cu.c)
  from pm
  left join streaks st on st.person_id = pm.person_id
  left join current_unbeaten cu on cu.person_id = pm.person_id
  group by pm.person_id
$$;

-- -----------------------------------------------------------------------------
-- 10. Permisos.
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger on public.v_person_totals from anon, authenticated;
grant select on public.v_person_totals to anon, authenticated, service_role;

grant execute on function public.filtered_player_matches(text[], timestamptz, timestamptz, text, bigint, boolean) to anon, authenticated, service_role;
grant execute on function public.person_stats(text[], timestamptz, timestamptz, text, bigint, boolean)            to anon, authenticated, service_role;
grant execute on function public.person_split_stats(text, text[], timestamptz, timestamptz, text, bigint, boolean) to anon, authenticated, service_role;
grant execute on function public.pair_stats(text[], timestamptz, timestamptz, text, bigint, boolean)              to anon, authenticated, service_role;
grant execute on function public.position_stats(text[], timestamptz, timestamptz, text, bigint, boolean)          to anon, authenticated, service_role;
grant execute on function public.person_records(text[], timestamptz, timestamptz, text, bigint, boolean)          to anon, authenticated, service_role;
