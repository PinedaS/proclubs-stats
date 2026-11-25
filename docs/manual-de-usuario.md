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
  - **Por posición:** puntos alrededor del 100.
  - **Comparar:** una línea por jugador entre los grupos.
  - **Compañeros:** matriz de % de victorias por pareja.
  - **Partidos:** nivel del rival contra la diferencia de goles.
  - **Detalle del jugador:** "Su lugar en el equipo", dato por dato.
- Cada jugador tiene siempre el mismo color en todas las gráficas, con su nombre al lado.
- En el celular, la tabla se ve como tarjetas con un selector "Ordenar por".

### Mejor jugador (experimental)

- **Puntaje de 0 a 100** con 8 criterios. Los pesos son fijos, salvo ataque y defensa, que suman 30 y se reparten según la familia del arquetipo (ofensivo 20/10, equilibrado 15/15, defensivo 10/20). Los pesos suman 95: cada criterio vale su peso ÷ 95 (en la tabla, el % real):

  | Criterio | Peso | % real |
  |---|---|---|
  | Calificación frente a su posición | 25 | 26,3 % |
  | Ataque frente a su posición | 15 | 15,8 % |
  | Defensa frente a su posición | 15 | 15,8 % |
  | Pase frente a su posición | 10 | 10,5 % |
  | Impacto en el equipo | 10 | 10,5 % |
  | MVP | 10 | 10,5 % |
  | Juego limpio | 5 | 5,3 % |
  | Ubicación* | 5 | 5,3 % |

  La **regularidad** se quitó el 25/11/2026: con 91 partidos, las diferencias entre jugadores eran ruido y premiaba a quien tenía calificaciones bajas pero estables.

- **Ubicación\*:** el % de veces en posición, según los avisos del juego. Es el único criterio que no se compara con la posición: la nota es el % tal cual. Ojo: los delanteros suelen tener un % más bajo que los medios y defensas.

- **Dificultad:** en calificación, ataque, defensa y pase, cada partido vale más contra rivales de más nivel (la raíz de su nivel frente al medio, entre −15 % y +15 %). El promedio de los demás se ajusta igual. Desde el 25/11/2026 la división no cuenta: con 91 partidos, jugar más arriba no bajó la calificación de nadie.
- **Pérdidas:** se miden por cada vez que tiene el balón (pases completados + conducciones\*), no por 90 minutos, para no castigar a quien participa más.
- **Ataque, defensa y pase combinan varios datos:** G+A, conversión, regates*, tiros, conducciones*, faltas recibidas*, tiros desde el área %*; entradas, intercepciones*, recuperaciones*, duelos aéreos*; precisión, pases filtrados*, pérdidas*, primer toque*, pases a fuera de juego*, entre otros.
- **Nivel del jugador:** la misma actuación vale más con una media del Pro más baja. Cada partido se ajusta por la media que el jugador tenía ese día frente a la del equipo, con la mitad de fuerza que un ajuste proporcional (por ejemplo, 74 frente a 78 da +3 %) y entre −10 % y +10 %.
- **Media por arquetipo:** cada arquetipo tiene su propia media, y EA da una sola. Desde el 16-nov-2026 se guarda la media de cada partido, justo después de jugarlo. Los partidos anteriores usan la foto del día, que es una aproximación.
- **Arqueros:** los minutos de arquero se miden con una defensa propia, frente a otros arqueros, y no cuentan en el ataque:

  | Dato | Peso |
  |---|---|
  | % de atajadas | 50 % |
  | Goles recibidos por 90 (menos es mejor) | 20 % |
  | Atajadas por 90 | 15 % |
  | Vallas invictas | 15 % |
- **Juego limpio:** puntos de sanción por 90 minutos (roja 3, amarilla* 1, penal cometido* 1, falta* 0,25) frente al promedio del equipo. Menos sanciones = más puntos.

