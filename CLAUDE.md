# Stats de Clubes FC 27 — contexto del proyecto

Documento de traspaso (handoff) desde un chat de diseño en claude.ai (2026-11-10).
Contiene las decisiones tomadas, los hallazgos verificados y lo que falta. Léelo completo antes de escribir código.

## 1. Objetivo

Guardar **todos los stats de los jugadores de nuestro club de Clubes (Pro Clubs) de EA FC 27**, por partido y en total, y visualizarlos.
- **Uso principal:** decidir quién fue el **mejor jugador de FC 27** antes de que salga FC 28.
- Habrá otros usos después (comparativas, evolución, etc.), por eso se eligió SQL.

## 2. Requisitos acordados con el usuario

- **Captura 100 % automática.** Nadie carga datos a mano, y el colector **no puede depender de la PC del usuario**, porque él no está en todos los partidos.
- **Tipos de partido:** liga (`leagueMatch`), play-off (`playoffMatch`) y amistosos (`friendlyMatch`). Los tres cuentan para el ranking, pero el dashboard debe permitir filtrar por tipo, porque en amistosos el rival puede ser más débil y eso infla los números.
- **Usuarios:** todo el equipo **consulta** el dashboard; nadie escribe.
- **Costo cero (requisito del usuario, 2026-11-11):** todo debe ser **gratis**, sin excepciones.
  - Solo planes gratuitos: GitHub Free con repo público, Supabase Free y GitHub Pages.
  - No activar nada que pueda cobrar: complementos (*add-ons*), cómputo mayor, *spend cap* desactivado ni tarjeta registrada.
  - Ante cualquier opción con costo, preguntar antes.
- **Preferencias del usuario (es programador):**
  - Buenas prácticas, indicando cuáles se aplicaron.
  - Explicar el porqué de las decisiones.
  - Distinguir siempre lo verificado de lo supuesto.
  - Responder en español, con los términos en inglés traducidos entre paréntesis.

## 3. Arquitectura decidida

```
API no oficial de EA ──► Colector (GitHub Actions, cada 30 min) ──► Supabase (Postgres) ──► Dashboard web (link para el equipo)
```

1. **Colector** en Node.js (**≥ 22.18**, lo exige `proclubs-sdk` 0.3.4) con `proclubs-sdk`. Código en `collector/` (TypeScript sin compilar, *type stripping*).
   - Corre en **GitHub Actions** con *cron* (programación periódica) **cada 30 min**.
   - Consulta los 3 tipos de partido.
   - Hace *upsert* (insertar o actualizar) idempotente por `matchId`: correr dos veces no duplica nada.
2. **Almacenamiento:** **Supabase Postgres**, plan gratis.
   - El colector escribe a través de una **interfaz de almacenamiento (patrón Repository)**, para poder cambiar de proveedor sin tocar la lógica.
   - Guardar el **JSON crudo de cada partido** en una columna `jsonb`, además de las tablas normalizadas, para poder reprocesar si EA cambia campos o si se descifra `match_event_aggregate`.
3. **Dashboard:** web estática que lee Supabase con una clave de solo lectura (`anon` + RLS, *Row Level Security*: seguridad a nivel de fila).
   - **Publicado (2026-11-11):** https://pinedas.github.io/proclubs-stats/, en GitHub Pages, gratis. El workflow `pages.yml` despliega la carpeta `dashboard/` en cada push.
   - HTML, CSS y JS sin compilar ni dependencias externas. Lee la API REST de Supabase con `fetch` y la clave **publicable** (`dashboard/config.js`).
   - Incluye:
     - ranking ordenable por `person_stats`, con mínimo de partidos;
     - filtros por tipo de partido y fechas;
     - lista de partidos con sus jugadores;
     - detalle por jugador con la evolución de la calificación;
     - estado del colector.
   - Probado en Chrome con los datos del club de prueba.

### Por qué así (no reabrir sin un motivo nuevo)

- **Postgres en vez de archivos JSON en el repo.** El espacio no es el motivo: son ≈12 KB por partido, unos 12 MB por año con 1.000 partidos. Se eligió por la **flexibilidad de consultas** (SQL), las varias temporadas y la posibilidad de un repo privado.
- **Cada 30 min y no cada 15:**
  - En repos privados, GitHub Free incluye 2.000 min/mes de Actions y redondea cada ejecución al minuto entero. Cada 15 min serían ≈2.880 min, por encima del límite; cada 30 min, ≈1.440.
  - 30 min es seguro frente al límite de 10 partidos: cada partido dura ~20 min reales, así que 10 partidos son ~3 h.
  - En repos públicos los minutos son ilimitados, y se podría bajar a 15 min.
