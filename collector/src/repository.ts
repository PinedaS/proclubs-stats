// Patrón Repository: el colector solo conoce esta interfaz. Cambiar de
// proveedor (o usar un doble en los tests) no toca la lógica.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ClubRow, ClubSeasonRow, ClubSnapshotRow, EaSnapshotRow, MemberSnapshotRow, NormalizedMatch, RawMatchRow, RunResult } from './domain.ts';
import type { SeasonCounters } from './seasons.ts';

export interface StatsRepository {
  /** Foto diaria del club (upsert por club y día). */
  saveClubSnapshot(row: ClubSnapshotRow): Promise<void>;
  /** Foto diaria de members/stats (upsert por club, miembro y día). */
  saveMemberSnapshots(rows: MemberSnapshotRow[]): Promise<void>;
  /** De estos partidos, cuáles aún no tienen la fuerza del rival. */
  findMatchesMissingOpponentSkill(matchIds: string[]): Promise<Set<string>>;
  setOpponentSkill(matchId: string, skillRating: number): Promise<void>;
  /** División del rival al capturar. Solo llena si aún no la tiene (nunca la pisa). */
  setOpponentDivision(matchId: string, division: number): Promise<void>;
  /** JSON completo de endpoints de EA (upsert por club de captura, club consultado, endpoint y día). */
  saveEaSnapshots(rows: EaSnapshotRow[]): Promise<void>;
  /** Última foto del club (para comparar los contadores de la temporada). */
  getLatestClubSnapshot(clubId: number): Promise<SeasonCounters | null>;
  /** Temporada en curso del club, o null si todavía no tiene ninguna. */
  getOpenSeason(clubId: number): Promise<{ season_no: number; started_at: string; expected_end_at: string | null } | null>;
  /** Temporada en curso del juego según los otros clubes del mismo juego (las temporadas son globales), o null. */
  getGameSeasonNo(game: string): Promise<number | null>;
  /** Cierra la temporada abierta (si hay) en `row.started_at` y abre la nueva. */
  startSeason(row: ClubSeasonRow): Promise<void>;
  /** Media del Pro observada después de cada partido (022). Solo llena donde está vacía. */
  setPlayerOverall(rows: { match_id: string; player_id: string; pro_overall: number }[]): Promise<void>;
  /** Escudo del club según EA (teamId y crestAssetId). */
  setClubCrest(clubId: number, teamId: number | null, crestAssetId: number | null): Promise<void>;
  /** División del club al capturar. Solo llena partidos que aún no la tienen (nunca la pisa). */
  setClubDivision(matchIds: string[], division: number): Promise<void>;
  startRun(runner: string): Promise<number>;
  finishRun(runId: number, result: RunResult): Promise<void>;
  upsertClub(club: ClubRow): Promise<void>;
  findExistingMatchIds(matchIds: string[]): Promise<Set<string>>;
  /** Se llama ANTES de normalizar: el partido queda a salvo aunque falle lo demás. */
  saveRawMatch(row: RawMatchRow): Promise<void>;
  /** Orden obligatorio por las FK: matches -> accounts -> player_match_stats. */
  saveNormalizedMatch(match: NormalizedMatch): Promise<void>;
}

export class RepositoryError extends Error {
  override name = 'RepositoryError';
}

interface PgError {
  message: string;
  code?: string;
}

function check(op: string, error: PgError | null): void {
  if (error) throw new RepositoryError(`${op}: ${error.message}${error.code ? ` (${error.code})` : ''}`);
}

export function createServiceClient(url: string, serviceRoleKey: string, fetchImpl?: typeof fetch): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
  });
}

export class SupabaseStatsRepository implements StatsRepository {
  readonly #db: SupabaseClient;

  constructor(db: SupabaseClient) {
    this.#db = db;
  }

  async startRun(runner: string): Promise<number> {
    const { data, error } = await this.#db
      .from('collector_runs')
      .insert({ runner, status: 'running' })
      .select('run_id')
      .single();
    check('startRun', error);
    return (data as { run_id: number }).run_id;
  }

  async finishRun(runId: number, r: RunResult): Promise<void> {
    const { error } = await this.#db
      .from('collector_runs')
      .update({
        status: r.status,
        finished_at: new Date().toISOString(),
        club_id: r.clubId,
        matches_seen: r.matchesSeen,
        matches_new: r.matchesNew,
        error_code: r.errorCode,
        error_message: r.errorMessage,
      })
      .eq('run_id', runId);
    check('finishRun', error);
  }

  async upsertClub(club: ClubRow): Promise<void> {
    // first_seen_at no se envía: el upsert solo pisa las columnas enviadas.
    const { error } = await this.#db.from('clubs').upsert(club, { onConflict: 'club_id' });
    check('upsertClub', error);
  }

  async findExistingMatchIds(matchIds: string[]): Promise<Set<string>> {
    if (matchIds.length === 0) return new Set();
    const { data, error } = await this.#db.from('matches').select('match_id').in('match_id', matchIds);
    check('findExistingMatchIds', error);
    return new Set((data as { match_id: string }[]).map((r) => r.match_id));
  }

  async saveRawMatch(row: RawMatchRow): Promise<void> {
    const { error } = await this.#db.from('match_raw').upsert(row, { onConflict: 'match_id' });
    check('saveRawMatch', error);
  }

  async saveClubSnapshot(row: ClubSnapshotRow): Promise<void> {
    const { error } = await this.#db.from('club_snapshots').upsert(row, { onConflict: 'club_id,snapshot_date' });
    check('saveClubSnapshot', error);
  }

