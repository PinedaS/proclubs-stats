// Patrón Repository: el colector solo conoce esta interfaz. Cambiar de
// proveedor (o usar un doble en los tests) no toca la lógica.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ClubRow, MemberSnapshotRow, NormalizedMatch, RawMatchRow, RunResult } from './domain.ts';

export interface StatsRepository {
  /** Foto diaria de members/stats (upsert por club, miembro y día). */
  saveMemberSnapshots(rows: MemberSnapshotRow[]): Promise<void>;
  /** De estos partidos, cuáles aún no tienen la fuerza del rival. */
  findMatchesMissingOpponentSkill(matchIds: string[]): Promise<Set<string>>;
  setOpponentSkill(matchId: string, skillRating: number): Promise<void>;
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
