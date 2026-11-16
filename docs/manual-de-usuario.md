# Manual de usuario: Stats del club

Dashboard: **https://pinedas.github.io/proclubs-stats/**

Muestra las estadísticas de nuestro club de Clubes (Pro Clubs) de EA SPORTS FC, capturadas solas desde la web de EA. Nadie carga datos a mano y nadie necesita cuenta: solo se consulta.

## 0. Versión beta

El dashboard está en **beta**: las pestañas, gráficas y cálculos todavía cambian y pueden moverse o desaparecer. Los **datos de EA no son beta**: se guardan completos y tal cual.

Deja de ser beta cuando se cumplan tres condiciones:
- la detección de temporadas funciona en un cambio de temporada real, alrededor del 3-dic-2026;
- hay al menos 50 partidos capturados;
- pasan dos semanas sin cambios de estructura (pestañas o fórmula).

## 0b. Instalar como app y ocultar gráficas

- **Instalar:** en Chrome (celular o computadora), menú ⋮ → "Instalar app" o "Agregar a la pantalla principal". Se abre como una app aparte, siempre con la última versión. Necesita conexión.
- **Gráficas:** cada una tiene un botón "Ocultar gráfica" / "Mostrar gráfica". En "Vista" → "Gráficas" se apagan todas a la vez. Se recuerda en ese navegador.

## 1. De dónde salen los datos

- Cada 15 minutos un proceso automático consulta la web pública de Clubes de EA y guarda los partidos nuevos.
- EA solo deja ver los **últimos 10 partidos** de cada tipo. Por eso se captura seguido: un partido que sale de esa ventana sin guardarse se pierde.
- Se guardan liga, play-off y amistosos.
- Los números se muestran **tal cual los da EA**. Los casos especiales se marcan con etiquetas, sin cambiar ningún número:

  | Etiqueta | Qué significa |
  |---|---|
  | **Abandonado** | El partido se cortó o un equipo se salió. El marcador es el que asignó EA (por ejemplo, 0-3). |
  | **↑ Entró 45'** | El jugador entró desde la banca en ese minuto. |
  | **↓ Salió 19'** | El jugador salió antes de tiempo. |
  | **IA** | Goles de los jugadores que maneja la IA de nuestro equipo. |
  | **Parcial** | El dato se empezó a guardar después y falta en algunos partidos. Si falta en más de la mitad, no se muestra. |
  | **\*** (fondo teñido) | Dato **experimental**: EA no lo documenta y es una aproximación. |

## 2. Cabecera

- **Nivel del club** (skillRating de EA) y cuánto cambió desde la primera foto.
- **División**, tal como la muestra el juego (de la 5ª a la 1ª, y por encima la División Élite).
- **Temporada:** victorias, empates y derrotas, puntos y goles.
- **Forma:** los últimos 5 resultados y la racha actual.
- **Captura automática:** hace cuánto fue la última. Se pone amarilla o roja si se atrasa.
- **Cómo leer esto:** la guía dentro del dashboard. **Novedades:** qué cambió en cada versión.

## 3. Filtros (franja de arriba)

- **Liga, Play-off, Amistoso:** qué tipos de partido cuentan. En los amistosos el rival puede ser más débil.
- **Fechas:** una **temporada** (o todas las del juego), o un rango desde y hasta.
  - Cada juego (FC 27) tiene varias temporadas de liga, que terminan con una semana de Play-offs.
  - Se numeran como el juego, según su calendario (la temporada 2 de FC 27 va del 22-oct al 3-dic-2026), porque EA no da el número en sus datos.
  - Una temporada nueva se detecta sola cuando EA reinicia los partidos y puntos de la temporada.
- **Vista:**
  - mínimo de partidos para aparecer;
  - excluir partidos abandonados;
  - mostrar u ocultar los datos experimentales.

  Lo que elijas se recuerda en tu navegador.

## 4. Pestañas

### Ranking

