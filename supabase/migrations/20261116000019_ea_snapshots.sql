-- =============================================================================
-- 019 · Capturar todo lo que da EA (pedido del usuario, 2026-11-16: "no quiero
-- que se nos escape ningún dato").
--
--   1. ea_snapshots: el JSON COMPLETO de cada endpoint de EA, una fila por club
--      consultado, endpoint y día (se pisa en cada ejecución del día). Cubre lo
--      que antes no se guardaba: clubs/info, club/playoffAchievements y
--      members/career/stats de nuestro club, y la foto de cada RIVAL
--      (clubs/overallStats y su fila del ranking de la temporada) al capturar
--      el partido. Lo crudo de NUESTRO overallStats, ranking y members/stats ya
--      se guarda en club_snapshots.raw y member_snapshots.raw (no se duplica).
--      Igual que match_raw: no la lee el dashboard (anon), porque trae datos de
--      terceros; sirve para reprocesar después sin depender de EA.
--   2. matches.opponent_division: división del rival (número de EA tal cual),
--      solo en partidos nuevos de menos de 6 h, como club_division (014): un
--      partido más viejo pudo jugarse cuando el rival estaba en otra división.
-- =============================================================================

create table public.ea_snapshots (
  -- Club del que se hizo la captura (el nuestro). Al borrarlo (purge_club) se borra todo.
  for_club_id   bigint      not null references public.clubs (club_id) on delete cascade,
  -- Club consultado: el nuestro o un rival.
  club_id       bigint      not null,
  endpoint      text        not null check (endpoint in (
                  'clubs/info', 'clubs/overallStats', 'currentSeasonLeaderboard',
                  'members/stats', 'members/career/stats', 'club/playoffAchievements')),
  snapshot_date date        not null,
  captured_at   timestamptz not null default now(),
  is_opponent   boolean     not null default false,
  payload       jsonb       not null,
  primary key (for_club_id, club_id, endpoint, snapshot_date)
);

create index ea_snapshots_club_idx on public.ea_snapshots (club_id, endpoint, snapshot_date);

comment on table public.ea_snapshots is
  'JSON completo de cada endpoint de EA por club consultado y día (el nuestro y los rivales). Para reprocesar; no lo lee el dashboard.';

alter table public.ea_snapshots enable row level security;
-- Sin política para el cliente, igual que match_raw: anon no lo lee.
revoke all on public.ea_snapshots from anon, authenticated;
grant select, insert, update, delete on public.ea_snapshots to service_role;

-- -----------------------------------------------------------------------------
-- 2. División del rival. anon ya lee matches completa.
-- -----------------------------------------------------------------------------
alter table public.matches add column opponent_division smallint
  check (opponent_division is null or opponent_division between 1 and 20);

comment on column public.matches.opponent_division is
  'División del rival al capturar el partido (número de EA; el juego muestra uno menos). Solo partidos nuevos de menos de 6 h.';