  async saveMemberSnapshots(rows: MemberSnapshotRow[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.#db
      .from('member_snapshots')
      .upsert(rows, { onConflict: 'club_id,member_name,snapshot_date' });
    check('saveMemberSnapshots', error);
  }

  async findMatchesMissingOpponentSkill(matchIds: string[]): Promise<Set<string>> {
    if (matchIds.length === 0) return new Set();
    const { data, error } = await this.#db
      .from('matches')
      .select('match_id')
      .in('match_id', matchIds)
      .is('opponent_skill_rating', null);
    check('findMatchesMissingOpponentSkill', error);
    return new Set((data as { match_id: string }[]).map((r) => r.match_id));
  }

  async setOpponentSkill(matchId: string, skillRating: number): Promise<void> {
    // Update aparte: el upsert de matches nunca envía esta columna, así no la pisa con null.
    const { error } = await this.#db
      .from('matches')
      .update({ opponent_skill_rating: skillRating })
      .eq('match_id', matchId);
    check('setOpponentSkill', error);
  }

  async setOpponentDivision(matchId: string, division: number): Promise<void> {
    const { error } = await this.#db
      .from('matches')
      .update({ opponent_division: division })
      .eq('match_id', matchId)
      .is('opponent_division', null);
    check('setOpponentDivision', error);
  }

  async saveEaSnapshots(rows: EaSnapshotRow[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.#db
      .from('ea_snapshots')
      .upsert(rows, { onConflict: 'for_club_id,club_id,endpoint,snapshot_date' });
    check('saveEaSnapshots', error);
  }

  async setPlayerOverall(rows: { match_id: string; player_id: string; pro_overall: number }[]): Promise<void> {
    for (const r of rows) {
      const { error } = await this.#db
        .from('player_match_stats')
        .update({ pro_overall: r.pro_overall })
        .eq('match_id', r.match_id)
        .eq('player_id', r.player_id)
        .is('pro_overall', null);
      check('setPlayerOverall', error);
    }
  }

  async setClubCrest(clubId: number, teamId: number | null, crestAssetId: number | null): Promise<void> {
    const { error } = await this.#db.from('clubs').update({ team_id: teamId, crest_asset_id: crestAssetId }).eq('club_id', clubId);
    check('setClubCrest', error);
  }

  async getLatestClubSnapshot(clubId: number): Promise<SeasonCounters | null> {
    const { data, error } = await this.#db
      .from('club_snapshots')
      .select('captured_at, season_games, season_points')
      .eq('club_id', clubId)
      .order('captured_at', { ascending: false })
      .limit(1);
    check('getLatestClubSnapshot', error);
    return ((data ?? []) as SeasonCounters[])[0] ?? null;
  }

  async getOpenSeason(clubId: number): Promise<{ season_no: number; started_at: string; expected_end_at: string | null } | null> {
    const { data, error } = await this.#db
      .from('club_seasons')
      .select('season_no, started_at, expected_end_at')
      .eq('club_id', clubId)
      .is('ended_at', null)
      .limit(1);
    check('getOpenSeason', error);
    return ((data ?? []) as { season_no: number; started_at: string; expected_end_at: string | null }[])[0] ?? null;
  }

  async getGameSeasonNo(game: string): Promise<number | null> {
    const { data, error } = await this.#db
      .from('club_seasons')
      .select('season_no, clubs!inner(season)')
      .eq('clubs.season', game)
      .is('ended_at', null)
      .order('season_no', { ascending: false })
      .limit(1);
    check('getGameSeasonNo', error);
    return ((data ?? []) as { season_no: number }[])[0]?.season_no ?? null;
  }

  async startSeason(row: ClubSeasonRow): Promise<void> {
    // Dos pasos (PostgREST no agrupa en una transacción): cerrar y abrir. Si falla
    // el segundo, la próxima ejecución no ve temporada abierta y abre una nueva.
    let res = await this.#db
      .from('club_seasons')
      .update({ ended_at: row.started_at })
      .eq('club_id', row.club_id)
      .is('ended_at', null);
    check('startSeason (cerrar)', res.error);
    res = await this.#db.from('club_seasons').upsert(row, { onConflict: 'club_id,season_no' });
    check('startSeason (abrir)', res.error);
  }

  async setClubDivision(matchIds: string[], division: number): Promise<void> {
    if (matchIds.length === 0) return;
    // Igual que el nivel del rival: update aparte, y solo donde sigue vacío.
    const { error } = await this.#db
      .from('matches')
      .update({ club_division: division })
      .in('match_id', matchIds)
      .is('club_division', null);
    check('setClubDivision', error);
  }

  async saveNormalizedMatch(n: NormalizedMatch): Promise<void> {
    // No es una transacción (PostgREST hace una por petición). Si falla a la
    // mitad, la próxima ejecución repite el upsert completo y lo corrige.
    let res = await this.#db.from('matches').upsert(n.match, { onConflict: 'match_id' });
    check('upsert matches', res.error);

    if (n.accounts.length > 0) {
      res = await this.#db.from('accounts').upsert(n.accounts, { onConflict: 'player_id' });
      check('upsert accounts', res.error);
    }
    if (n.stats.length > 0) {
      res = await this.#db.from('player_match_stats').upsert(n.stats, { onConflict: 'match_id,player_id' });
      check('upsert player_match_stats', res.error);
    }
  }
}