- **Nube y no la PC del usuario:** él no está presente en todos los partidos.

## 4. Hallazgos verificados de la API de EA (2026-11-10)

No hay API oficial. Se usan los endpoints públicos que lee la web de Clubes de EA.
- **Base:** `https://proclubs.ea.com/api/fc/`. Peticiones GET sin clave, cuenta ni cookie.
- **Plataforma:** `common-gen5` (PS5, Xbox Series y PC). `common-gen4` devuelve HTTP 400 desde FC 27.
- **⚠️ Límite crítico:** EA devuelve **máximo 10 partidos por tipo**, aunque se pidan más. Un partido que salga de esa ventana sin haberse guardado **se pierde para siempre**.
- **Endpoints útiles:**
  - `allTimeLeaderboard/search?platform&clubName`: buscar el club por nombre.
  - `clubs/matches?platform&clubIds&matchType&maxResultCount`: partidos. `clubIds` acepta **un solo** ID, aunque el nombre esté en plural.
  - `members/stats?platform&clubId`: totales por miembro, útiles para conciliar contra la suma de partidos.
- **Los IDs de club cambian cada año.** Hay que buscar el club por nombre y no guardar un ID fijo de una temporada a otra.
- **Prueba real:** una consulta desde un servidor de Anthropic recibió HTTP 200 con datos de FC 27.
  - La documentación de `proclubs-sdk` reporta 403 y tiempos de espera intermitentes desde servidores, y que `curl` falla mientras `fetch` de Node funciona.
  - **Verificado desde GitHub Actions (2026-11-11, una ejecución):** el workflow `ea-probe.yml` (runner `ubuntu-latest`, `proclubs-sdk` 0.3.4) buscó el club y descargó sus 10 partidos de liga sin 403.
    - Es una sola muestra. Si EA bloquea de forma intermitente, se verá en `collector_runs` cuando el colector corra cada 30 min.

### Forma de un partido (`clubs/matches`)

- **Nivel partido:** `matchId` (string), `timestamp` (Unix, segundos), `clubs`, `players`, `aggregate`.
- **`clubs[clubId]`:** `goals`, `goalsAgainst`, `wins`, `losses`, `ties`, `result`, `winnerByDnf` (victoria porque el rival abandonó), `details.name`, etc.
- **`players[clubId][playerId]`:**
  - El `playerId` es un **ID numérico de cuenta, estable**. Úsalo como llave, no el nombre.
  - Campos: `playername`, `pos` (`forward` / `midfielder` / `defender` / `goalkeeper`), `archetypeid`, `rating` (string, p. ej. `"7.40"`), `goals`, `assists`, `shots`, `passattempts`, `passesmade`, `tackleattempts`, `tacklesmade`, `mom` (MVP, `"0"`/`"1"`), `redcards`, `saves`, `goalsconceded`, `cleansheetsdef`, `cleansheetsgk`, `secondsPlayed`, `gameTime`.
  - Atajadas detalladas: `parrySaves`, `punchSaves`, `reflexSaves`, `crossSaves`, `ballDiveSaves`, `goodDirectionSaves`.
  - Además: `match_event_aggregate_0..3`, `wins`, `losses`, `realtimegame`, `realtimeidle`, `vproattr`, `vprohackreason`.
- **Casi todos los números llegan como string.** Hay que convertirlos.
- **`match_event_aggregate_*`:** cadenas como `"0:1,1:4,100:2,..."` (código de evento : cantidad), **sin documentar**. Puede partirse en varios campos.
  - **Hipótesis sin confirmar:** podrían contener regates u otras acciones que la API no expone directamente.
  - Guárdalas crudas; descifrarlas queda pendiente.
- **No existen** campos directos de regates, duelos, posesión ni distancia recorrida. La comunidad le pide a EA que los exponga.

### `proclubs-sdk` (Node.js) — lo leído en su documentación

