-- =============================================================================
-- 010 · Disparador confiable del colector desde Supabase (gratis).
--
-- Verificado el 2026-11-11: el cron de GitHub Actions ejecutó 1 de ~25 corridas
-- programadas en 12,5 h. Para no perder partidos (EA solo guarda los últimos 10),
-- Supabase le pide a GitHub ejecutar el colector cada 15 min vía la API
-- workflow_dispatch. El cron de GitHub queda como respaldo; el workflow usa
-- `concurrency`, así que dos disparos seguidos no se solapan.
--
--   * pg_cron: tareas programadas dentro de Postgres (incluido en Supabase Free).
--   * pg_net:  peticiones HTTP asíncronas desde Postgres (incluido en Supabase Free).
--   * El token de GitHub vive en Supabase Vault (cifrado), con el nombre
--     'github_dispatch_token'. Lo carga el usuario desde el panel; nunca va en el repo.
--
-- En el Postgres de pruebas (Docker) estas extensiones no existen: la migración
-- las omite con un aviso para que las pruebas sigan funcionando.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  else
    raise notice 'pg_net no disponible (entorno de pruebas): se omite';
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  else
    raise notice 'pg_cron no disponible (entorno de pruebas): se omite';
  end if;
end $$;

-- Pide a GitHub ejecutar collect.yml en main. Devuelve el id de la petición de
-- pg_net (la respuesta queda en net._http_response por unas horas), o null si
-- todavía no hay token en Vault.
-- plpgsql (no sql): así no se valida al crearla que existan vault/net, que solo
-- existen en Supabase.
create function public.dispatch_collector()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_request_id bigint;
begin
  select ds.decrypted_secret into v_token
    from vault.decrypted_secrets ds
   where ds.name = 'github_dispatch_token'
   limit 1;

  if v_token is null or v_token = '' then
    raise notice 'dispatch_collector: falta el secreto github_dispatch_token en Vault';
    return null;
  end if;

  select net.http_post(
    url     := 'https://api.github.com/repos/PinedaS/proclubs-stats/actions/workflows/collect.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'proclubs-stats-supabase-cron'
    ),
    body    := jsonb_build_object('ref', 'main'),
    timeout_milliseconds := 10000
  ) into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.dispatch_collector() is
  'Dispara el workflow collect.yml en GitHub (workflow_dispatch) con el token de Vault github_dispatch_token.';

-- Solo el dueño (postgres) y pg_cron la ejecutan: nadie desde la API.
revoke execute on function public.dispatch_collector() from public, anon, authenticated, service_role;

-- Programación: minutos 2, 17, 32 y 47 (desfasado del cron de GitHub, que usa 7 y 37).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'dispatch-collector';
    perform cron.schedule('dispatch-collector', '2,17,32,47 * * * *', 'select public.dispatch_collector()');
  else
    raise notice 'pg_cron no instalado: no se programa el disparo';
  end if;
end $$;
