// Transformación PURA de clubs/overallStats + ranking de la temporada ->
// fila de club_snapshots. Tolerante: un campo raro queda en null.
import type { ClubSnapshotRow } from './domain.ts';

type Dict = Record<string, unknown>;

function int(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

/**
 * Escudo del club en la fila del ranking de la temporada: clubInfo.teamId (escudo
 * de un equipo real) y clubInfo.customKit.crestAssetId (escudo propio).
 *
 * Regla confirmada por el usuario (2026-11-16, 2 clubes; EA no la documenta): customKit.dCustomKit
 * dice si el club USA su escudo propio. 100 D CILANTRO trae "3" y su escudo es el
 * propio (confirmado por el usuario); FC Aston Huila trae "0" y su escudo correcto
 * no es el propio, sino el del teamId (Atlético Nacional, confirmado). Por eso, con
 * dCustomKit "0", crestAssetId queda en null y el dashboard usa el teamId.
 * El valor crudo sigue en club_snapshots.raw.
 */
export function crestOf(season: unknown): { teamId: number | null; crestAssetId: number | null } {
  const info = ((season ?? null) as Dict | null)?.clubInfo as Dict | undefined;
  const kit = info?.customKit as Dict | undefined;
  const pos = (v: unknown) => { const n = int(v); return n !== null && n > 0 ? n : null; };
  const usesCustom = kit?.dCustomKit == null || int(kit.dCustomKit) !== 0;
  return { teamId: pos(info?.teamId), crestAssetId: usesCustom ? pos(kit?.crestAssetId) : null };
}

/**
 * @param overall respuesta de clubs/overallStats (o null)
 * @param season  fila de currentSeasonLeaderboard/search de NUESTRO club (o null)
 */
export function toClubSnapshotRow(overall: unknown, season: unknown, clubId: string, capturedAt: Date): ClubSnapshotRow | null {
  const o = (overall ?? null) as Dict | null;
  const s = (season ?? null) as Dict | null;
  if (!o && !s) return null;
  const iso = capturedAt.toISOString();
  const positive = (v: unknown) => { const n = int(v); return n !== null && n >= 0 ? n : null; };
  const current = positive(s?.currentDivision);
  // Verificado el 2026-11-11: EA manda DOS "bestDivision" que se contradicen
  // (overallStats: 4; ranking de la temporada: 3, con la actual en 3). La 1 es
  // la más alta, así que la mejor nunca puede ser peor que la actual: se toma la
  // más alta (número menor) entre las dos y la actual.
  const bests = [positive(o?.bestDivision), positive(s?.bestDivision), current].filter((n): n is number => n !== null && n > 0);
  return {
    club_id: Number(clubId),
    snapshot_date: iso.slice(0, 10),
    captured_at: iso,
    skill_rating: positive(o?.skillRating),
    current_division: current,
    best_division: bests.length ? Math.min(...bests) : null,
    season_points: positive(s?.points),
    season_games: positive(s?.gamesPlayed),
    season_wins: positive(s?.wins),
    season_draws: positive(s?.ties),
    season_losses: positive(s?.losses),
    season_goals: positive(s?.goals),
    season_goals_against: positive(s?.goalsAgainst),
    games_played: positive(o?.gamesPlayed),
    wins: positive(o?.wins),
    draws: positive(o?.ties),
    losses: positive(o?.losses),
    promotions: positive(o?.promotions),
    relegations: positive(o?.relegations),
    win_streak: positive(o?.wstreak),
    unbeaten_streak: positive(o?.unbeatenstreak),
    raw: { overallStats: o, currentSeason: s },
  };
}
