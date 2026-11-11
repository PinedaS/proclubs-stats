-- =============================================================================
-- 014 · Mejoras (2026-11-11):
--   1. Estado del disparo desde Supabase, visible en el dashboard: si el token
--      de GitHub vence o falla, se nota sin entrar a Supabase.
--   3. División del club anotada AL CAPTURAR cada partido nuevo y reciente
--      (el colector la escribe en matches.club_division; menos de 6 h desde el
--      partido). Es más precisa que la foto diaria, que sigue como respaldo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. División anotada por el colector. anon ya lee matches completa.
-- -----------------------------------------------------------------------------
alter table public.matches add column club_division smallint
  check (club_division is null or club_division between 1 and 20);

comment on column public.matches.club_division is
  'División del club al capturar el partido (solo partidos nuevos de menos de 6 h). Null = usar la foto diaria.';

-- -----------------------------------------------------------------------------
-- 2. La vista prefiere la división anotada; si falta, la de la foto diaria.
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
  -- 011 (014: primero la división anotada al capturar; si no hay, la foto diaria)
  coalesce(m.club_division, (select cs.current_division
     from public.club_snapshots cs
    where cs.club_id = m.club_id
      and cs.snapshot_date <= (m.played_at at time zone 'UTC')::date
      and cs.current_division is not null
    order by cs.snapshot_date desc
    limit 1))                                                  as club_division
from public.player_match_stats s
join public.matches  m on m.match_id  = s.match_id
join public.clubs    c on c.club_id   = m.club_id
join public.accounts a on a.player_id = s.player_id
join public.persons  p on p.person_id = a.person_id;;

-- -----------------------------------------------------------------------------
-- 3. Estado del disparo (pg_cron -> pg_net -> GitHub). SECURITY DEFINER porque
--    anon no puede leer vault ni net; solo devuelve datos no sensibles: si hay
--    token (sí/no), cuándo fue la última respuesta, su código HTTP y conteos.
--    Nunca el token ni el cuerpo de la respuesta.
--    pg_net guarda las respuestas unas 6 h; solo este proyecto usa pg_net.
--    Sin pg_net/vault (entorno de pruebas) devuelve una fila "no disponible".
-- -----------------------------------------------------------------------------
create function public.dispatch_status()
returns table (
  available boolean, token_configured boolean, last_response_at timestamptz,
  last_status_code integer, last_problem text, ok_recent bigint, failed_recent bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if to_regclass('vault.secrets') is null or to_regclass('net._http_response') is null then
    return query select false, false, null::timestamptz, null::integer, null::text, 0::bigint, 0::bigint;
    return;
  end if;
  return query
  with r as (select * from net._http_response),
       last as (select * from r order by r.created desc limit 1)
  select true,
         exists (select 1 from vault.secrets s where s.name = 'github_dispatch_token'),
         (select l.created from last l),
         (select l.status_code from last l),
         (select case when l.timed_out then 'tiempo de espera agotado'
                      when l.error_msg is not null then 'error de red'
                      when l.status_code in (401, 403) then 'token vencido, revocado o sin permiso'
                      when l.status_code = 404 then 'workflow o repositorio no encontrado'
                      when l.status_code >= 300 then 'respuesta inesperada de GitHub'
                 end from last l),
         (select count(*) from r where r.status_code between 200 and 299),
         (select count(*) from r where r.status_code is null or r.status_code not between 200 and 299);
end;
$$;

revoke execute on function public.dispatch_status() from public;
grant execute on function public.dispatch_status() to anon, authenticated, service_role;
