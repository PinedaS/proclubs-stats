# Manual de usuario: Stats del club

Dashboard: **https://pinedas.github.io/proclubs-stats/**

Muestra las estadísticas de nuestro club de Clubes (Pro Clubs) de EA SPORTS FC, capturadas solas desde la web de EA. Nadie carga datos a mano y nadie necesita cuenta: solo se consulta.

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
- **Fechas:** desde y hasta.
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
- **En gráfica:** barras del dato ordenado, del mejor al peor.
- En el celular, la tabla se ve como tarjetas con un selector "Ordenar por".

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

Todavía no hay fórmula: por ahora solo se juntan y muestran los datos. Se definirá más adelante, de forma transparente y sin castigar a quien rota de posición, juega de portero, entró con un nivel bajo o jugó en divisiones distintas. Para eso ya se guarda:
- la posición y el arquetipo de cada partido;
- la división de cada partido;
- el nivel del rival;
- la media del Pro día a día.
