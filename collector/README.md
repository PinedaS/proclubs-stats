# Colector

Lee los últimos partidos del club en la API no oficial de EA (vía `proclubs-sdk`) y los guarda en Supabase. Está pensado para correr cada 30 min; correrlo dos veces no duplica nada.

## Requisitos

- Node.js **≥ 22.18**. Corre TypeScript directamente, sin compilar, gracias a *type stripping* (eliminación de tipos).
- Docker, solo para la prueba de integración.

## Uso

```bash
npm ci
```

```bash
cp .env.example .env
```

```bash
npm run collect
```

Sale con código **1** si EA, la transformación o Supabase fallaron. Así GitHub Actions marca la ejecución como fallida.

| Script | Qué hace |
|---|---|
| `npm run collect` | Una ejecución del colector. |
| `npm test` | Tests unitarios (sin red ni base de datos). |
| `npm run test:integration` | Repositorio real → PostgREST → Postgres 17 en Docker, con las migraciones del repo. |
| `npm run typecheck` | Verificación de tipos (`tsc --noEmit`). |
| `npm run backup -- <dir>` | Exporta todas las tablas a `<dir>/*.jsonl` (requiere `.env`). |
| `npm run restore-sql -- <dir> > restore.sql` | Genera el SQL para restaurar un respaldo en un proyecto con las migraciones aplicadas. |

Cada ejecución, además de los partidos:
- guarda una foto diaria de `members/stats` en `member_snapshots`, con la media del Pro y los totales oficiales;
- guarda el `skillRating` del rival en los partidos que aún no lo tienen. Si EA falla aquí, no se marca error: se reintenta en la siguiente ejecución.
| `npm run fetch-fixture` | Descarga partidos reales del club configurado a `test/fixtures/`, **anonimizados** (el repo es público). |

## Estructura

```
src/
  config.ts      Variables de entorno validadas con zod
  ea-source.ts   MatchSource: búsqueda del club y partidos (proclubs-sdk)
  transform.ts   Partido crudo -> filas. Función PURA y estricta
  repository.ts  StatsRepository (patrón Repository) + implementación Supabase
  collect.ts     Orquestación de una ejecución (dependencias inyectadas)
  main.ts        Arma las dependencias reales y define el código de salida
```

## Reglas de una ejecución

1. Se registra la ejecución en `collector_runs` (*heartbeat*: mantiene activo Supabase).
2. Se busca el club por **nombre exacto**. La búsqueda de EA es parcial: "Aston Huila" también trae "Aston Huila FC".
3. Para cada tipo de partido y cada partido:
   1. Primero se guarda el **JSON crudo**.
   2. Después se guardan las filas normalizadas.
4. Fallas:
   - **EA falla en un tipo:** se registra y se siguen los demás.
   - **Un partido trae datos inválidos:** su crudo ya quedó guardado; se registra y se sigue.
   - **Supabase falla:** se aborta.
   - En los tres casos, la ejecución termina con `status = error` y código de salida 1.

## Hallazgos verificados con datos reales (2026-11-10)

- `proclubs-sdk` 0.3.4 obtiene datos desde una PC doméstica. `Invoke-WebRequest` recibe **403**: el SDK usa `impit`, que imita a un navegador.
- `clubs[id].result` es un **código** (1 victoria, 2 derrota, 4 empate y 10 en un partido abandonado con derrota). El resultado se toma de `wins` / `losses` / `ties`.
- Todo llega como string, salvo `timestamp`, que es un número.
- `secondsPlayed` está en segundos de **juego** (~5.500 en un partido completo); `realtimegame` está en segundos reales.
- El SDK agrega `derivedLabels.exactPlatform` (p. ej. `ps5`) a cada jugador. Se guarda dentro del JSON crudo.

## Decisiones

- **Versiones exactas** en `package.json` (`--save-exact`), con `package-lock.json`.
- `zod` se fuerza a la **4.6.6** con `overrides`: el SDK fija la 4.6.5, que tiene la vulnerabilidad GHSA-mrhx-c7xc-m3w5.
- **No hay bucle de reintentos propio.** El SDK reintenta como máximo 3 veces en 429/5xx y en fallas de red.
- **Transformación estricta:** un número inválido lanza error en vez de convertirse en 0, para no meter datos falsos en el ranking.
