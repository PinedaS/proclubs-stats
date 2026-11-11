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
 * @param overall respuesta de clubs/overallStats (o null)
 * @param season  fila de currentSeasonLeaderboard/search de NUESTRO club (o null)
 */
export function toClubSnapshotRow(overall: unknown, season: unknown, clubId: string, capturedAt: Date): ClubSnapshotRow | null {
  const o = (overall ?? null) as Dict | null;
  const s = (season ?? null) as Dict | null;
  if (!o && !s) return null;
  const iso = capturedAt.toISOString();
  const positive = (v: unknown) => { const n = int(v); return n !== null && n >= 0 ? n : null; };
  return {
    club_id: Number(clubId),
    snapshot_date: iso.slice(0, 10),
    captured_at: iso,
    skill_rating: positive(o?.skillRating),
    current_division: positive(s?.currentDivision),
    best_division: positive(o?.bestDivision ?? s?.bestDivision),
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
