// Orquestación de una ejecución del colector. Recibe sus dependencias
// (inyección de dependencias), así que se prueba sin red ni base de datos.
import { ProClubsError } from 'proclubs-sdk';
import type { Config } from './config.ts';
import type { RunResult } from './domain.ts';
import type { FoundClub, MatchSource } from './ea-source.ts';
import type { StatsRepository } from './repository.ts';
import { toClubSnapshotRow } from './club.ts';
import { toMemberSnapshotRows } from './members.ts';
import { TransformError, normalizeMatch, toRawRow } from './transform.ts';

export interface Logger {
  info(msg: string): void;
  error(msg: string): void;
}

export interface CollectDeps {
  /** Un club por ejecución: main.ts llama a collect() una vez por cada club configurado. */
  config: Pick<Config, 'platform' | 'season' | 'runner' | 'matchTypes'> & { clubName: string };
  source: MatchSource;
  repo: StatsRepository;
  log: Logger;
  now?: () => Date;
}

/** Fallas que no detienen la ejecución pero la marcan como 'error'. */
interface SoftFailure {
  code: string;
  message: string;
}

const MAX_ERROR_LENGTH = 2000;

/**
 * La división se guarda solo en partidos NUEVOS jugados hace menos de esto.
 * Uno más viejo (p. ej., los 10 que se capturan la primera vez) pudo jugarse
 * en otra división; para esos, la vista usa la foto diaria del club.
 */
