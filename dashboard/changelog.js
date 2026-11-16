// Versiones del dashboard (la primera es la actual). Al publicar un cambio visible
// para el equipo, agregar una entrada arriba: versión, fecha y cambios en lenguaje simple.
export const CHANGELOG = [
  {
    version: '2.6',
    date: '2026-11-16',
    title: 'División como en el juego',
    changes: [
      'La división se muestra como en el juego: EA la envía con un número más (la 4ª del juego llega como 5).',
      'Al pasar el cursor se ve cómo la envía EA. La división por encima de la 1ª se llama "División máxima" hasta confirmar su nombre.',
    ],
  },
  {
    version: '2.5',
    date: '2026-11-16',
    title: 'Datos tal cual EA',
    changes: [
      'La calificación media y el % MVP vuelven a ser exactamente los de EA (sin ajustes por minutos).',
      'Los partidos abandonados vuelven a contar por defecto, con su marcador tal cual EA y la etiqueta "Abandonado".',
      'Etiquetas "↑ Entró 45\'" y "↓ Salió 19\'" para quien entra desde la banca o sale antes, en Partidos y en el detalle de cada jugador.',
    ],
  },
  {
    version: '2.4',
    date: '2026-11-16',
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
