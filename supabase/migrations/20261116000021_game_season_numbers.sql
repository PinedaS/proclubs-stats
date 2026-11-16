-- =============================================================================
-- 021 · Las temporadas se numeran COMO EL JUEGO (corrección pedida por el
-- usuario, 2026-11-16). En la 020 se contaban desde que empezamos a registrar
-- al club, y la cabecera decía "Temporada 1" cuando el juego va en la 2.
--
-- Fuente (no oficial; EA no da el número en la API): calendario de PRO11.
-- Temporada 1 de FC 27: 21-ago al 22-oct-2026 06:59 UTC. Temporada 2: desde el
-- 22-oct-2026 hasta el 3-dic-2026. Las temporadas van por fecha y son iguales
-- para todos los clubes, así que un club nuevo entra en la temporada en curso
-- del juego (lo hace el colector) y cada reinicio de EA suma 1.
-- =============================================================================

alter table public.club_seasons drop constraint club_seasons_detected_by_check;
alter table public.club_seasons add constraint club_seasons_detected_by_check
  check (detected_by in ('inicio del registro', 'reinicio de EA', 'calendario del juego'));

-- La temporada en curso de los clubes de FC 27 es la 2 del juego, desde el 22-oct.
update public.club_seasons s
   set season_no  = 2,
       started_at = timestamptz '2026-10-22 07:00:00+00',
       detected_by = 'calendario del juego'
  from public.clubs c
 where c.club_id = s.club_id
   and c.season = 'FC27'
   and s.season_no = 1
   and s.ended_at is null
   and s.started_at >= timestamptz '2026-10-22 07:00:00+00';
