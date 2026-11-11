-- =============================================================================
-- 002 · Seguridad: el dashboard (rol anon / authenticated) SOLO lee.
--       Solo el colector escribe, con la clave service_role (que ignora RLS).
--
-- Defensa en profundidad (dos capas):
--   1. RLS activado en todas las tablas, con políticas solo de SELECT.
--   2. Privilegios: se quitan INSERT/UPDATE/DELETE/TRUNCATE a anon/authenticated
--      (Supabase se los concede por defecto en el esquema public).
-- =============================================================================

-- 1. RLS en todas las tablas (sin política = acceso denegado).
alter table public.clubs              enable row level security;
alter table public.persons            enable row level security;
alter table public.accounts           enable row level security;
alter table public.match_raw          enable row level security;
alter table public.matches            enable row level security;
alter table public.player_match_stats enable row level security;
alter table public.collector_runs     enable row level security;

-- 2. Quitar escritura a los roles del cliente.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

-- 3. Lectura explícita (no depender de los privilegios por defecto de Supabase).
grant select on public.clubs,
                public.persons,
                public.accounts,
                public.matches,
                public.player_match_stats
  to anon, authenticated;

-- match_raw: nada para el cliente (pesa ~12 KB por partido y trae datos de rivales).
revoke all on public.match_raw from anon, authenticated;

-- collector_runs: solo columnas no sensibles (error_message puede traer detalles
-- internos). Primero se quita el SELECT de tabla y luego se da por columna.
revoke select on public.collector_runs from anon, authenticated;
grant select (run_id, started_at, finished_at, status, runner, matches_seen, matches_new)
  on public.collector_runs
  to anon, authenticated;

-- 4. Políticas de solo lectura.
create policy clubs_read              on public.clubs              for select to anon, authenticated using (true);
create policy persons_read            on public.persons            for select to anon, authenticated using (true);
create policy accounts_read           on public.accounts           for select to anon, authenticated using (true);
create policy matches_read            on public.matches            for select to anon, authenticated using (true);
create policy player_match_stats_read on public.player_match_stats for select to anon, authenticated using (true);
create policy collector_runs_read     on public.collector_runs     for select to anon, authenticated using (true);
-- match_raw: sin política a propósito.
