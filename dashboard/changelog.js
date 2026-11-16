// Versiones del dashboard (la primera es la actual). Al publicar un cambio visible
// para el equipo, agregar una entrada arriba: versión, fecha y cambios en lenguaje simple.
// La fecha es la de Colombia (UTC−5), no la UTC: de noche ya es "mañana" en UTC.
export const CHANGELOG = [
  {
    version: '2.12',
    date: '2026-11-16',
    title: 'Mejor jugador: dificultad, juego limpio y más datos',
    changes: [
      'Cada partido vale según su dificultad: más en divisiones altas (+5 % por división sobre la 5ª) y contra rivales de más nivel (hasta ±15 %).',
      'Ataque, defensa y pase usan muchos más datos: regates, rival superado, segundas asistencias, intercepciones, recuperaciones, duelos aéreos, pases filtrados, pérdidas y más. Al tocar un jugador se ve cada uno.',
      'Nuevo criterio "Juego limpio" (5 %): menos rojas, amarillas, faltas y penales cometidos = más puntos. Reemplaza a "Ante rivales fuertes", que ahora cubre el ajuste por dificultad.',
    ],
  },
  {
    version: '2.11',
    date: '2026-11-16',
    title: 'Gráficas a elección, app instalable y celular',
    changes: [
      'Cada gráfica tiene su botón "Ocultar gráfica" / "Mostrar gráfica", y en "Vista" se pueden apagar todas. Se recuerda en este navegador.',
      'Se puede instalar como app en el celular o en la computadora (en Chrome: menú ⋮ → "Instalar app" o "Agregar a la pantalla principal").',
      'Celular: las tarjetas del ranking ya no se salen de la pantalla; en Partidos se ven fecha, rival, marcador y resultado sin desplazar; los mensajes de "sin datos" se leen completos.',
      'Por rol, "Por arquetipo": si nadie comparte arquetipo con otro jugador, se explica por qué todos dan 100 en vez de mostrar una gráfica vacía.',
      'La barra de "Datos" ya no tapa las pestañas al desplazar.',
    ],
  },
  {
    version: '2.10',
    date: '2026-11-16',
    title: 'Mejor jugador (experimental) y versión beta',
    changes: [
      'Pestaña nueva "Mejor jugador" (experimental): un puntaje de 0 a 100 con 8 criterios y pesos fijos, comparando a cada uno con el promedio de su rol. Toca un jugador para ver cuánto aporta cada criterio; "¿Cómo se calcula?" explica la fórmula.',
      'Para entrar al ranking del mejor jugador hay que jugar al menos el 30 % de los partidos del club.',
      'El dashboard se marca como beta: las pestañas, gráficas y cálculos todavía cambian. Los datos de EA no: se guardan completos y tal cual.',
    ],
  },
  {
    version: '2.9',
    date: '2026-11-16',
    title: 'Gráficas nuevas',
    changes: [
      'Ranking: "Dos datos a la vez" (eliges qué va en cada eje), "Mapa de calor" (en qué destaca cada uno) y "Carrera por el mejor" (calificación acumulada partido a partido). Se quitó la gráfica de barras, que repetía la tabla.',
      'Por rol: cada índice como un punto alrededor del 100.',
      'Comparar: una línea por jugador entre los grupos (por ejemplo, rival fuerte y débil).',
      'Duplas: matriz con el % de victorias de cada pareja.',
      'Partidos: nivel del rival contra la diferencia de goles, con la tendencia.',
      'Detalle del jugador: "Su lugar en el equipo", dato por dato.',
      'Cada jugador tiene siempre el mismo color en todas las gráficas, con su nombre al lado.',
    ],
  },
  {
    version: '2.8',
    date: '2026-11-16',
    title: 'Temporadas, escudo y más datos',
    changes: [
      'Juego y temporada por separado: la cabecera dice "FC 27 · Temporada 2", con el número de temporada del juego. En "Fechas" se puede elegir una temporada; la nueva se detecta sola cuando EA reinicia la temporada.',
      'La ficha de División ya no repite el número: lo muestra el escudo, y "Mejor" aparece solo si es distinta de la actual.',
      'Escudo real del club y escudos de cada división (los del juego), en la cabecera, en Partidos y en el detalle del jugador.',
      'Correcciones: ya no aparece "null" debajo de la gráfica del ranking, y el menú "+ Añadir dato" se ve completo.',
      '"+ Añadir dato" suma más de 30 datos: pases cortos, medios y largos; al primer toque; tiros dentro y fuera del área; goles con la pierna mala; regates superando al rival; barridas; balones quitados; tipos de atajada del portero, y más.',
    ],
  },
  {
    version: '2.7',
    date: '2026-11-16',
    title: 'Datos a elección, duplas y más gráficas',
    changes: [
      'Ranking: botones "Datos" para ver totales, proporciones (por 90 min, %), oficiales y experimentales; y "+ Añadir dato" para sumar a la tabla datos menos importantes (se quitan con la ×).',
      'Ranking: cada jugador muestra todas las posiciones que jugó, con el % de sus minutos en cada una.',
      'Ranking: gráfica del dato por el que se ordena la tabla.',
      'Cara a cara: se puede comparar a un jugador con el promedio del equipo.',
      'Duplas: una sola pestaña con el equipo con y sin cada jugador (con gráfica) y, para el jugador elegido, cómo le va al equipo con él junto a cada compañero y sin él.',
      'Club: resultados por semana y goles a favor y en contra de cada partido.',
      'Los datos que se empezaron a guardar más tarde llevan la etiqueta "Parcial"; si faltan en más de la mitad de los partidos, no se muestran.',
      'Textos más simples: los datos experimentales ya no mencionan los códigos internos de EA. "Penales" pasa a "Penales cometidos".',
      'Se guarda todo lo que da EA (también la división de cada rival, la carrera de cada miembro y los logros de play-off). En "Cómo leer esto" se explica qué se guarda aunque no se muestre.',
    ],
  },
  {
    version: '2.6',
    date: '2026-11-15',
    title: 'División como en el juego',
    changes: [
      'La división se muestra como en el juego: EA la envía con un número más (la 4ª del juego llega como 5).',
      'Al pasar el cursor se ve cómo la envía EA. Por encima de la 1ª está la División Élite.',
    ],
  },
  {
    version: '2.5',
    date: '2026-11-15',
    title: 'Datos tal cual EA',
    changes: [
      'La calificación media y el % MVP vuelven a ser exactamente los de EA (sin ajustes por minutos).',
      'Los partidos abandonados vuelven a contar por defecto, con su marcador tal cual EA y la etiqueta "Abandonado".',
      'Etiquetas "↑ Entró 45\'" y "↓ Salió 19\'" para quien entra desde la banca o sale antes, en Partidos y en el detalle de cada jugador.',
    ],
  },
  {
    version: '2.4',
    date: '2026-11-15',
    title: 'Banca, abandonos e IA',
    changes: [
      'La calificación media y el % MVP pesan cada partido según los minutos jugados.',
      'Los partidos abandonados ya no cuentan por defecto (su marcador lo asigna EA); se pueden incluir en "Vista".',
      'Partidos: se marca quién jugó parcial, los goles de la IA y los resultados por abandono.',
      'Detalle del jugador: minutos de cada partido.',
      'Club: goles de jugadores contra goles de la IA.',
    ],
  },
  {
    version: '2.3',
    date: '2026-11-15',
    title: 'Comparaciones más finas',
    changes: [
      'Cara a cara: solo hay empate si los dos valores son iguales; una diferencia como 6,90 contra 6,70 ya marca ganador.',
      'Los datos experimentales (*) aparecen junto a los demás de su tema (ataque, pase, defensa, disciplina), con fondo teñido, en Cara a cara y en el ranking.',
    ],
  },
  {
    version: '2.2',
    date: '2026-11-15',
    title: 'Más gráficas del jugador',
    changes: [
      'Rendimiento: calificación de cada partido según el nivel del rival, con la tendencia.',
      'Rendimiento: regularidad, cuántos partidos jugó con cada calificación.',
      'Contexto: dónde juega, el reparto de sus minutos por posición y su calificación en cada una.',
      'Contexto: calendario de los días que jugó, coloreados según su calificación.',
    ],
  },
  {
    version: '2.1',
    date: '2026-11-15',
    title: 'Fotos de los jugadores',
    changes: [
      'Cada jugador puede tener foto: en su detalle, "Poner foto" o "Cambiar foto". Cualquiera puede cambiarla o quitarla.',
      'La foto se achica sola antes de subirla; si se quita, vuelven las iniciales.',
      'Secciones ordenadas por importancia: en Cara a cara y en el detalle del jugador, primero el rendimiento.',
    ],
  },
  {
    version: '2.0',
    date: '2026-11-15',
    title: 'Rediseño',
    changes: [
      'Colores nuevos: grafito y azul eléctrico.',
      'En el celular, el ranking se ve como tarjetas, con un selector para ordenar.',
      'Filtros en una sola franja: tipos de partido, "Fechas" y "Vista".',
      'Cabecera con la forma reciente (últimos 5 resultados) y la racha actual.',
      'Mini tendencia de las últimas calificaciones junto a la calificación de cada jugador.',
      'El detalle del jugador se divide en pestañas: Resumen, Rendimiento, Contexto y Partidos.',
      'Goleadores y MVP de cada partido en la pestaña Partidos.',
      'Evolución semanal de la calificación, del equipo (Club) y de cada jugador (Rendimiento).',
      'Aviso cuando hay pocos partidos, y jugadores con menos de 3 partidos atenuados.',
      'Se quitaron datos repetidos entre la cabecera, la pestaña Club y el detalle del jugador.',
    ],
  },
  {
    version: '1.4',
    date: '2026-11-15',
    title: 'Nuevo club y nivel de entrada',
    changes: [
      'Se sigue al club 100 D CILANTRO y se borró el club de prueba.',
      'Detalle del jugador: media al entrar y actual, división en que entró, nivel de los rivales y rendimiento por división.',
    ],
  },
  {
    version: '1.3',
    date: '2026-11-11',
    title: 'Cara a cara',
    changes: [
      'Pestaña Cara a cara: compara a dos jugadores con barras, dato por dato.',
      'Los arquetipos muestran su nombre (Maestro, Boss, Target Man…).',
      'El podio y el puesto siempre premian al mejor de cada dato, con empates justos.',
    ],
  },
  {
    version: '1.2',
    date: '2026-11-11',
    title: 'Posición, división y química',
    changes: [
      'Posición recomendada en el detalle de cada jugador.',
      'Comparar por división y división de cada partido.',
      'Tabla "Con y sin": cómo rinde cada uno con y sin cada compañero.',
    ],
  },
  {
    version: '1.1',
    date: '2026-11-11',
    title: 'Comparaciones justas',
    changes: [
      'Pestaña Por rol: cada jugador comparado con el promedio de su posición.',
      'Pestañas Comparar y Duplas, guía "Cómo leer esto" y vista para el celular.',
    ],
  },
  {
    version: '1.0',
    date: '2026-11-11',
    title: 'Primera versión',
    changes: ['Ranking, partidos y datos del club, capturados automáticamente desde EA.'],
  },
];