- **Podio:** los 3 mejores en el dato por el que esté ordenada la tabla. Solo suben quienes tienen 3 o más partidos.
- **Tabla:** toca un encabezado para ordenar y un jugador para ver su detalle.
  - El puesto (#) siempre sigue al **mejor** de ese dato, aunque ordenes al revés. En datos donde menos es mejor (pérdidas, faltas, tarjetas), el primero es quien tiene menos.
- **Posiciones:** todas las que jugó cada uno, con el % de sus minutos en cada una.
- **Datos** (botones):
  - **Totales:** goles, asistencias, entradas…
  - **Proporciones:** por 90 minutos y porcentajes. No favorecen a quien jugó más.
  - **Oficiales:** los que publica EA.
  - **Experimentales\***.
- **+ Añadir dato:** suma a la tabla datos menos importantes (tiros, pases completados, vallas invictas, forma, presencia, penales cometidos…). Se quitan con la **×** de su columna.
- **Gráficas:**
  - **Dos datos a la vez:** eliges el dato de cada eje. Las líneas punteadas son la mediana del equipo y el tamaño del punto es la cantidad de partidos.
  - **Mapa de calor:** cada dato coloreado según el puesto en el equipo (más intenso = mejor).
  - **Carrera por el mejor:** la calificación media acumulada de cada jugador, partido a partido.
- Otras secciones también tienen gráficas:
  - **Por rol:** puntos alrededor del 100.
  - **Comparar:** una línea por jugador entre los grupos.
  - **Duplas:** matriz de % de victorias por pareja.
  - **Partidos:** nivel del rival contra la diferencia de goles.
  - **Detalle del jugador:** "Su lugar en el equipo", dato por dato.
- Cada jugador tiene siempre el mismo color en todas las gráficas, con su nombre al lado.
- En el celular, la tabla se ve como tarjetas con un selector "Ordenar por".

### Mejor jugador (experimental)

- **Puntaje de 0 a 100** con 8 criterios y pesos fijos, iguales para todos:

  | Criterio | Peso |
  |---|---|
  | Calificación frente a su rol | 30 % |
  | Ataque frente a su rol | 15 % |
  | Defensa frente a su rol | 15 % |
  | Pase frente a su rol | 10 % |
  | Impacto en el equipo | 10 % |
  | MVP | 10 % |
  | Juego limpio | 5 % |
  | Regularidad | 5 % |

- **Dificultad:** en calificación, ataque, defensa y pase, cada partido vale más en divisiones altas (+5 % por división sobre la 5ª) y contra rivales de más nivel (entre −15 % y +15 %).
- **Ataque, defensa y pase combinan varios datos:** G+A, conversión, regates*, tiros; entradas, intercepciones*, recuperaciones*, duelos aéreos*; precisión, pases filtrados*, pérdidas*, entre otros.
- **Nivel del jugador:** la misma actuación vale más con una media del Pro más baja. Cada partido se ajusta por la media que el jugador tenía ese día frente a la del equipo, entre −10 % y +10 %.
- **Juego limpio:** puntos de sanción por 90 minutos (roja 3, amarilla* 1, penal cometido* 1, falta* 0,25) frente al promedio del equipo. Menos sanciones = más puntos.

- **Justo para quien rota:** todo se compara con el promedio de su rol. El portero se mide por % de atajadas en vez de por ataque.
- **Pocos partidos:** con pocos partidos, el resultado se acerca al promedio.
- **Para entrar:** jugar al menos el 30 % de los partidos del club.
- **Desglose:** al tocar un jugador se ve cuánto aporta cada criterio. "¿Cómo se calcula?" explica la fórmula.
- **No cambia ningún dato de EA:** es un cálculo encima.

### Por rol

- Compara a cada jugador con el **promedio del club en su misma posición** (o arquetipo).
- **100 = promedio del rol**; 120 = 20 % mejor. Así un defensa no queda abajo por marcar pocos goles.
- Si alguien jugó varias posiciones, cada una cuenta según sus minutos.
- "Valores reales por posición" muestra los números sin comparar.

### Cara a cara

- Dos jugadores, o un jugador contra el **promedio del equipo**, dato por dato, con barras enfrentadas. La barra fuerte es la de quien gana ese dato.
- Arriba, un marcador cuenta cuántos datos gana cada uno.
- Solo se comparan tasas (por partido, por 90 min, %), nunca totales.
- Primero va el rendimiento y después los índices relativos al rol.
- El enlace de la página sirve para compartir la comparación.

### Comparar

El mismo jugador en distintas situaciones:
- rival fuerte o débil;
- liga o amistoso;
- cuántos jugadores del club estaban en cancha;
- división.

Fíjate en los partidos (PJ) de cada celda: 2 partidos no se comparan con 30.

### Duplas

- **El equipo con y sin cada jugador:** % de victorias y goles en los partidos con él y sin él, con una gráfica de la diferencia.
- **Duplas:** elige un jugador y ves cómo le va al equipo **con él**, junto a cada compañero, y **sin él**. También ves cuánto cambia la calificación de cada compañero con él y sin él.
- Es una correlación, no una causa: también influyen el rival, la posición y la suerte. Las filas con pocos partidos se ven atenuadas.

### Partidos

- Cada partido con el rival, su nivel, la división, cuántos jugamos, el marcador, los goleadores, el MVP y las etiquetas.
- Toca un partido para ver a cada jugador.

### Club

- Temporada actual, nivel del club día a día, resultados por semana, goles a favor y en contra por partido, y la calificación media del equipo por semana.

### Detalle de un jugador

Se abre al tocar un jugador. Tiene cuatro pestañas:
- **Resumen.**
- **Rendimiento:** datos avanzados, relativo a su rol, calificación contra el nivel del rival, regularidad, evolución semanal y posición recomendada.
- **Contexto:** media del Pro al entrar y actual, división en que entró, rendimiento por división, dónde juega, calendario, récords y rachas.
- **Partidos.**

Cualquiera puede poner, cambiar o quitar la foto de cualquier jugador.

## 5. Lo que se guarda pero no se muestra

Se guarda **todo** lo que da EA, para poder usarlo después:
- atajadas por tipo;
- unos 120 contadores del juego por jugador y partido;
- los jugadores y la ficha de cada rival;
- la carrera de cada miembro;
- los logros de play-off;
- la ficha del club.

EA **no** da:
- goles de penal (solo penales cometidos);
- % de regates exitosos (solo los completados);
- distancia recorrida;
- posesión en %;
- quién le pasa a quién.

## 6. El mejor jugador

Desde la v2.10 hay una fórmula **experimental**, en la pestaña "Mejor jugador" (ver arriba). Es transparente y no castiga a quien rota de posición ni a quien juega de portero. También se guarda, para poder afinarla después:
- la posición y el arquetipo de cada partido;
- la división de cada partido;
- el nivel del rival;
- la media del Pro día a día.
