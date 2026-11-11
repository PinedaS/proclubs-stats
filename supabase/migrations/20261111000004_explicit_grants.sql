-- =============================================================================
-- 004 · Permisos explícitos para los roles de la API.
--
-- El proyecto de Supabase se creó con "Automatically expose new tables"
-- DESACTIVADO (lo que Supabase recomienda): las tablas nuevas no reciben
-- privilegios automáticos. Así que se conceden aquí, a mano:
--   * service_role (el colector): lectura y escritura. Ignora RLS.
--   * anon/authenticated (el dashboard): solo lectura, ya concedida en 002/003.
-- Es idempotente: funciona igual con la opción activada o desactivada.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
