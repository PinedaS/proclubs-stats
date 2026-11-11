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

## 3. Lo que EA no expone (✅ verificado)

- Distancia recorrida.
- Posesión del equipo en %.
- Duelos en el suelo.
- Despejes, bloqueos y toques en el área.
- Ningún mapeo de la comunidad los cubre.
