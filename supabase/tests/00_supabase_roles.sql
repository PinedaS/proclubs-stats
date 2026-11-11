-- Imita los roles de Supabase en un Postgres vanilla. Solo para pruebas locales;
-- en Supabase real esto ya existe.
--
-- Simula un proyecto con "Automatically expose new tables" DESACTIVADO (como el
-- real): las tablas nuevas NO dan privilegios automáticos a los roles de la API,
-- así que las migraciones tienen que concederlos explícitamente (ver 004).
-- Las funciones sí se simulan con EXECUTE por defecto: es el caso más exigente
-- para las pruebas de seguridad (las migraciones deben revocarlo).
create role anon          nologin noinherit;
create role authenticated nologin noinherit;
create role service_role  nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