- **Docs:** https://proclubs-sdk.mintlify.app. Repo: https://github.com/alex-jordan547/proclubs-sdk.
- `new ProClubsClient()`: usa un perfil de red tipo Chrome, valida con Zod y hace reintentos acotados (`maxAttempts` de 1 a 5).
- `proclubs.clubs.search({ name, platform })` → `ClubSummary[]` con `clubId`, `clubName`, etc.
- `proclubs.matches.list({ clubId, type, limit, platform })` → `ClubMatch[]`, con la forma de la sección anterior. Los campos crudos se preservan.
- **Errores (extienden `ProClubsError`, con propiedad `code`):** `ProClubsHttpError` (`status`, `endpoint`, `retryAfterMs`), `ProClubsNetworkError`, `ProClubsTimeoutError`, `ProClubsResponseError`, `ProClubsValidationError`, `ProClubsAbortError`.
- Reintenta 429/502/503/504 y fallas de red. **No envuelvas el cliente en un bucle de reintentos ilimitado.**
- **Verificado (2026-11-10, v0.3.4 ejecutada):**
  - La firma de `clubs.search` y `matches.list` coincide con lo de arriba.
  - `clubId` llega como string.
  - La búsqueda por nombre es **parcial**: hay que filtrar por nombre exacto.
  - Desde una PC doméstica, el SDK recibe datos, mientras `Invoke-WebRequest` recibe 403 (el SDK usa `impit`).
  - `clubs[id].result` es un código (1 victoria, 2 derrota, 4 empate, 10 abandono con derrota): el resultado se toma de `wins` / `losses` / `ties`.
  - `secondsPlayed` está en segundos de juego.
  - Detalle completo en `collector/README.md`.

### Proyecto de Supabase real (creado el 2026-11-11)

- **Organización:** "FC Aston Huila", plan **Free**.
- **Proyecto:** `proclubs-stats`, ref `lubikomzgxzuxdaosqxb`, URL `https://lubikomzgxzuxdaosqxb.supabase.co`, región `us-east-1`, cómputo Nano (gratis).
- **Opciones de creación:**
  - *Data API*: activada.
  - *Automatically expose new tables*: **desactivada**, la recomendación de Supabase. Por eso existe la migración 004 de permisos explícitos.
  - *Automatic RLS*: desactivada.
- **Migraciones 001–004:** aplicadas en el SQL Editor el 2026-11-11, en una sola ejecución (una transacción).
- **Verificado con consultas al catálogo:**
  - Las 7 tablas tienen RLS. Hay 1 política de lectura por tabla, salvo `match_raw`, que no tiene ninguna.
  - `anon` no escribe en ninguna tabla. No lee `match_raw`, y de `collector_runs` solo lee algunas columnas.
  - `service_role` escribe en todas las tablas.
  - `anon` no ejecuta `merge_persons`, `purge_club` ni `accounts_assign_person`.
- **Primera ejecución real (2026-11-11, `workflow_dispatch` de `collect.yml`): éxito.**
  - Guardó, del club de prueba, 10 partidos con su JSON crudo, 50 filas de stats y 7 cuentas/personas.
  - Resultados: 5 derrotas, 3 empates y 2 victorias. Coinciden con el fixture.
  - `collector_runs` la registró como `success`, con 10 partidos vistos y 10 nuevos.
  - Desde entonces corre sola cada 30 min (minutos 7 y 37).