- **Contra los demás:** cada uno se compara con los **demás** jugadores de su posición que tienen al menos el 15 % de los partidos del club y 5 partidos, nunca consigo mismo. Si nadie más jugó esa posición, esos minutos no cuentan (si pasa en todas, el criterio queda en 100); si los demás jugaron pocos partidos ahí, la comparación cuenta menos.
- **Amistosos:** en esta fórmula, cada amistoso vale la mitad que un partido de liga o de play-off.
- **Abandonos:** un partido abandonado cuenta según los minutos que duró.
- **Jugadores en cancha:** la calificación y los datos por 90 minutos se ajustan según cuántos humanos jugaron, porque con menos humanos cada uno toca más el balón.
- **Dificultad en todo:** MVP y juego limpio también usan el rival y el nivel; impacto, el rival.
- **MVP y humanos en cancha:** el MVP se elige entre los humanos de los dos equipos, así que cada MVP vale según cuántos había en total: ganarlo entre 8 vale el doble que entre 4.
- **Impacto en el equipo:** compara el % de puntos (victoria 3, empate 1, derrota 0) con y sin el jugador, solo entre partidos con el mismo número de humanos: cuando alguien falta hay menos humanos, y eso cambia los resultados del equipo. Se corrige según el menor entre partidos con él y sin él. Con menos de 5 partidos sin él, queda en 100.
- **Pesos reales:** la nota es 50 + 15 × (índice − 100) ÷ la dispersión del criterio entre los jugadores del ranking (mínimo 5). Así cada criterio mueve el puntaje según su peso y no según lo disperso que sea.
- **Justo para quien rota:** todo se compara con el promedio de su posición. El portero se mide por % de atajadas en vez de por ataque.
- **Pocos partidos:** con pocos partidos, el resultado se acerca al promedio.
- **Para entrar:** jugar al menos el 30 % de los partidos del club.
- **Desglose:** al tocar un jugador se ve cuánto aporta cada criterio. "¿Cómo se calcula?" explica la fórmula.
- **No cambia ningún dato de EA:** es un cálculo encima.

### Por posición

**Con el balón (experimental).** Gráfica de cuatro cuadrantes, frente a los demás de su posición en el club (100 = igual): a lo ancho, la **retención** (conducciones\* por cada pase completado) y a lo alto, el **peligro por toque** (tiros, goles y asistencias dobles, filtrados\*, rivales superados\* y 2.ª asistencias\* por cada vez que tiene el balón). Arriba está quien genera peligro, retenga mucho o poco; abajo a la derecha, quien amarra el balón sin sacarle provecho. El tamaño del punto es cuánto toca el balón. Con el selector de arriba se cambia el eje vertical por **"Elige un pase peor\*"** o **"Pérdidas por toque\*"**; en esos dos el eje va invertido, así que arriba siempre es "bien" (elige mejor, pierde menos). En "Ver los números" se ven las pérdidas por toque, **"Elige un pase peor\*"** (qué parte de sus pases tuvo el aviso del juego "debió pasar a otro": había un compañero mejor ubicado; mide la elección del pase, no si se quedó con el balón) y cómo le va al equipo cuando retiene más o menos que de costumbre. Usa partidos de 45+ min sin abandonos, en delantera y medio, con 5+ partidos ahí. No entra en la fórmula del mejor jugador.

**Alineación sugerida · 4-3-3 (2) (experimental).** Arriba de la pestaña hay una cancha con cada humano en el puesto que mejor le va según los datos; la IA cubre los demás. Elige quiénes juegan con los botones de nombres. Al tocar a un jugador se resalta su explicación: su calificación en esa posición frente a la de los demás, cómo le ha ido al equipo con él ahí, en qué destaca y qué mejorar, y la confianza (alta, media o baja).
- La posición (delantera, medio, defensa o portero) sale de su calificación frente a los demás que juegan ahí, con menos peso si tiene pocos partidos, y de los puntos por partido del equipo con él en esa posición.
- El puesto dentro de la línea (extremo o 9; pivote o interior) sale de sus datos en cantidad por 90 min y en % de acierto. Con pocos intentos, el % se acerca al promedio.
- EA no da la formación, el puesto exacto ni el lado de la cancha: es una idea para probar, no una regla.

- Compara a cada jugador con el **promedio del club en su misma posición** (o arquetipo).
- **Posición** es la general que da EA: delantero, medio, defensa o arquero. EA no distingue, por ejemplo, un extremo de un delantero centro.
- **100 = promedio de la posición**; 120 = 20 % mejor. Así un defensa no queda abajo por marcar pocos goles.
- Si alguien jugó varias posiciones, cada una cuenta según sus minutos.
- "Valores reales por posición" muestra los números sin comparar.

### Cara a cara

- Dos jugadores, o un jugador contra el **promedio del equipo**, dato por dato, con barras enfrentadas. La barra fuerte es la de quien gana ese dato.
- Arriba, un marcador cuenta cuántos datos gana cada uno.
- Solo se comparan tasas (por partido, por 90 min, %), nunca totales.
- Primero va el rendimiento y después los índices relativos a la posición.
- El enlace de la página sirve para compartir la comparación.

### Comparar

