// Versiones del dashboard (la primera es la actual). Al publicar un cambio visible
// para el equipo, agregar una entrada arriba: versión, fecha y cambios en lenguaje simple.
export const CHANGELOG = [
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
