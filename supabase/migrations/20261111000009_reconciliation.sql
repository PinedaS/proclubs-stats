-- =============================================================================
-- 009 · Conciliación: lo que EA sumó a cada miembro desde la PRIMERA foto de
--       members/stats vs. lo que el colector capturó en ese mismo período.
--
-- Si EA sumó más partidos (o goles, asistencias, MVP) de los capturados, es
-- probable que se haya perdido algún partido. Se recalcula siempre desde
-- member_snapshots (fotos diarias, incluidas en el respaldo cifrado), así que
-- no hace falta guardar un registro aparte.
--
-- Pendiente de confirmar con partidos reales: qué tipos de partido cuenta EA en
-- members/stats (¿también amistosos?). Por eso 'extra' no se trata como error.
-- =============================================================================

create view public.v_reconciliation
with (security_invoker = true)
as
with snaps as (
  -- Columnas explícitas: anon no puede leer member_snapshots.raw (y no hace falta).
  select s.club_id, s.member_name, s.snapshot_date, s.captured_at, s.games_played, s.goals,
         s.assists, s.man_of_the_match,
         row_number() over (partition by s.club_id, s.member_name order by s.snapshot_date asc)  as first_rn,
         row_number() over (partition by s.club_id, s.member_name order by s.snapshot_date desc) as last_rn
  from public.member_snapshots s
),
span as (
  select f.club_id, f.member_name,
         f.snapshot_date as first_date, f.captured_at as since, l.snapshot_date as last_date,
         l.games_played - f.games_played         as ea_games,
         l.goals - f.goals                       as ea_goals,
         l.assists - f.assists                   as ea_assists,
         l.man_of_the_match - f.man_of_the_match as ea_mom
  from snaps f
  join snaps l on l.club_id = f.club_id and l.member_name = f.member_name and l.last_rn = 1
  where f.first_rn = 1
),
captured as (
  -- Solo cuentan los partidos del club jugados desde la primera foto (m no nulo).
  -- Se filtra dentro de cada agregado para no perder al miembro sin partidos.
  select sp.club_id, sp.member_name,
         count(distinct st.match_id) filter (where m.match_id is not null)            as cap_games,
         coalesce(sum(st.goals) filter (where m.match_id is not null), 0)             as cap_goals,
         coalesce(sum(st.assists) filter (where m.match_id is not null), 0)           as cap_assists,
         count(*) filter (where m.match_id is not null and st.is_mom)                 as cap_mom
  from span sp
  left join public.accounts a on lower(a.last_known_name) = lower(sp.member_name)
  left join public.player_match_stats st on st.player_id = a.player_id
  left join public.matches m on m.match_id = st.match_id and m.club_id = sp.club_id and m.played_at >= sp.since
  group by sp.club_id, sp.member_name
)
select
  sp.club_id, sp.member_name,
  (select a.person_id from public.accounts a where lower(a.last_known_name) = lower(sp.member_name)
    order by a.last_seen_at desc limit 1) as person_id,
  sp.first_date, sp.last_date,
  sp.ea_games,   c.cap_games,   c.cap_games   - sp.ea_games   as diff_games,
  sp.ea_goals,   c.cap_goals,   c.cap_goals   - sp.ea_goals   as diff_goals,
  sp.ea_assists, c.cap_assists, c.cap_assists - sp.ea_assists as diff_assists,
  sp.ea_mom,     c.cap_mom,     c.cap_mom     - sp.ea_mom     as diff_mom,
  case
    when sp.ea_games is null then 'sin_datos'
    when c.cap_games < sp.ea_games
      or c.cap_goals < sp.ea_goals or c.cap_assists < sp.ea_assists then 'faltan'
    when c.cap_games > sp.ea_games then 'extra'
    else 'ok'
  end as status
from span sp
join captured c on c.club_id = sp.club_id and c.member_name = sp.member_name;

comment on view public.v_reconciliation is
  'Conciliación EA vs. capturado desde la primera foto. status: ok | faltan (posible partido perdido) | extra | sin_datos.';

revoke insert, update, delete, truncate, references, trigger on public.v_reconciliation from anon, authenticated;
grant select on public.v_reconciliation to anon, authenticated, service_role;
