// Orquestación de una ejecución del colector. Recibe sus dependencias
// (inyección de dependencias), así que se prueba sin red ni base de datos.
import { ProClubsError } from 'proclubs-sdk';
import type { Config } from './config.ts';
import { EXTRA_ENDPOINTS, type EaSnapshotRow, type MemberSnapshotRow, type RunResult } from './domain.ts';
import { divisionOf, skillRatingOf, type FoundClub, type MatchSource } from './ea-source.ts';
import { isSeasonOverdue, isSeasonReset, type SeasonCounters } from './seasons.ts';
import type { StatsRepository } from './repository.ts';
import { crestOf, toClubSnapshotRow } from './club.ts';
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
  const opponents: Opponent[] = [];
  let firstPlayedAt: string | null = null;
  const latestByPlayer = new Map<string, { matchId: string; playedAt: string; playername: string }>(); // partido más viejo visto (inicio de la 1.ª temporada de un club nuevo)
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
        if (firstPlayedAt == null || normalized.match.played_at < firstPlayedAt) firstPlayedAt = normalized.match.played_at;
        const recent = !existing.has(row.match_id) && now().getTime() - Date.parse(normalized.match.played_at) <= DIVISION_MAX_AGE_MS;
        if (!existing.has(row.match_id)) {
          newHere++;
          if (recent) {
            recentNew.push(row.match_id);
            // Media del Pro (022): se anota solo en el partido nuevo más reciente de cada jugador.
            for (const s of normalized.stats) {
              const prev = latestByPlayer.get(s.player_id);
              if (!prev || normalized.match.played_at > prev.playedAt) {
                latestByPlayer.set(s.player_id, { matchId: row.match_id, playedAt: normalized.match.played_at, playername: s.playername });
              }
            }
          }
        }
        if (normalized.match.opponent_club_id !== null) {
          opponents.push({ matchId: row.match_id, opponentId: String(normalized.match.opponent_club_id), opponentName: normalized.match.opponent_name ?? '', recent });
        }
      }

      matchesNew += newHere;
      log.info(`${matchType}: ${matches.length} recibidos, ${newHere} nuevos`);
    }

    await fillOpponentInfo(deps, clubId, opponents, now());
    const members = await captureMembers(deps, club.clubId, now(), failures);
    await notePlayerOverall(deps, members, latestByPlayer);
    const division = await captureClub(deps, club, now(), failures, firstPlayedAt);
    await captureExtras(deps, clubId, now());
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

interface Opponent {
  matchId: string;
  opponentId: string;
  opponentName: string;
  /** Partido nuevo de menos de 6 h: su división actual sirve para ese partido. */
  recent: boolean;
}

const dayOf = (at: Date) => at.toISOString().slice(0, 10);

/**
 * Rival de cada partido: su foto completa (clubs/overallStats y su fila del ranking
 * de la temporada) se guarda cruda en ea_snapshots; de ahí salen su nivel
 * (skillRating, si el partido aún no lo tiene) y su división (solo en partidos
 * recientes, como la nuestra). Es un dato complementario: si EA falla aquí NO se
 * marca la ejecución como error (se reintenta en la próxima, mientras el partido
 * siga entre los últimos 10). Cada rival se consulta una vez por ejecución.
 */
async function fillOpponentInfo(deps: CollectDeps, forClubId: number, opponents: Opponent[], at: Date): Promise<void> {
  if (opponents.length === 0) return;
  const missingSkill = await deps.repo.findMatchesMissingOpponentSkill(opponents.map((o) => o.matchId));
  const todo = opponents.filter((o) => missingSkill.has(o.matchId) || o.recent);
  const cache = new Map<string, { overall: unknown; season: unknown } | null>();
  const snapshots: EaSnapshotRow[] = [];
  let skills = 0, divisions = 0;
  for (const o of todo) {
    if (!cache.has(o.opponentId)) {
      try {
        const view = await deps.source.getClubOverview(o.opponentId, o.opponentName);
        cache.set(o.opponentId, view);
        const base = { for_club_id: forClubId, club_id: Number(o.opponentId), snapshot_date: dayOf(at), captured_at: at.toISOString(), is_opponent: true };
        if (view.overall != null) snapshots.push({ ...base, endpoint: 'clubs/overallStats', payload: view.overall });
        if (view.season != null) snapshots.push({ ...base, endpoint: 'currentSeasonLeaderboard', payload: view.season });
      } catch (err) {
        if (!(err instanceof ProClubsError)) throw err;
        deps.log.error(`No se pudo leer al rival ${o.opponentId}: ${messageOf(err)}`);
        cache.set(o.opponentId, null);
      }
    }
    const view = cache.get(o.opponentId);
    if (!view) continue;
    const skill = skillRatingOf(view.overall);
    if (skill != null && missingSkill.has(o.matchId)) { await deps.repo.setOpponentSkill(o.matchId, skill); skills++; }
    const division = divisionOf(view.season);
    if (division != null && o.recent) { await deps.repo.setOpponentDivision(o.matchId, division); divisions++; }
  }
  await deps.repo.saveEaSnapshots(snapshots);
  if (skills || divisions) deps.log.info(`Rivales: nivel en ${skills} partidos, división en ${divisions}`);
}

/**
 * Endpoints de EA que no se procesan todavía: clubs/info, club/playoffAchievements
 * y members/career/stats. Se guardan crudos (ea_snapshots), una foto por día, para
 * que no se pierda ningún dato. Complementarios: una falla de EA solo se registra.
 */
