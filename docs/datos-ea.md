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

## 3. Lo que EA no expone (✅ verificado)

- Distancia recorrida.
- Posesión del equipo en %.
- Duelos en el suelo.
- Despejes, bloqueos y toques en el área.
- Ningún mapeo de la comunidad los cubre.
