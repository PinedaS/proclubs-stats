// Transformación PURA de members/stats -> filas de member_snapshots.
// A diferencia de los partidos, aquí la conversión es tolerante: un campo raro
// queda en null (el JSON crudo se guarda igual). Es información secundaria y no
// vale la pena perder la foto entera por un campo.
import type { MemberSnapshotRow } from './domain.ts';

type Dict = Record<string, unknown>;

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** `response` es lo que devuelve proclubs.members.stats(): { members: [...] }. */
export function toMemberSnapshotRows(response: unknown, clubId: string, capturedAt: Date): MemberSnapshotRow[] {
  const members = (response as { members?: unknown })?.members;
  if (!Array.isArray(members)) return [];
  const iso = capturedAt.toISOString();
  const rows: MemberSnapshotRow[] = [];
  for (const item of members) {
    const m = (item ?? {}) as Dict;
    const name = str(m.name);
    if (!name) continue;
    const rating = num(m.ratingAve);
    rows.push({
      club_id: Number(clubId),
      member_name: name,
      snapshot_date: iso.slice(0, 10),
      captured_at: iso,
      pro_overall: int(m.proOverall),
      games_played: int(m.gamesPlayed),
      goals: int(m.goals),
      assists: int(m.assists),
      win_rate: int(m.winRate),
      pass_success_rate: int(m.passSuccessRate),
      shot_success_rate: int(m.shotSuccessRate),
      tackle_success_rate: int(m.tackleSuccessRate),
      passes_made: int(m.passesMade),
      tackles_made: int(m.tacklesMade),
      clean_sheets_def: int(m.cleanSheetsDef),
      clean_sheets_gk: int(m.cleanSheetsGK),
      rating_avg: rating !== null && rating >= 0 && rating <= 10 ? rating : null,
      man_of_the_match: int(m.manOfTheMatch),
      red_cards: int(m.redCards),
      favorite_position: str(m.favoritePosition),
      pro_name: str(m.proName),
      pro_height: int(m.proHeight),
      raw: m,
    });
  }
  return rows;
}
