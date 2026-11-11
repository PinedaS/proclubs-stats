-- Imita los roles y privilegios por defecto de Supabase en un Postgres vanilla.
-- Solo para pruebas locales; en Supabase real esto ya existe.
create role anon          nologin noinherit;
create role authenticated nologin noinherit;
create role service_role  nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase concede todo a estos roles en objetos nuevos del esquema public;
-- por eso las migraciones tienen que revocar explícitamente.
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