export const DIVISION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function errorCodeOf(err: unknown): string {
  if (err instanceof ProClubsError) return `EA_${err.code}`;
  if (err instanceof TransformError) return 'TRANSFORM';
  if (err instanceof Error) return err.name;
  return 'UNKNOWN';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Una ejecución completa. Reglas:
 *  - Falla de EA en un tipo de partido: se registra y se siguen los demás.
 *  - Partido que no se puede normalizar: su JSON crudo ya quedó guardado; se registra y se sigue.
 *  - Falla de la base de datos: se aborta (lanza), porque no hay dónde guardar.
 * Devuelve status 'error' si hubo cualquier falla, para que el proceso salga con código != 0.
 */
export async function collect(deps: CollectDeps): Promise<RunResult> {
  const { config, source, repo, log } = deps;
  const now = deps.now ?? (() => new Date());

  const runId = await repo.startRun(config.runner);
  const failures: SoftFailure[] = [];
  let clubId: number | null = null;
  let matchesSeen = 0;
  let matchesNew = 0;
  const opponents: { matchId: string; opponentId: string }[] = [];
  const recentNew: string[] = [];

  const finish = async (fatal?: unknown): Promise<RunResult> => {
    const all = fatal === undefined ? failures : [...failures, { code: errorCodeOf(fatal), message: messageOf(fatal) }];
    const result: RunResult = {
      status: all.length === 0 ? 'success' : 'error',
      clubId,
      matchesSeen,
      matchesNew,
      errorCode: all[0]?.code ?? null,
      errorMessage: all.length ? all.map((f) => `[${f.code}] ${f.message}`).join('\n').slice(0, MAX_ERROR_LENGTH) : null,
    };
    await repo.finishRun(runId, result);
    return result;
  };

  try {
    const club = await source.findClubByName(config.clubName);
    clubId = Number(club.clubId);
    log.info(`Club "${club.name}" -> clubId ${club.clubId}`);
    await repo.upsertClub({ club_id: clubId, name: club.name, platform: config.platform, season: config.season });

    for (const matchType of config.matchTypes) {
      let matches;
      try {
        matches = await source.listMatches(club.clubId, matchType);
      } catch (err) {
        if (!(err instanceof ProClubsError)) throw err;
        failures.push({ code: errorCodeOf(err), message: `${matchType}: ${messageOf(err)}` });
        log.error(`EA falló en ${matchType}: ${messageOf(err)}`);
        continue;
      }

      const ctx = { clubId: club.clubId, matchType, collectedAt: now() };
      const raws = [];
      for (const m of matches) {
        try {
          raws.push({ source: m, row: toRawRow(m, ctx) });
        } catch (err) {
          if (!(err instanceof TransformError)) throw err;
          failures.push({ code: 'TRANSFORM', message: err.message });
        }
      }

      const existing = await repo.findExistingMatchIds(raws.map((r) => r.row.match_id));
      let newHere = 0;

      for (const { source: m, row } of raws) {
        await repo.saveRawMatch(row);
        matchesSeen++;
        let normalized;
        try {
          normalized = normalizeMatch(m, ctx);
          await repo.saveNormalizedMatch(normalized);
        } catch (err) {
          if (!(err instanceof TransformError)) throw err;
          failures.push({ code: 'TRANSFORM', message: err.message });
          log.error(err.message);
          continue;
        }
        if (normalized.match.opponent_club_id !== null) {
          opponents.push({ matchId: row.match_id, opponentId: String(normalized.match.opponent_club_id) });
        }
        if (!existing.has(row.match_id)) {
          newHere++;
          if (now().getTime() - Date.parse(normalized.match.played_at) <= DIVISION_MAX_AGE_MS) recentNew.push(row.match_id);
        }
      }

      matchesNew += newHere;
      log.info(`${matchType}: ${matches.length} recibidos, ${newHere} nuevos`);
    }

    await fillOpponentSkill(deps, opponents);
    await captureMembers(deps, club.clubId, now(), failures);
    const division = await captureClub(deps, club, now(), failures);
    if (division != null && recentNew.length) {
      await deps.repo.setClubDivision(recentNew, division);
      log.info(`División ${division} guardada en ${recentNew.length} partidos nuevos`);
    }
  } catch (err) {
    log.error(`Ejecución abortada: ${messageOf(err)}`);
    try {
      await finish(err);
    } catch (finishErr) {
      log.error(`Además no se pudo registrar la falla: ${messageOf(finishErr)}`);
    }
    throw err;
  }

  return finish();
}

/**
 * Fuerza del rival: skillRating del club rival para los partidos que aún no lo
 * tienen. Es un dato complementario: si EA falla aquí NO se marca la ejecución
 * como error (se reintenta solo en la próxima, mientras el partido siga entre
 * los últimos 10).
 */
async function fillOpponentSkill(deps: CollectDeps, opponents: { matchId: string; opponentId: string }[]): Promise<void> {
  if (opponents.length === 0) return;
  const missing = await deps.repo.findMatchesMissingOpponentSkill(opponents.map((o) => o.matchId));
  const cache = new Map<string, number | null>();
  let filled = 0;
  for (const { matchId, opponentId } of opponents) {
    if (!missing.has(matchId)) continue;
    try {
      if (!cache.has(opponentId)) cache.set(opponentId, await deps.source.getClubSkillRating(opponentId));
    } catch (err) {
      if (!(err instanceof ProClubsError)) throw err;
      deps.log.error(`No se pudo leer el nivel del rival ${opponentId}: ${messageOf(err)}`);
      cache.set(opponentId, null);
    }
    const skill = cache.get(opponentId);
    if (skill != null) {
      await deps.repo.setOpponentSkill(matchId, skill);
      filled++;
    }
  }
  if (filled) deps.log.info(`Nivel del rival guardado en ${filled} partidos`);
}

/**
 * Foto del club (nivel, división, temporada). Si EA falla, se registra como falla.
 * Devuelve la división actual (o null) para anotarla en los partidos nuevos.
 */
async function captureClub(deps: CollectDeps, club: FoundClub, at: Date, failures: SoftFailure[]): Promise<number | null> {
  let overview: { overall: unknown; season: unknown };
  try {
    overview = await deps.source.getClubOverview(club.clubId, club.name);
  } catch (err) {
    if (!(err instanceof ProClubsError)) throw err;
    failures.push({ code: errorCodeOf(err), message: `club overview: ${messageOf(err)}` });
    deps.log.error(`EA falló al leer el resumen del club: ${messageOf(err)}`);
    return null;
  }
  const row = toClubSnapshotRow(overview.overall, overview.season, club.clubId, at);
  if (!row) return null;
  await deps.repo.saveClubSnapshot(row);
  deps.log.info(`Club: nivel ${row.skill_rating ?? '—'}, división ${row.current_division ?? '—'}, ${row.season_points ?? '—'} pts`);
  return row.current_division;
}

/** Foto de members/stats. Si EA falla, se registra como falla (dato oficial). */
async function captureMembers(deps: CollectDeps, clubId: string, at: Date, failures: SoftFailure[]): Promise<void> {
  let response: unknown;
  try {
    response = await deps.source.getMemberStats(clubId);
  } catch (err) {
    if (!(err instanceof ProClubsError)) throw err;
    failures.push({ code: errorCodeOf(err), message: `members/stats: ${messageOf(err)}` });
    deps.log.error(`EA falló en members/stats: ${messageOf(err)}`);
    return;
  }
  const rows = toMemberSnapshotRows(response, clubId, at);
  await deps.repo.saveMemberSnapshots(rows);
  deps.log.info(`Miembros: ${rows.length} guardados en la foto del ${rows[0]?.snapshot_date ?? '—'}`);
}
