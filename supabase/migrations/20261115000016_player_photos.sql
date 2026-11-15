-- =============================================================================
-- 016 · Fotos de los jugadores (Supabase Storage).
--
-- Decisión del usuario (2026-11-15): CUALQUIERA con el enlace puede cambiar o
-- quitar la foto de cualquier jugador, sin iniciar sesión. Se le explicó el
-- riesgo (un desconocido podría poner una imagen ofensiva; solo se puede volver
-- a cambiar) y lo aceptó. Para acotar el daño posible:
--   * solo imágenes webp/jpeg/png de hasta 200 KB (el dashboard las achica a
--     256 px webp antes de subir);
--   * UNA foto por jugador: el nombre del archivo es "<person_id>.webp" y solo
--     se aceptan ids de personas que existen. El espacio usado no puede crecer
--     sin control (nº de personas × 200 KB como máximo);
--   * nadie puede crear carpetas ni archivos con otros nombres.
-- Costo: Storage está incluido en el plan Free (1 GB); verificado en la página
-- de precios de Supabase el 2026-11-15. Sin cargos por exceso en Free.
--
-- En el Postgres de pruebas (Docker) no existe el esquema storage: se omite.
-- =============================================================================

do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage no disponible (entorno de pruebas): se omiten las fotos';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('player-photos', 'player-photos', true, 204800, array['image/webp', 'image/jpeg', 'image/png'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- Nombre válido: "<id de una persona existente>.webp", en la raíz del bucket.
  execute $p$
    create or replace function public.is_valid_player_photo_name(p_name text)
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $f$
      select p_name ~ '^[0-9]{1,18}\.webp$'
         and exists (select 1 from public.persons p where p.person_id = split_part(p_name, '.', 1)::bigint)
    $f$
  $p$;
  execute 'revoke all on function public.is_valid_player_photo_name(text) from public';
  execute 'grant execute on function public.is_valid_player_photo_name(text) to anon, authenticated, service_role';

  -- Políticas (RLS) de storage.objects solo para este bucket.
  execute 'drop policy if exists player_photos_read on storage.objects';
  execute 'drop policy if exists player_photos_insert on storage.objects';
  execute 'drop policy if exists player_photos_update on storage.objects';
  execute 'drop policy if exists player_photos_delete on storage.objects';

  -- Ver y listar (el dashboard lista para saber qué jugadores tienen foto).
  execute $p$ create policy player_photos_read on storage.objects for select to anon, authenticated
            using (bucket_id = 'player-photos') $p$;
  -- Subir y reemplazar (upsert = insert + update).
  execute $p$ create policy player_photos_insert on storage.objects for insert to anon, authenticated
            with check (bucket_id = 'player-photos' and public.is_valid_player_photo_name(name)) $p$;
  execute $p$ create policy player_photos_update on storage.objects for update to anon, authenticated
            using (bucket_id = 'player-photos')
            with check (bucket_id = 'player-photos' and public.is_valid_player_photo_name(name)) $p$;
  -- Quitar la foto (volver a las iniciales).
  execute $p$ create policy player_photos_delete on storage.objects for delete to anon, authenticated
            using (bucket_id = 'player-photos') $p$;
end $$;
