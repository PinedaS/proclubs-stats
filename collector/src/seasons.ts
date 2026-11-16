// Temporadas de liga dentro de cada juego (migración 020). Lógica PURA, probada aparte.
//
// EA no da el número ni las fechas de la temporada. Se detecta el cambio cuando
// bajan los partidos de la temporada actual (currentSeason.gamesPlayed) respecto
// de la captura anterior: EA reinició los contadores. Supuesto sin verificar con
// un reinicio real (el primero sería alrededor del 3-dic-2026).

export interface SeasonCounters {
  captured_at: string;
  season_games: number | null;
  season_points: number | null;
}

/**
 * true si EA reinició la temporada entre `prev` y `curr`: bajaron los partidos
 * de la temporada y los puntos no subieron. Exigir las dos cosas evita tomar
 * por reinicio un dato raro de un solo campo.
 */
export function isSeasonReset(prev: SeasonCounters | null, curr: SeasonCounters): boolean {
  if (!prev || prev.season_games == null || curr.season_games == null) return false;
  if (curr.season_games >= prev.season_games) return false;
  if (prev.season_points != null && curr.season_points != null && curr.season_points > prev.season_points) return false;
  return true;
}

/** Un día de gracia después del fin esperado antes de avisar que EA no reinició. */
export const SEASON_END_GRACE_MS = 24 * 60 * 60 * 1000;

export function isSeasonOverdue(expectedEndAt: string | null, now: Date): boolean {
  return expectedEndAt != null && now.getTime() > Date.parse(expectedEndAt) + SEASON_END_GRACE_MS;
}