- **Humanos rivales:** agrupa los partidos según cuántos humanos tenía el rival, para ver cómo rinde cada uno contra equipos con más o menos humanos.

- **Dato:** un menú con los datos por tema: general (calificación, G+A/90, % de victorias, % MVP), ataque, pase y defensa. Todos son por partido, por 90 minutos o en %, para no favorecer a quien jugó más. En pérdidas, menos es mejor.

El mismo jugador en distintas situaciones:
- rival fuerte o débil;
- liga o amistoso;
- cuántos jugadores del club estaban en cancha;
- división.

Fíjate en los partidos (PJ) de cada celda: 2 partidos no se comparan con 30.

### Compañeros

Antes se llamaba "Duplas". Reúne cómo le va al equipo con y sin cada jugador, la matriz de parejas y el detalle de cada jugador.

- **El equipo con y sin cada jugador:** % de victorias y goles en los partidos con él y sin él, con una gráfica de la diferencia.
- **Con él y sin él:** elige un jugador y ves cómo le va al equipo **con él**, junto a cada compañero, y **sin él**. También ves cuánto cambia la calificación de cada compañero con él y sin él.
- Es una correlación, no una causa: también influyen el rival, la posición y la suerte. Las filas con pocos partidos se ven atenuadas.

### Partidos

- **Rivales repetidos:** los equipos que enfrentamos 2 veces o más. Al tocar uno se ven sus partidos (marcador, nivel del rival, humanos de cada lado y división) y cómo rindió cada jugador contra ese rival frente a su calificación media. Se agrupan por el ID del club rival, no por el nombre, que puede cambiar.

- Cada partido con el rival, su nivel, la división, cuántos jugamos, el marcador, los goleadores, el MVP y las etiquetas.
- Al tocar a un jugador dentro de un partido se ven sus datos **de ese partido**; "Ver su historial" abre su detalle completo.
- Toca un partido para ver a cada jugador y, arriba, los datos del rival según EA el día del partido: nivel, división, récord en FC 27 y puntos de la temporada. Solo hay foto del rival desde el 16 de noviembre de 2026.

### Club

- Temporada actual, nivel del club día a día, resultados por semana, goles a favor y en contra por partido, y la calificación media del equipo por semana.
- **División partido a partido:** en qué división se jugó cada partido, con el color del resultado. EA no da un puesto en una tabla general, sino la división y los puntos.
- **Para mejorar como equipo:** qué datos cambian entre victorias y derrotas (por jugador humano y por 90 minutos, sin abandonos) y en qué situaciones nos va peor y mejor (humanos propios y rivales, rival fuerte o débil, división, tipo de partido; solo con 4+ partidos). Son relaciones, no causas.
- **El equipo según los humanos rivales:** puntos por partido y goles según cuántos humanos tenía el rival.
- **Logros en play-off:** lo que EA registra de los play-offs del club, tal cual. Está vacío hasta que el club juegue unos play-offs.

### Detalle de un jugador

Se abre al tocar un jugador. Tiene cuatro pestañas:
- **Resumen.**
- **Resumen → Puntos fuertes y para mejorar:** sus 3 datos más altos y más bajos frente a los demás que juegan habitualmente en su posición principal (solo con 5+ partidos suyos y de los demás). Va primero lo que más se relaciona con ganar: ataque y defensa según su arquetipo, después pase. Si la referencia es una sola persona, lo dice.
- **Resumen → En todo FC 27:** sus partidos, goles, asistencias, calificación y MVP en **todos sus clubes**, según EA. Incluye partidos que no capturamos, por eso no coincide con el resto del dashboard.
- **Resumen → Su Pro:** nombre del Pro, altura, posición favorita y nacionalidad, según EA.
- **Rendimiento:** datos avanzados, relativo a su posición, calificación contra el nivel del rival, regularidad, evolución semanal y posición recomendada.
- **Contexto:** media del Pro al entrar y actual, división en que entró, rendimiento por división, dónde juega, calendario, récords y rachas.
- **Partidos.**

Cualquiera puede poner, cambiar o quitar la foto de cualquier jugador.

## 5. Lo que se guarda pero no se muestra

Se guarda **todo** lo que da EA, para poder usarlo después:
- atajadas por tipo;
- unos 120 contadores del juego por jugador y partido;
- los jugadores de cada rival (su ficha de club sí se muestra en Partidos);
- la ficha del club.

Desde la v2.34 se muestran la carrera de cada miembro, el perfil del Pro, los logros de play-off y la ficha de cada rival.

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
