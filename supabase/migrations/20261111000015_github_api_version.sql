-- =============================================================================
-- 015 · Disparo: versión de la API de GitHub 2022-11-28 -> 2026-03-10.
--
-- Verificado el 2026-11-11: las respuestas de GitHub al disparo traían los
-- encabezados Deprecation (10-mar-2026) y Sunset (10-mar-2028) para la versión
-- 2022-11-28; después de esa fecha respondería 410 y el disparo dejaría de andar.
-- Según "Breaking changes" de la documentación de GitHub, el único cambio de
-- 2026-03-10 que afecta a este endpoint: workflow dispatch responde 200 (con
-- datos de la ejecución) en vez de 204. dispatch_status() ya acepta cualquier 2xx.
-- Misma firma y permisos que en 010 (create or replace conserva los revoke).
-- =============================================================================

create or replace function public.dispatch_collector()
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
      'X-GitHub-Api-Version', '2026-03-10',
      'User-Agent', 'proclubs-stats-supabase-cron'
    ),
    body    := jsonb_build_object('ref', 'main'),
    timeout_milliseconds := 10000
  ) into v_request_id;

  return v_request_id;
end;
$$;
