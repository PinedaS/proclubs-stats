# Base de datos (Supabase Postgres)

## Migraciones

Se aplican en orden; los nombres siguen el formato del Supabase CLI (`AAAAMMDDhhmmss_nombre.sql`).

| Archivo | Qué hace |
|---|---|
| `20261110000001_core_schema.sql` | Tablas, índices, trigger de personas y funciones de administración. |
| `20261110000002_rls_read_only.sql` | RLS y privilegios: `anon`/`authenticated` solo leen; `match_raw` queda oculto. |
| `20261110000003_stats_views.sql` | Vistas y la función `person_stats()` que usa el dashboard. |

### Cómo aplicarlas

**Opción A, panel web (lo más simple):** en Supabase → *SQL Editor*, pega y ejecuta cada archivo en orden.

**Opción B, Supabase CLI (recomendada a largo plazo, deja historial de migraciones):**

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <tu-project-ref>
```

```bash
npx supabase db push
```

## Pruebas locales (Docker)

Desde WSL o Linux, con Docker:

```bash
bash supabase/tests/run_tests.sh
```

Levanta un Postgres 17 desechable, simula los roles de Supabase (`anon`, `authenticated`, `service_role` y sus privilegios por defecto), aplica las migraciones y corre [`tests/01_schema_test.sql`](tests/01_schema_test.sql). Este archivo prueba la idempotencia del *upsert*, el trigger de personas, `merge_persons`, el RLS de solo lectura, `person_stats` y `purge_club`. El contenedor se borra al terminar.

**Límite:** es una imitación de Supabase, no Supabase. Aplicar las migraciones al proyecto real sigue siendo la validación final.

## Modelo

```
clubs 1─* matches 1─* player_match_stats *─1 accounts *─1 persons
clubs 1─* match_raw          (sin FK a matches, a propósito)
clubs 1─* collector_runs
```

- **`persons`** agrupa cuentas. Cada cuenta nueva crea su persona automáticamente (trigger).
- **`player_match_stats` no guarda `person_id`**: se resuelve vía `accounts`, así que unir cuentas corrige también el historial.
- **Solo se normalizan los jugadores de nuestro club.** Los rivales quedan en `match_raw.payload`.

## Contrato para el colector (orden de escritura)

1. Upsert de `clubs` (el club encontrado por nombre).
2. Insert en `collector_runs` con `status = 'running'`.
3. Por cada partido:
   1. Upsert de **`match_raw` primero**. Así el partido queda a salvo aunque falle la normalización.
   2. Upsert de `matches`.
   3. Upsert de `accounts` sin `person_id` (el trigger lo resuelve; no se pisa en un upsert existente).
   4. Upsert de `player_match_stats`.
4. Update de `collector_runs` con `success` o `error`, y salida con código ≠ 0 si hubo error.

Todos los upserts van por llave natural (`match_id`, `player_id`, `(match_id, player_id)`), así que repetir una ejecución no duplica nada.

## Tareas de administración (SQL Editor)

Unir dos cuentas de la misma persona (p. ej. Hecodes98 PS5 + PC):

```sql
select a.player_id, a.last_known_name, a.person_id
from accounts a
order by a.last_known_name;

select public.merge_persons(<person_id que se queda>, <person_id que desaparece>);

update persons set display_name = 'Hecodes98' where person_id = <person_id que se queda>;
```

Borrar los datos del club de prueba (Aston Huila) cuando exista el club real:

```sql
select public.purge_club(1330384);
```

## Consultas del dashboard

```js
// Totales por persona, solo liga + play-off, desde octubre
supabase.rpc('person_stats', {
  p_match_types: ['leagueMatch', 'playoffMatch'],
  p_from: '2026-10-01',
});

// Estado del colector
supabase.from('v_collector_status').select('*').single();

// collector_runs: listar columnas; select('*') falla porque incluye error_message
supabase.from('collector_runs').select('run_id, started_at, finished_at, status, matches_new');
```

> `persons.display_name` se fija cuando aparece la cuenta y **no** sigue los cambios de nombre en EA (`accounts.last_known_name` sí). Para renombrar a una persona, haz un `update persons` desde el SQL Editor.

## Decisiones (y por qué)

- **IDs de EA como texto** (`match_id`, `player_id`): llegan como string. Guardarlos tal cual evita suponer un rango numérico que no está verificado.
- **Pocas CHECK**: una restricción demasiado estricta haría fallar el insert, y por la ventana de 10 partidos ese partido se perdería. Por eso `position` no tiene CHECK y los conteos solo exigen `>= 0`.
- **`match_raw` separado y oculto**: pesa ~12 KB por partido, el dashboard no lo necesita y trae datos de los rivales.
- **`collector_runs` con permisos por columna**: el dashboard ve estado y fechas, pero no `error_message`.
- **Vistas con `security_invoker`**: sin esto, una vista corre con permisos del dueño y se salta RLS.
- **`ON DELETE CASCADE` desde `clubs`**: borrar el club de prueba borra todo lo suyo en una sola operación.
- **Funciones con `search_path = ''`**: evita que alguien secuestre nombres de objetos (recomendación del linter de Supabase).