- **Secretos del repo:** `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, cargados el 2026-11-11.
- **Variables opcionales del repo:** `EA_CLUB_NAME` y `SEASON`. Sin ellas, el colector usa el club de prueba.
- **Clave del colector:** en proyectos nuevos, la clave *secret* (`sb_secret_...`) reemplaza a la `service_role` antigua y actúa con ese rol. Va **solo** en los secretos de GitHub y en el `.env` local, nunca en el repo.

### Supabase plan gratis (fuentes de 2026)

- 500 MB de base de datos y 2 proyectos activos.
- **Se pausa tras 7 días sin actividad.** Conserva los datos, pero hay que restaurarlo a mano.
  - **Inferencia:** el colector escribiendo cada 30 min lo mantiene activo.
  - **Riesgo residual:** si EA se cae más de una semana, no hay escrituras y el proyecto se pausa. Considerar un *heartbeat* (registro de cada ejecución en una tabla `collector_runs`, incluso cuando no haya partidos nuevos).

## 5. Datos de prueba

**Club del equipo: "FC Aston Huila"** (creado el 2026-11-10; todavía sin partidos jugados).
- **Verificado (2026-11-10):** `clubs.search("FC Aston Huila")` devuelve `[]`.
  - **Hipótesis sin confirmar:** la búsqueda (`allTimeLeaderboard/search`) solo lista clubes con partidos jugados. Hay que volver a buscarlo después del primer partido.
  - Mientras no aparezca, el colector falla con `ClubNotFoundError` y sale con código 1.
- **Nombre casi igual al del club de prueba.** Buscar "Aston Huila" ya devuelve "Aston Huila" y "Aston Huila FC", y devolverá también "FC Aston Huila". La coincidencia **exacta** del colector es la que evita mezclarlos; no la quites.
- **Mientras tanto:** desarrollar y probar con un club ajeno real de FC 27.
  - "Aston Huila", `clubId` **1330384**, `common-gen5`.
  - **NO es el club del equipo.** Sus jugadores son terceros: no pongas sus gamertags ni sus IDs de cuenta en el repo, que es **público**.
  - Los fixtures de `collector/test/fixtures` se guardan anonimizados con `scripts/anonymize.ts`, que `npm run fetch-fixture` ya aplica.
- **Club e ID por configuración** (variables de entorno, nada fijo en el código).
- Cuando creen su club: cambiar la configuración y borrar los datos de prueba.
- **Activar el colector ANTES de que empiecen a jugar con el club nuevo**, por el límite de 10 partidos.

## 6. Identidad de jugadores

- **Llave:** el `playerId` de EA. El `playername` puede cambiar.
- Se necesita una tabla de **personas** que agrupe varias cuentas. Ejemplo conocido: **Hecodes98 juega con dos cuentas (PS5 y PC) y es una sola persona.** Los rankings se calculan por persona.
- **Jugadores conocidos del equipo** (FC 26; confirmar en FC 27): PinedaDS (el usuario), Henoxerwtf, Andresgj061298, Hecodes98 (dos cuentas), X_The_Unlucky_X, Andresjimene.

## 6b. Plataformas (PC + PS5)

- El equipo mezcla PC y PS5. `common-gen5` agrupa PS5, Xbox Series y PC en un solo grupo de juego cruzado: un club, un solo `platform` en todas las llamadas.
- Cada jugador trae su ID de cuenta sin importar la plataforma. El colector no distingue plataformas.
- Las cuentas múltiples de una misma persona (p. ej. Hecodes98 en PC y PS5) se unen en la tabla de personas.

## 6c. Contingencia y detección de fallas

| Falla | Contingencia |
|---|---|
| EA bloquea las IPs de GitHub (403) | Plan B: el mismo colector en un dispositivo de casa siempre encendido. El *upsert* idempotente permite correr **nube + casa a la vez** como redundancia. Diseñar el colector para ejecutarse igual en ambos sitios (solo variables de entorno). |
| GitHub Actions se retrasa o salta ejecuciones | El margen de 30 min frente a la ventana de ~3 h lo cubre. |
| La API de EA cae por completo | Los partidos que salgan de la ventana de 10 **se pierden**. Mitigación: conciliar contra `members/stats` (totales por jugador que mantiene EA) para recuperar al menos los totales de la temporada. Último recurso: capturas manuales de la Plantilla del juego. |
| EA cambia campos o el SDK se rompe | JSON crudo en `jsonb`, versión del SDK fijada, error claro (no fallar en silencio). |
| Supabase se pausa | Se restaura desde el panel; los datos se conservan. |
| Cambio de ID del club (nueva temporada) | Buscar el club por nombre desde la configuración. |

**Detección (obligatoria):**
- Tabla `collector_runs` con cada ejecución (inicio, fin, estado, partidos nuevos, error).
- El dashboard muestra "última captura exitosa hace X" con alerta visual si supera un umbral.
- El proceso debe terminar con código de salida distinto de 0 cuando EA o Supabase fallen, para que GitHub marque la ejecución como fallida.
- Opcional: aviso a un *webhook* de Discord tras N fallas consecutivas.

## 7. Pendientes y decisiones abiertas

1. ~~Repo público o privado.~~ **Decidido (2026-11-10): público.**
   - Dashboard en GitHub Pages, y minutos de Actions ilimitados.
   - **Riesgo:** GitHub desactiva los workflows programados de un repo público tras **60 días sin actividad** en el repo. Hay que mitigarlo en el paso 4 (p. ej. un *keepalive*).
2. **Fórmula de "mejor jugador": POSPUESTA por decisión del usuario (2026-11-11).** Por ahora solo se recopilan y muestran los datos; la fórmula se decidirá más adelante. No implementar ningún puntaje ni ranking ponderado sin que el usuario lo pida. Ideas para entonces:
   - Métricas por partido (G+A, calificación media, % MVP).
   - Mínimo de partidos para entrar al ranking.
   - Comparación dentro de cada posición.
   - Hacerla transparente y configurable.
3. ~~Validar el colector desde GitHub Actions contra EA.~~ **Primera prueba OK (2026-11-11), sin 403.** Hay que vigilar fallas intermitentes en `collector_runs`. El plan B (un dispositivo en casa) sigue disponible.
4. **Descifrar `match_event_aggregate`** (opcional, futuro). **Investigado el 2026-11-11:**
   - **No está cifrado.** Son contadores sin documentar con el formato `código:cantidad`. En nuestros datos solo `_0` y `_1` traen valores.
   - **Hay un mapeo de la comunidad para FC 27,** sin respaldo oficial de EA: [Interactive-63/eafc-pro-clubs-api-research](https://github.com/Interactive-63/eafc-pro-clubs-api-research). Según ese mapeo:

     | Dato | Código |
     |---|---|
     | Regates completados | 174 |
     | Intercepciones | 6 |
     | Posesión perdida | 105–107 |
     | Posesión ganada | 108–110 |
     | Duelos aéreos ganados | 265–266 |
     | Faltas cometidas | 2 + 3 |
     | Amarillas | 95 + 213 |

     **No hay código para distancia recorrida.**
   - **Lo contrasté contra los campos oficiales en 96 registros reales (jugador × partido):**

     | Campo oficial | Código | Coincidencia |
     |---|---|---|
     | Goles | 214 | 94/96 |
     | Asistencias | 11 | 94/96 |
     | Tiros | 217+218 | 86/96 |
     | Pases completados | 215 | 65/96 |
     | Entradas | 0 | 80/96 |
     | Atajadas | 202 | 0 de 33 casos con valor (**mapeo incorrecto**) |

   - **Conclusión:** los códigos dan aproximaciones útiles, no valores exactos. Si se muestran, marcarlos como **experimentales**. El JSON crudo ya se guarda, así que se pueden calcular después, también para partidos ya capturados.
5. ~~Conciliación contra `members/stats`.~~ **Hecho (migración 006):**
   - Foto diaria en `member_snapshots`. La vista `v_member_latest` compara los partidos que EA sumó desde la primera foto con los capturados.
   - Además, `matches.opponent_skill_rating` guarda la fuerza del rival, y `person_stats` incluye métricas por 90 min, conversión, presencia, forma, regularidad y otras.
   - CI (`ci.yml`) y Dependabot están activos.
6. **Respaldos: cifrados en la rama `backups`** (decidido el 2026-11-11).
   - `backup.yml` corre los domingos. Exporta (`collector/src/backup.ts`), comprime y cifra con AES-256 (GPG simétrico, `collector/scripts/encrypt-backup.sh`).
   - Conserva los últimos 12, en un solo commit con *force push*.
   - La contraseña es el secreto `BACKUP_PASSPHRASE`. Solo la tiene el usuario: **nunca** escribirla ni pedirla en el chat.
   - **Nunca publicar datos sin cifrar en el repo, que es público.** Un primer intento sin cifrar fue bloqueado por esa razón.
   - La restauración (`npm run restore-sql`) está probada en CI: se restaura en una base vacía y queda idéntica.
   - Contexto, verificado el 2026-11-11: el plan Free de Supabase **no incluye respaldos automáticos accesibles**, según su página de precios y su documentación. Los partidos no se pueden recuperar de EA, así que conviene una exportación periódica gratuita, por ejemplo con un workflow de GitHub Actions.
7. **Catálogo de datos de EA:** ver `docs/datos-ea.md`. Recoge los endpoints y campos verificados, los no usados y los que EA no expone.

## 8. Orden sugerido de trabajo

1. Crear el proyecto de Supabase (lo hace el usuario) y el esquema SQL: migraciones, RLS de solo lectura para `anon`, vistas de totales y de stats por persona.
2. Colector:
   - Configuración validada.
   - Cliente de EA.
   - Transformación **pura** de partido crudo a filas, con tests usando un JSON real guardado como *fixture* (dato de prueba fijo).
   - Repositorio de Supabase con *upsert* idempotente.
   - Registro de ejecuciones.
3. Probar localmente contra el club de prueba.
4. Workflow de GitHub Actions:
   - *cron* cada 30 min, más `workflow_dispatch` para ejecutarlo a mano.
   - `concurrency` para evitar ejecuciones solapadas.
   - Secretos `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`; la clave *service role* **solo** en el colector, **nunca** en el dashboard.
5. Dashboard:
   - Filtros por tipo de partido y fechas.
   - Tabla de totales y promedios por persona.
   - Ranking de mejor jugador.
   - Detalle y evolución por jugador.
   - Lista de partidos.