async function captureExtras(deps: CollectDeps, clubId: number, at: Date): Promise<void> {
  const rows: EaSnapshotRow[] = [];
  for (const endpoint of EXTRA_ENDPOINTS) {
    try {
      const payload = await deps.source.getExtra(String(clubId), endpoint);
      if (payload != null) rows.push({ for_club_id: clubId, club_id: clubId, endpoint, snapshot_date: dayOf(at), captured_at: at.toISOString(), is_opponent: false, payload });
    } catch (err) {
      if (!(err instanceof ProClubsError)) throw err;
      deps.log.error(`EA falló en ${endpoint}: ${messageOf(err)}`);
    }
  }
  await deps.repo.saveEaSnapshots(rows);
  if (rows.length) deps.log.info(`Guardados crudos: ${rows.map((r) => r.endpoint).join(', ')}`);
}

/**
 * Foto del club (nivel, división, temporada). Si EA falla, se registra como falla.
 * Devuelve la división actual (o null) para anotarla en los partidos nuevos.
 */
async function captureClub(deps: CollectDeps, club: FoundClub, at: Date, failures: SoftFailure[], firstPlayedAt: string | null): Promise<number | null> {
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
  // La foto anterior se lee ANTES de guardar (la del día se pisa en cada ejecución).
  const prev = await deps.repo.getLatestClubSnapshot(row.club_id);
  await deps.repo.saveClubSnapshot(row);
  await trackSeason(deps, row.club_id, prev, row, at, firstPlayedAt);
  const crest = crestOf(overview.season);
  if (crest.teamId != null || crest.crestAssetId != null) await deps.repo.setClubCrest(row.club_id, crest.teamId, crest.crestAssetId);
  deps.log.info(`Club: nivel ${row.skill_rating ?? '—'}, división ${row.current_division ?? '—'}, ${row.season_points ?? '—'} pts`);
  return row.current_division;
}

/**
 * Temporadas (migración 020):
 *  - club sin temporada: abre la del juego en curso (la de los demás clubes del
 *    mismo juego, o la 1), desde su partido más viejo visto;
 *  - EA reinició los contadores (isSeasonReset): cierra la actual y abre la
 *    siguiente desde la captura anterior (la última que veía la temporada vieja);
 *  - pasó un día del fin esperado sin reinicio: solo lo avisa en el log.
 */
async function trackSeason(deps: CollectDeps, clubId: number, prev: SeasonCounters | null, curr: SeasonCounters, at: Date, firstPlayedAt: string | null): Promise<void> {
  const open = await deps.repo.getOpenSeason(clubId);
  if (!open) {
    // Las temporadas son del juego (iguales para todos): un club nuevo entra en la
    // que tienen abierta los demás clubes del mismo juego; si no hay ninguno, la 1.
    const seasonNo = (await deps.repo.getGameSeasonNo(deps.config.season)) ?? 1;
    await deps.repo.startSeason({ club_id: clubId, season_no: seasonNo, started_at: firstPlayedAt ?? at.toISOString(), detected_by: 'inicio del registro' });
    deps.log.info(`Temporada ${seasonNo} abierta (inicio del registro)`);
    return;
  }
  if (isSeasonReset(prev, curr)) {
    await deps.repo.startSeason({
      club_id: clubId, season_no: open.season_no + 1, started_at: prev!.captured_at, detected_by: 'reinicio de EA',
      prev_games: prev!.season_games, prev_points: prev!.season_points,
    });
    deps.log.info(`Temporada ${open.season_no + 1}: EA reinició la temporada (${prev!.season_games} → ${curr.season_games} partidos)`);
    return;
  }
  if (isSeasonOverdue(open.expected_end_at, at)) {
    deps.log.error(`La temporada ${open.season_no} debía terminar el ${open.expected_end_at} y EA no reinició sus contadores: revisar.`);
  }
}

/** Foto de members/stats. Si EA falla, se registra como falla (dato oficial). Devuelve las filas (o null). */
async function captureMembers(deps: CollectDeps, clubId: string, at: Date, failures: SoftFailure[]): Promise<MemberSnapshotRow[] | null> {
  let response: unknown;
  try {
    response = await deps.source.getMemberStats(clubId);
  } catch (err) {
    if (!(err instanceof ProClubsError)) throw err;
    failures.push({ code: errorCodeOf(err), message: `members/stats: ${messageOf(err)}` });
    deps.log.error(`EA falló en members/stats: ${messageOf(err)}`);
    return null;
  }
  const rows = toMemberSnapshotRows(response, clubId, at);
  await deps.repo.saveMemberSnapshots(rows);
  deps.log.info(`Miembros: ${rows.length} guardados en la foto del ${rows[0]?.snapshot_date ?? '—'}`);
  return rows;
}

/**
 * Media del Pro por partido (022). EA da una sola media por miembro y no dice de
 * qué arquetipo es; hipótesis: es la del arquetipo de su último partido. Se anota
 * en el partido nuevo y reciente más nuevo de cada jugador (por nombre de cuenta),
 * justo después de capturarlo. Nunca pisa un valor ya guardado.
 */
async function notePlayerOverall(deps: CollectDeps, members: MemberSnapshotRow[] | null, latest: Map<string, { matchId: string; playername: string }>): Promise<void> {
  if (!members?.length || latest.size === 0) return;
  const byName = new Map(members.filter((m) => m.pro_overall != null).map((m) => [m.member_name, m.pro_overall as number]));
  const rows = [...latest].flatMap(([playerId, l]) => {
    const ovr = byName.get(l.playername);
    return ovr == null ? [] : [{ match_id: l.matchId, player_id: playerId, pro_overall: ovr }];
  });
  if (!rows.length) return;
  await deps.repo.setPlayerOverall(rows);
  deps.log.info(`Media del Pro anotada en ${rows.length} jugador(es) de partidos nuevos`);
}
