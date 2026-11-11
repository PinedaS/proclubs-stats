// Orquestación de una ejecución del colector. Recibe sus dependencias
// (inyección de dependencias), así que se prueba sin red ni base de datos.
import { ProClubsError } from 'proclubs-sdk';
import type { Config } from './config.ts';
import type { RunResult } from './domain.ts';
import type { MatchSource } from './ea-source.ts';
import type { StatsRepository } from './repository.ts';
import { TransformError, normalizeMatch, toRawRow } from './transform.ts';

export interface Logger {
  info(msg: string): void;
  error(msg: string): void;
}

export interface CollectDeps {
  config: Pick<Config, 'clubName' | 'platform' | 'season' | 'runner' | 'matchTypes'>;
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
        try {
          await repo.saveNormalizedMatch(normalizeMatch(m, ctx));
        } catch (err) {
          if (!(err instanceof TransformError)) throw err;
          failures.push({ code: 'TRANSFORM', message: err.message });
          log.error(err.message);
          continue;
        }
        if (!existing.has(row.match_id)) newHere++;
      }

      matchesNew += newHere;
      log.info(`${matchType}: ${matches.length} recibidos, ${newHere} nuevos`);
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
