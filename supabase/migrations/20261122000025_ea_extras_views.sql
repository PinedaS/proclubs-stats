-- =============================================================================
-- 025 · Datos de EA que se guardaban y no se mostraban (pedido del usuario,
-- 2026-11-22: carrera de cada miembro, logros en play-off, foto de cada rival y
-- perfil del Pro).
--
-- ea_snapshots y member_snapshots.raw siguen cerrados para el dashboard (anon), como
-- decidió la 019: traen el JSON completo, también de terceros. Estas vistas exponen
-- SOLO los campos que el dashboard usa. Son vistas del dueño (sin security_invoker),
-- a propósito: así anon lee estas columnas sin poder leer la tabla cruda.
--
-- Verificado el 2026-11-22 con EA: members/career/stats es la carrera TOTAL de cada
-- jugador en el juego (todos sus clubes): PinedaDS 56 partidos = 34 en 100 D CILANTRO
-- + 22 en FC Aston Huila; goles 40 = 19 + 21; asistencias 33 = 21 + 12; MVP 12 = 8 + 4.
-- =============================================================================

-- 1. Carrera de cada miembro (la foto más reciente de cada club).
create view public.v_member_career as
with last as (
  select distinct on (e.for_club_id) e.for_club_id, e.snapshot_date, e.payload
  from public.ea_snapshots e
  where e.endpoint = 'members/career/stats' and e.club_id = e.for_club_id and not e.is_opponent
  order by e.for_club_id, e.snapshot_date desc
)
select
  l.for_club_id                                   as club_id,
  l.snapshot_date,
  m ->> 'name'                                    as member_name,
  nullif(m ->> 'gamesPlayed', '')::integer        as games_played,
  nullif(m ->> 'goals', '')::integer              as goals,
  nullif(m ->> 'assists', '')::integer            as assists,
  nullif(m ->> 'ratingAve', '')::numeric          as rating_avg,
  nullif(m ->> 'manOfTheMatch', '')::integer      as man_of_the_match,
  m ->> 'favoritePosition'                        as favorite_position
from last l
cross join lateral jsonb_array_elements(coalesce(l.payload -> 'members', '[]'::jsonb)) m;

comment on view public.v_member_career is
  'Carrera total de cada miembro en el juego según EA (todos sus clubes), de la foto más reciente de members/career/stats.';

-- 2. Logros en play-off del club (la foto más reciente; cada elemento tal cual lo da EA).
create view public.v_playoff_achievements as
with last as (
  select distinct on (e.for_club_id) e.for_club_id, e.snapshot_date, e.payload
  from public.ea_snapshots e
  where e.endpoint = 'club/playoffAchievements' and e.club_id = e.for_club_id and not e.is_opponent
  order by e.for_club_id, e.snapshot_date desc
)
select l.for_club_id as club_id, l.snapshot_date, a.entry, a.ord::integer as ord
from last l
cross join lateral jsonb_array_elements(case when jsonb_typeof(l.payload) = 'array' then l.payload else '[]'::jsonb end)
  with ordinality as a(entry, ord);

comment on view public.v_playoff_achievements is
  'Logros en play-off del club según EA (club/playoffAchievements), un elemento por fila, tal cual.';

-- 3. Foto de cada rival al enfrentarlo: datos del club (overallStats) y su fila del
--    ranking de la temporada. Son datos públicos de nivel club, sin jugadores.
create view public.v_opponent_snapshots as
select
  o.for_club_id,
  o.club_id                                                   as opponent_club_id,
  o.snapshot_date,
  nullif(o.payload ->> 'skillRating', '')::integer            as skill_rating,
  nullif(o.payload ->> 'gamesPlayed', '')::integer            as games_played,
  nullif(o.payload ->> 'wins', '')::integer                   as wins,
  nullif(o.payload ->> 'ties', '')::integer                   as ties,
  nullif(o.payload ->> 'losses', '')::integer                 as losses,
  nullif(o.payload ->> 'goals', '')::integer                  as goals,
  nullif(o.payload ->> 'goalsAgainst', '')::integer           as goals_against,
  nullif(o.payload ->> 'promotions', '')::integer             as promotions,
  nullif(o.payload ->> 'relegations', '')::integer            as relegations,
  nullif(s.payload ->> 'currentDivision', '')::integer        as current_division,
  nullif(s.payload ->> 'points', '')::integer                 as season_points,
  coalesce(s.payload -> 'clubInfo' ->> 'name', s.payload ->> 'clubName') as name
from public.ea_snapshots o
left join public.ea_snapshots s
  on s.for_club_id = o.for_club_id and s.club_id = o.club_id and s.snapshot_date = o.snapshot_date
 and s.endpoint = 'currentSeasonLeaderboard'
where o.endpoint = 'clubs/overallStats' and o.is_opponent;

comment on view public.v_opponent_snapshots is
  'Foto de cada club rival el día que lo enfrentamos (nivel, récord, ascensos, división y puntos de la temporada), según EA.';

-- 4. Perfil del Pro: la nacionalidad está solo en el JSON crudo de members/stats.
--    El resto del perfil (nombre del Pro, altura, posición favorita) ya lo lee anon.
create view public.v_member_profile as
select distinct on (ms.club_id, ms.member_name)
  ms.club_id, ms.member_name, ms.snapshot_date,
  ms.pro_name, ms.pro_height, ms.favorite_position,
  ms.raw -> 'nationality' ->> 'label'   as nationality,
  ms.raw -> 'nationality' ->> 'isoCode' as nationality_iso
from public.member_snapshots ms
order by ms.club_id, ms.member_name, ms.snapshot_date desc;

comment on view public.v_member_profile is
  'Perfil del Pro de cada miembro (foto más reciente): nombre, altura, posición favorita y nacionalidad.';

grant select on public.v_member_career, public.v_playoff_achievements, public.v_opponent_snapshots, public.v_member_profile
  to anon, authenticated, service_role;
