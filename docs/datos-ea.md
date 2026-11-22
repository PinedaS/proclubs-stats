# Catálogo de datos de la API de EA (Clubes FC 27)

Investigado el 2026-11-11 con `proclubs-sdk` 0.3.4 contra el club de prueba (`common-gen5`).

**Leyenda:**
- ✅ = verificado con datos reales.
- 🧪 = experimental: interpretación de la comunidad, contrastada con nuestros datos.
- ❓ = sin confirmar.

## 1. Lo que ya capturamos (`clubs/matches`, cada 30 min)

**Por jugador y partido (✅):** posición, calificación, goles, asistencias, tiros, pases (intentos y completados), entradas (intentos y ganadas), MVP, rojas, atajadas (total y 6 tipos), goles recibidos, vallas invictas, segundos jugados y arquetipo.

**Contadores sin documentar (🧪)**, en `player_match_stats.event_counts`. Los códigos vienen de la investigación de la [comunidad](https://github.com/Interactive-63/eafc-pro-clubs-api-research); la coincidencia se midió contra los campos oficiales en 96 registros reales (jugador × partido).

| Dato | Códigos | Contraste con datos oficiales |
|---|---|---|
| Goles / asistencias | 214 / 11 | 94 de 96 coinciden |
| Tiros a puerta + fuera | 217 + 218 | Suman 48 contra 55 oficiales: no cuentan los tiros bloqueados |
| Pases completados | 215 | 65 de 96 |
| Regates completados | 174 | Sin dato oficial para comparar |
| Intercepciones | 6 | Sin dato oficial |
| Posesión ganada / perdida | 108–110 / 105–107 | Sin dato oficial |
| Duelos aéreos ganados | 265–266 | Sin dato oficial |
| Faltas / amarillas | 2+3 / 95+213 | Sin dato oficial |
| Segundas asistencias | 115 | Sin dato oficial (9 en 10 partidos) |
| Pases filtrados | 152 | Sin dato oficial |
| Fuera / en posición | 219 / 111 | Sin dato oficial |
| Decisiones ("mejor opción", "debió pasar") | 177 / 182 | Sin dato oficial |
| Atajadas | 202 | ❌ **Mapeo incorrecto** (0 de 33) |

**Campos de jugador que no usamos, y por qué:**

| Campo | Qué parece ser | Por qué no se usa |
|---|---|---|
| `realtimeidle` | Segundos inactivo | Máx. 20 s en nuestros datos. Podría servir para detectar AFK ❓ |
| `realtimegame` | Tiempo real | Valores incoherentes (hasta 8.358 s en un partido de ~20 min). No es confiable |
| `SCORE` | Goles del equipo | Redundante |
| `vproattr` | ❓ | Siempre `"NH"` |
| `cleansheetsany`, `vprohackreason` | ❓ | Siempre 0 |
| Plataforma (`derivedLabels`) | `ps5` / `pc`… | La agrega el SDK. Útil para distinguir las cuentas de una misma persona ✅ |

## 2. Endpoints que NO capturamos todavía

### `members/stats`: totales de temporada por jugador, que mantiene EA ✅

Trae nombre del jugador, partidos, % de victorias, goles, asistencias, vallas invictas, % de acierto en tiros y en pases, entradas, calificación media, MVP y rojas. Además:
- **`proOverall`:** la media del Pro (p. ej. 74). Sirve para ver cómo mejora cada jugador a lo largo de la temporada, guardando una foto diaria.
- **`proName`:** el nombre del personaje.
- **Otros:** posición, altura, nacionalidad, `favoritePosition` y `prevGoals1..10` (❓ al parecer, goles en los últimos 10 partidos).
- **Uso principal:** conciliar contra la suma de nuestros partidos y detectar partidos perdidos, que es el pendiente 5 de CLAUDE.md.

### `members/career/stats` ✅

Totales históricos por jugador: partidos, goles, asistencias, calificación y MVP.

### `clubs/overallStats`: el club en el tiempo ✅

- **`skillRating`:** nivel del club (p. ej. 1595).
- División actual y mejor división, ascensos y descensos.
- Rachas (`wstreak`, `unbeatenstreak`).
- Resultados y rivales de los últimos 10 partidos.
- **Valor clave:** consultarlo **para cada rival** al capturar el partido permitiría medir la **fuerza del rival**. Esa era la preocupación original con los amistosos.

### `currentSeasonLeaderboard/search` ✅

Puntos, división actual y vallas invictas de la temporada de liga.

### `club/playoffAchievements` ✅

Mejor resultado por temporada de play-off, con su división y posición final.

## 2b. Investigación del 2026-11-16 (pedido: "que no se escape ningún dato")

**Endpoints que conoce `proclubs-sdk` 0.3.4 (9).** Se capturan 6. **Faltan 3**, consultados en vivo con 100 D CILANTRO:

| Endpoint | Qué trae | Estado |
|---|---|---|
| `clubs/info` | Nombre, región, uniformes, escudo (`crestAssetId`, `crestColor`) | ✅ Casi igual al `clubInfo` que ya llega en la foto del club. Falta guardarlo entero. |
| `club/playoffAchievements` | Logros de play-off por temporada | ✅ Hoy vacío (`[]`): aún no hay play-off. Falta capturarlo a diario. |
| `members/career/stats` | Por miembro: partidos, goles, asistencias, calificación, MVP, `proPos`, `prevGoals`, `favoritePosition`; además `positionCount` del club | ✅ Nuevo. Falta capturarlo a diario. |

- La web oficial de Clubes no cargó los datos del club en el navegador de prueba, así que no se pudieron ver otros endpoints que use. ❓
- **Datos del rival:** hoy solo se guarda su `skillRating`. Falta guardar su foto completa (`overallStats` y su fila del ranking de la temporada, que trae su **división**).

**Contadores de eventos (`event_counts`).** En 29 registros llegaron **119 códigos distintos**. Se usan 32. Todos se guardan ya en la base, así que no se pierde ninguno.
- La comunidad mapea casi todos: pases cortos, medios y largos, hacia atrás y hacia los lados, al primer toque y en fuera de juego; entradas perdidas, de pie, limpias y peligrosas; tiros dentro y fuera del área; conducciones; regates superando al rival; goles de pierna mala; centros intentados; "fuera de posición" por gravedad; avisos del juego.
- **Sin significado conocido:** 114, 178, 8, 195 y 196.
- **Contraste con datos oficiales (29 registros):**

  | Código | Contra qué | Coinciden |
  |---|---|---|
  | 216, pases fallados | intentos − completados | 24 |
  | 24 + 26 + 28, completados por distancia | 215 | 17 |
  | 1, entradas perdidas | intentos − ganadas | 21 |
  | 229, entradas de pie ganadas | entradas ganadas | **28** |
  | 13 + 14 + 18 + 19, tiros por zona | tiros | 26 |

**Campos de jugador guardados solo en el JSON crudo (`match_raw`):** `realtimeidle` (posible AFK), `realtimegame`, `vproattr`, `SCORE`, `cleansheetsany` y `vprohackreason`. También se guardan las estadísticas de los **jugadores rivales** y el `aggregate` del partido.

**Hecho (2026-11-16, migración 019 y v2.7):**
1. Tabla `ea_snapshots`: JSON completo de `clubs/info`, `club/playoffAchievements` y `members/career/stats` (una foto por día), y de cada **rival** (`clubs/overallStats` y su fila del ranking) al capturar el partido. anon no la lee. Lo crudo de nuestro `overallStats`, ranking y `members/stats` ya estaba en `club_snapshots.raw` y `member_snapshots.raw`.
2. `matches.opponent_division`: división del rival, solo en partidos nuevos de menos de 6 h (como la nuestra). Se muestra en Partidos cuando esté en más de la mitad de los partidos; antes, la columna queda oculta. Con algunos faltantes, lleva la etiqueta "Parcial".
3. La guía del dashboard ("Cómo leer esto") tiene la sección "Datos guardados que no se muestran".

**Pendiente (opcional):** mostrar las atajadas por tipo y algunos contadores nuevos (pases por distancia, entradas de pie y barridas, tiros dentro y fuera del área).

**Preguntas del usuario (2026-11-16), verificado contra el mapeo de la comunidad:**

| Dato | ¿Existe? | Detalle |
|---|---|---|
| **Goles de penal** | ❌ No | Ningún código conocido los identifica. Hay códigos de "goles por técnica" sin nombre (46, 141, 126…); uno podría ser el penal, pero haría falta un partido con un gol de penal conocido para confirmarlo. |
| **Penales cometidos** | 🧪 Sí | Código 94. En el dashboard: "Penales cometidos*". |
| **% de regates exitosos** | ❌ No | Solo hay regates **completados** (174), conducciones (97) y regates superando al rival (112). No hay regates intentados ni fallidos, así que no se puede calcular un %. |

## 2c. Verificación de los contadores (2026-11-22)

**Método.** Los significados vienen de la comunidad, no de EA: [Interactive-63/eafc-pro-clubs-api-research](https://github.com/Interactive-63/eafc-pro-clubs-api-research) (README actualizado en septiembre de 2026), su [issue #1](https://github.com/Interactive-63/eafc-pro-clubs-api-research/issues/1) (octubre de 2026, todavía no incorporado al README) y [1erkandogan/fc27-clubs-api](https://github.com/1erkandogan/fc27-clubs-api) (que copia la tabla del README). Se usan para saber **qué probar**, no como prueba. Cada código se contrastó con los **campos oficiales** de EA en nuestros 176 registros jugador × partido: identidades que tienen que cumplirse si el significado es correcto. Script: `verify_codes.mjs` (en el chat del 2026-11-22).

### Confirmados con nuestros datos

| Código | Significado | Prueba | Resultado |
|---|---|---|---|
| 214 / 11 | Goles / asistencias | = campos oficiales | 175/176 |
| 217 + 218 | Tiros a puerta + afuera | = tiros oficiales | 173/176 |
| 13 + 18 | Tiros a puerta (área + afuera) | = 217 | 176/176 |
| 13 + 14 + 18 + 19 | Tiros por zona | = tiros oficiales | 166/176 |
| 30 + 32 + 34 | Pases completados adelante + atrás + lados | = pases completados oficiales | 171/176 |
| 229 + 230 | Entradas de pie + barridas | = 0 (entradas ganadas) | 171/176 |
| 0 | Entradas ganadas | = oficiales | 164/176 |
| 219 | Fuera de posición (total) | = 99 + … + 103 | 176/176 |
| 96 | Indicador de roja | ⇔ rojas oficiales | 175/176 |
| 112 | Rival superado (incluye filigrana) | ≥ 38 | 176/176 |
| 238 + 239 + 48 | **Goles desde fuera del área** (propuesta del issue #1) | ≤ goles y ≤ tiros de afuera a puerta; goles − ellos ≤ tiros del área a puerta; en los 2 goles con todos los tiros de afuera aparece y en los 31 con todos del área no | 176/176 en todo |
| 117 | **Asistencias de córner** (propuesta del issue #1) | ≤ asistencias y siempre con córner lanzado (145) | 176/176 |
| 128, 131, 136, 123 | Goles al primer toque, pierna mala, tras palo, vaselina (etiquetas) | ≤ goles | 176/176 |
| 118 | Asistencias de pase filtrado | ≤ asistencias | 176/176 |

### Corregidos: los usábamos mal

| Código | Lo que decíamos | Lo que es | Prueba |
|---|---|---|---|
| **164** | "Entradas limpias" (comunidad, README) | **Igual a las entradas ganadas** (como dice el issue #1) | = entradas ganadas oficiales en 168/176; = código 0 en 169/176 |
| **163** | "Entradas peligrosas" (comunidad, README) | **Una parte de las entradas perdidas**; significado exacto sin confirmar | ≤ código 1 en 175/176; ≤ faltas solo en 133/176 |

Desde la v2.32 ninguno de los dos se muestra ni entra en la fórmula. Siguen en la vista con su nombre viejo (`clean_tackles_exp`, `dangerous_tackles_exp`), porque `create or replace view` no permite renombrar.

### Afirmaciones de la comunidad que nuestros datos NO confirman

- **1 = "entradas perdidas":** no es igual a intentadas − ganadas (107/176), ni 0 + 1 a intentadas (103/176).
- **175 + 176 + 177 + 182 ≈ 91,5 % de los pases intentados:** en nuestros datos la suma **supera** los pases intentados en 150/176 registros. Las indicaciones del juego no son "una por pase".
- **215 = pases completados:** solo 132/176 (la comunidad dice que excluye pases en fuera de juego). Usamos el campo oficial.
- **Pases por distancia (24–29):** corto + medio + largo completados = 215 solo en 116/176 (135/176 sumando los centros, 36). Por eso "Pase corto/medio/largo %" siguen como experimentales.
- **Centros (36/37):** el 36 incluye balón parado y el 37 solo juego abierto, así que "Centros %" sale algo alto (avisado en su ayuda).
- **Sin poder comprobar** (casi no aparecen en nuestros partidos): 125 goles de cabeza (0 casos), 203/46 penales (6 y 4), 5 bloqueos, 202 atajadas (1 registro de arquero), 179 "debió tirar".
- **Sin respaldo en ninguna fuente:** ocasiones claras, pases clave, distancia recorrida, el xG que muestra el juego.

### Qué se hizo con cada uno (migración 024 y v2.32)

- **Se muestran** (Ranking → "+ Añadir dato"): goles de afuera*, goles en el área* (goles − goles de afuera), goles al primer toque*, asistencias de córner*, pases hacia adelante %* (de los completados), duelos aéreos en ataque* y en defensa*.
- **Solo guardados con nombre en la vista** (no se muestran): 1, 123, 125, 203, 46, 157, 151, 96, 99–101, 175, 176, 179, 183, 207, 212, y la dirección de los pases fallidos (33, 35).
- **Todo** sigue además en `player_match_stats.event_counts` y en el JSON crudo, así que si la comunidad confirma algo después se puede calcular para todos los partidos ya guardados.

## 3. Lo que EA no expone (✅ verificado)

- Distancia recorrida.
- Posesión del equipo en %.
- Duelos en el suelo.
- Despejes, bloqueos y toques en el área.
- Ningún mapeo de la comunidad los cubre.
