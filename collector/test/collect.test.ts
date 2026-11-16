import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { ProClubsError, type ClubMatch } from 'proclubs-sdk';
import { collect, type CollectDeps } from '../src/collect.ts';
import type { ClubRow, ClubSeasonRow, ClubSnapshotRow, EaSnapshotRow, MatchType, MemberSnapshotRow, NormalizedMatch, RawMatchRow, RunResult } from '../src/domain.ts';
import { ClubNotFoundError, type FoundClub, type MatchSource } from '../src/ea-source.ts';
import { RepositoryError, type StatsRepository } from '../src/repository.ts';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/matches-leagueMatch.json', import.meta.url), 'utf8'),
) as ClubMatch[];

// ---------------------------------------------------------------------------
// Dobles de prueba (fakes) en memoria
// ---------------------------------------------------------------------------

class FakeRepo implements StatsRepository {
  runs = new Map<number, RunResult | 'running'>();
  clubs = new Map<number, ClubRow>();
  raw = new Map<string, RawMatchRow>();
  matches = new Map<string, NormalizedMatch>();
  failOnNormalized = false;

  async startRun(): Promise<number> {
    const id = this.runs.size + 1;
    this.runs.set(id, 'running');
    return id;
  }
  async finishRun(id: number, r: RunResult): Promise<void> {
    this.runs.set(id, r);
  }
  async upsertClub(c: ClubRow): Promise<void> {
    this.clubs.set(c.club_id, c);
  }
  async findExistingMatchIds(ids: string[]): Promise<Set<string>> {
    return new Set(ids.filter((id) => this.matches.has(id)));
  }
  async saveRawMatch(row: RawMatchRow): Promise<void> {
    this.raw.set(row.match_id, row);
  }
  async saveNormalizedMatch(n: NormalizedMatch): Promise<void> {
    if (this.failOnNormalized) throw new RepositoryError('upsert matches: conexión rechazada');
    this.matches.set(n.match.match_id, n);
  }
  members = new Map<string, MemberSnapshotRow>();
  opponentSkill = new Map<string, number>();
  async saveMemberSnapshots(rows: MemberSnapshotRow[]): Promise<void> {
    for (const r of rows) this.members.set(`${r.member_name}|${r.snapshot_date}`, r);
  }
  async findMatchesMissingOpponentSkill(ids: string[]): Promise<Set<string>> {
    return new Set(ids.filter((id) => this.matches.has(id) && !this.opponentSkill.has(id)));
  }
  async setOpponentSkill(id: string, skill: number): Promise<void> {
    this.opponentSkill.set(id, skill);
  }
  opponentDivision = new Map<string, number>();
  async setOpponentDivision(id: string, division: number): Promise<void> {
    if (!this.opponentDivision.has(id)) this.opponentDivision.set(id, division);
  }
  eaSnapshots = new Map<string, EaSnapshotRow>();
  async saveEaSnapshots(rows: EaSnapshotRow[]): Promise<void> {
    for (const r of rows) this.eaSnapshots.set(`${r.for_club_id}|${r.club_id}|${r.endpoint}|${r.snapshot_date}`, r);
  }
  division = new Map<string, number>();
  async setClubDivision(ids: string[], division: number): Promise<void> {
    for (const id of ids) if (!this.division.has(id)) this.division.set(id, division);
  }
  clubSnapshots: ClubSnapshotRow[] = [];
  async saveClubSnapshot(row: ClubSnapshotRow): Promise<void> {
    this.clubSnapshots.push(row);
  }
  async getLatestClubSnapshot(): Promise<ClubSnapshotRow | null> {
    return this.clubSnapshots.at(-1) ?? null;
  }
  overall = new Map<string, number>();
  async setPlayerOverall(rows: { match_id: string; player_id: string; pro_overall: number }[]): Promise<void> {
    for (const r of rows) { const k = `${r.match_id}|${r.player_id}`; if (!this.overall.has(k)) this.overall.set(k, r.pro_overall); }
  }
  crest: { teamId: number | null; crestAssetId: number | null } | null = null;
  async setClubCrest(_clubId: number, teamId: number | null, crestAssetId: number | null): Promise<void> {
    this.crest = { teamId, crestAssetId };
  }
  seasons: (ClubSeasonRow & { ended_at: string | null })[] = [];
  async getOpenSeason(clubId: number) {
    const s = this.seasons.find((x) => x.club_id === clubId && x.ended_at === null);
    return s ? { season_no: s.season_no, started_at: s.started_at, expected_end_at: s.expected_end_at ?? null } : null;
  }
  gameSeasonNo: number | null = null;
  async getGameSeasonNo(): Promise<number | null> {
    return this.gameSeasonNo;
  }
  async startSeason(row: ClubSeasonRow): Promise<void> {
    for (const s of this.seasons) if (s.club_id === row.club_id && s.ended_at === null) s.ended_at = row.started_at;
    this.seasons.push({ ...row, ended_at: null });
  }
}

class FakeSource implements MatchSource {
  data: Partial<Record<MatchType, ClubMatch[] | Error>>;
  club: FoundClub | Error = { clubId: '1330384', name: 'Aston Huila' };

  constructor(data: Partial<Record<MatchType, ClubMatch[] | Error>>) {
    this.data = data;
  }
  async findClubByName(): Promise<FoundClub> {
    if (this.club instanceof Error) throw this.club;
    return this.club;
  }
  async listMatches(_clubId: string, type: MatchType): Promise<ClubMatch[]> {
    const d = this.data[type] ?? [];
    if (d instanceof Error) throw d;
    return structuredClone(d);
  }
  members: unknown = { members: [{ name: 'Jugador_01', proOverall: '78', gamesPlayed: '102', ratingAve: '6.9' }] };
  skillCalls = 0;
  skillError: Error | null = null;
  async getMemberStats(): Promise<unknown> {
    if (this.members instanceof Error) throw this.members;
    return this.members;
  }
  overview: { overall: unknown; season: unknown } | Error = {
    overall: { skillRating: '1595', bestDivision: '4', gamesPlayed: '104', wins: '48', ties: '10', losses: '46', wstreak: '0', unbeatenstreak: '2' },
    season: { clubId: '1330384', points: '47', currentDivision: '3', gamesPlayed: '63', wins: '30', ties: '7', losses: '26', goals: '157', goalsAgainst: '127',
      clubInfo: { teamId: 243, customKit: { crestAssetId: '99020510' } } },
  };
  async getClubOverview(clubId: string): Promise<{ overall: unknown; season: unknown }> {
    if (clubId !== '1330384') {
      // Rival: nivel y división derivados de su id, para poder comprobarlos.
      this.skillCalls++;
      if (this.skillError) throw this.skillError;
      return { overall: { skillRating: String(1000 + Number(clubId.slice(-3))) }, season: { clubId, currentDivision: '5' } };
    }
    if (this.overview instanceof Error) throw this.overview;
    return this.overview;
  }
  extras: Partial<Record<string, unknown>> = { 'clubs/info': { name: 'Aston Huila' }, 'club/playoffAchievements': [], 'members/career/stats': { members: [] } };
  async getExtra(_clubId: string, endpoint: string): Promise<unknown> {
    const v = this.extras[endpoint];
    if (v instanceof Error) throw v;
    return v;
  }
}

const silent = { info() {}, error() {} };

function deps(source: MatchSource, repo: StatsRepository): CollectDeps {
  return {
    config: {
      clubName: 'Aston Huila',
      platform: 'common-gen5',
      season: 'FC27',
      runner: 'test',
      matchTypes: ['leagueMatch', 'playoffMatch', 'friendlyMatch'],
    },
    source,
    repo,
    log: silent,
    now: () => new Date('2026-11-10T12:00:00Z'),
  };
}

// ---------------------------------------------------------------------------

describe('collect: miembros y fuerza del rival', () => {
  test('guarda la foto de members/stats y el nivel de cada rival una sola vez', async () => {
    const repo = new FakeRepo();
    const source = new FakeSource({ leagueMatch: fixture });
    const r = await collect(deps(source, repo));
    assert.equal(r.status, 'success');

    const snap = repo.members.get('Jugador_01|2026-11-10');
    assert.equal(snap?.pro_overall, 78);
    assert.equal(snap?.games_played, 102);
    assert.equal(snap?.rating_avg, 6.9);

    assert.equal(repo.opponentSkill.size, 10, 'cada partido recibe el nivel de su rival');
    const callsFirstRun = source.skillCalls;
    assert.ok(callsFirstRun <= 10, 'un mismo rival se consulta una sola vez por ejecución');

    await collect(deps(source, repo));
    assert.equal(source.skillCalls, callsFirstRun, 'la segunda ejecución no vuelve a consultar rivales');

    // La foto completa de cada rival queda cruda en ea_snapshots.
    const rivals = [...repo.eaSnapshots.values()].filter((s) => s.is_opponent);
    assert.equal(rivals.length, callsFirstRun * 2, 'overallStats y fila del ranking de cada rival');
    // Partidos viejos (más de 6 h): la división actual del rival no se les asigna.
    assert.equal(repo.opponentDivision.size, 0);
  });

  test('la división del rival se guarda solo en partidos nuevos y recientes', async () => {
    const repo = new FakeRepo();
    const source = new FakeSource({ leagueMatch: fixture });
    const last = Math.max(...fixture.map((m) => Number(m.timestamp) * 1000));
    const d = deps(source, repo);
    d.now = () => new Date(last + 60 * 60 * 1000); // 1 h después del último partido
    await collect(d);
    assert.ok(repo.opponentDivision.size >= 1);
    assert.ok(repo.opponentDivision.size < 10, 'los partidos de más de 6 h quedan sin división');
    for (const v of repo.opponentDivision.values()) assert.equal(v, 5);
  });

  test('guarda crudos clubs/info, play-off y carrera; si EA falla en uno, no es error', async () => {
    const repo = new FakeRepo();
    const source = new FakeSource({ leagueMatch: fixture });
    source.extras['members/career/stats'] = new ProClubsError('HTTP 503', 'HTTP');
    const r = await collect(deps(source, repo));
    assert.equal(r.status, 'success');
    const own = [...repo.eaSnapshots.values()].filter((s) => !s.is_opponent).map((s) => s.endpoint).sort();
    assert.deepEqual(own, ['club/playoffAchievements', 'clubs/info']);
  });

  test('si EA falla con el nivel del rival, NO marca la ejecución como error', async () => {
    const repo = new FakeRepo();
    const source = new FakeSource({ leagueMatch: fixture });
    source.skillError = new ProClubsError('timeout', 'TIMEOUT');
    const r = await collect(deps(source, repo));
    assert.equal(r.status, 'success');
    assert.equal(repo.opponentSkill.size, 0);
  });

  test('si EA falla con members/stats, la ejecución queda en error pero los partidos se guardan', async () => {
    const repo = new FakeRepo();
    const source = new FakeSource({ leagueMatch: fixture });
    source.members = new ProClubsError('HTTP 503', 'HTTP');
    const r = await collect(deps(source, repo));
    assert.equal(r.status, 'error');
    assert.match(r.errorMessage ?? '', /members\/stats/);
    assert.equal(repo.matches.size, 10);
  });
});

describe('collect: media del Pro por partido (022)', () => {
  test('se anota solo en el partido nuevo y reciente más nuevo de cada jugador', async () => {
    const repo = new FakeRepo();
    const source = new FakeSource({ leagueMatch: fixture });
    // Un miembro por cada cuenta del fixture, con media 80.
    const names = new Set<string>();
    for (const m of fixture) for (const p of Object.values((m.players as Record<string, Record<string, { playername: string }>>)['1330384'] ?? {})) names.add(p.playername);
    source.members = { members: [...names].map((name) => ({ name, proOverall: '80', gamesPlayed: '10' })) };
    const last = Math.max(...fixture.map((m) => Number(m.timestamp) * 1000));
    const d = deps(source, repo);
    d.now = () => new Date(last + 30 * 60 * 1000);
    await collect(d);
    assert.ok(repo.overall.size >= 1, 'hay medias anotadas');
    // Cada jugador tiene a lo sumo una media anotada (la de su partido más nuevo).
    const players = [...repo.overall.keys()].map((k) => k.split('|')[1]);
    assert.equal(new Set(players).size, players.length);
    for (const v of repo.overall.values()) assert.equal(v, 80);
  });

  test('partidos viejos (más de 6 h): no se anota nada', async () => {
    const repo = new FakeRepo();
    await collect(deps(new FakeSource({ leagueMatch: fixture }), repo));
    assert.equal(repo.overall.size, 0);
  });
});

describe('collect: temporadas', () => {
  test('un club nuevo entra en la temporada en curso del juego', async () => {
    const repo = new FakeRepo();
    repo.gameSeasonNo = 2; // otro club del mismo juego ya va en la 2
    await collect(deps(new FakeSource({ leagueMatch: fixture }), repo));
    assert.equal(repo.seasons[0]?.season_no, 2);
  });

  test('abre la temporada 1 con el primer partido y la siguiente cuando EA reinicia', async () => {
    const repo = new FakeRepo();
    const source = new FakeSource({ leagueMatch: fixture });
    const d = deps(source, repo);
    await collect(d);
    assert.equal(repo.seasons.length, 1);
    const first = repo.seasons[0]!;
    assert.equal(first.season_no, 1);
    assert.equal(first.detected_by, 'inicio del registro');
    const oldest = new Date(Math.min(...fixture.map((m) => Number(m.timestamp) * 1000))).toISOString();
    assert.equal(Date.parse(first.started_at), Date.parse(oldest), 'empieza con el partido más viejo visto');

    // Misma temporada: nada cambia.
    await collect(d);
    assert.equal(repo.seasons.length, 1);

    // EA reinicia los contadores (63 -> 1 partido, 47 -> 3 puntos).
    const prevCapture = repo.clubSnapshots.at(-1)!.captured_at;
    const ov = source.overview as { overall: unknown; season: Record<string, unknown> };
    source.overview = { overall: ov.overall, season: { ...ov.season, gamesPlayed: '1', points: '3', wins: '1', ties: '0', losses: '0' } };
    d.now = () => new Date('2026-11-10T12:15:00Z');
    await collect(d);
    assert.equal(repo.seasons.length, 2);
    const [s1, s2] = repo.seasons;
    assert.equal(s2!.season_no, 2);
    assert.equal(s2!.detected_by, 'reinicio de EA');
    assert.equal(s2!.started_at, prevCapture, 'empieza en la última captura de la temporada vieja');
    assert.equal(s2!.prev_games, 63);
    assert.equal(s1!.ended_at, prevCapture);
  });
});

describe('collect: foto del club', () => {
  test('guarda nivel, división y puntos de la temporada', async () => {
    const repo = new FakeRepo();
    const r = await collect(deps(new FakeSource({ leagueMatch: fixture }), repo));
    assert.equal(r.status, 'success');
    const s = repo.clubSnapshots[0]!;
    assert.equal(s.skill_rating, 1595);
    assert.equal(s.current_division, 3);
    // EA dice "mejor: 4" en overallStats estando en 3ª: la mejor nunca es peor que la actual.
    assert.equal(s.best_division, 3);
    assert.equal(s.season_points, 47);
    assert.equal(s.season_draws, 7);
    assert.equal(s.unbeaten_streak, 2);
    assert.equal(s.snapshot_date, '2026-11-10');
    assert.deepEqual(repo.crest, { teamId: 243, crestAssetId: 99020510 }, 'escudo del club');
  });

  test('escudo: con dCustomKit "0" no se usa el propio, sino el del equipo real (teamId)', async () => {
    const repo = new FakeRepo();
    const source = new FakeSource({ leagueMatch: fixture });
    const ov = source.overview as { overall: unknown; season: Record<string, unknown> };
    source.overview = { overall: ov.overall, season: { ...ov.season, clubInfo: { teamId: 101100, customKit: { crestAssetId: '99160313', dCustomKit: '0' } } } };
    await collect(deps(source, repo));
    assert.deepEqual(repo.crest, { teamId: 101100, crestAssetId: null });
  });

  test('si EA falla con el resumen del club, marca error pero conserva los partidos', async () => {
    const repo = new FakeRepo();
    const source = new FakeSource({ leagueMatch: fixture });
    source.overview = new ProClubsError('HTTP 500', 'HTTP');
    const r = await collect(deps(source, repo));
    assert.equal(r.status, 'error');
    assert.match(r.errorMessage ?? '', /club overview/);
    assert.equal(repo.matches.size, 10);
  });

  test('anota la división solo en partidos nuevos de las últimas 6 h', async () => {
    const times = fixture.map((m) => Number(m.timestamp) * 1000).sort((a, b) => b - a);
    const now = times[0]! + 60 * 60 * 1000; // 1 h después del más reciente
    const expected = times.filter((t) => now - t <= 6 * 60 * 60 * 1000).length;
    assert.ok(expected > 0 && expected < 10, 'el fixture tiene partidos dentro y fuera de la ventana');

    const repo = new FakeRepo();
    const source = new FakeSource({ leagueMatch: fixture });
    const d = { ...deps(source, repo), now: () => new Date(now) };
    await collect(d);
    assert.equal(repo.division.size, expected);
    assert.ok([...repo.division.values()].every((v) => v === 3));

    // Segunda ejecución con otra división: no pisa nada (los partidos ya no son nuevos).
    (source.overview as { season: { currentDivision: string } }).season.currentDivision = '2';
    await collect(d);
    assert.ok([...repo.division.values()].every((v) => v === 3));
  });

  test('sin la foto del club no anota división, y no es un error extra', async () => {
    const repo = new FakeRepo();
    const source = new FakeSource({ leagueMatch: fixture });
    source.overview = new ProClubsError('HTTP 500', 'HTTP');
    const latest = Math.max(...fixture.map((m) => Number(m.timestamp) * 1000));
    await collect({ ...deps(source, repo), now: () => new Date(latest + 1000) });
    assert.equal(repo.division.size, 0);
  });

  test('la plataforma de cada jugador llega a cuentas y stats', async () => {
    const repo = new FakeRepo();
    await collect(deps(new FakeSource({ leagueMatch: fixture }), repo));
    const n = [...repo.matches.values()][0]!;
    assert.ok(n.accounts.every((a) => a.platform === 'ps5'));
    assert.ok(n.stats.every((s) => s.platform === 'ps5'));
  });
});

describe('collect', () => {
  test('primera ejecución guarda todo y registra éxito', async () => {
    const repo = new FakeRepo();
    const r = await collect(deps(new FakeSource({ leagueMatch: fixture }), repo));

    assert.equal(r.status, 'success');
    assert.equal(r.clubId, 1330384);
    assert.equal(r.matchesSeen, 10);
    assert.equal(r.matchesNew, 10);
    assert.equal(repo.raw.size, 10);
    assert.equal(repo.matches.size, 10);
    assert.deepEqual(repo.clubs.get(1330384), {
      club_id: 1330384, name: 'Aston Huila', platform: 'common-gen5', season: 'FC27',
    });
    assert.deepEqual(repo.runs.get(1), r);
  });

  test('es idempotente: la segunda ejecución no tiene partidos nuevos', async () => {
    const repo = new FakeRepo();
    const source = new FakeSource({ leagueMatch: fixture });
    await collect(deps(source, repo));
    const second = await collect(deps(source, repo));

    assert.equal(second.status, 'success');
    assert.equal(second.matchesSeen, 10);
    assert.equal(second.matchesNew, 0);
    assert.equal(repo.matches.size, 10);
  });

  test('un partido inválido no bloquea a los demás y su JSON crudo se guarda', async () => {
    const broken = structuredClone(fixture);
    const players = broken[0]!.players as Record<string, Record<string, Record<string, unknown>>>;
    Object.values(players['1330384']!)[0]!.goals = 'x';

    const repo = new FakeRepo();
    const r = await collect(deps(new FakeSource({ leagueMatch: broken }), repo));

    assert.equal(r.status, 'error');
    assert.equal(r.errorCode, 'TRANSFORM');
    assert.match(r.errorMessage ?? '', new RegExp(String(broken[0]!.matchId)));
    assert.equal(repo.raw.size, 10, 'el crudo de los 10 se guarda');
    assert.equal(repo.matches.size, 9, 'se normalizan los 9 válidos');
    assert.equal(r.matchesNew, 9);
  });

  test('si EA falla en un tipo, sigue con los otros y marca error', async () => {
    const repo = new FakeRepo();
    const source = new FakeSource({
      leagueMatch: fixture,
      friendlyMatch: new ProClubsError('socket hang up', 'NETWORK'),
    });
    const r = await collect(deps(source, repo));

    assert.equal(r.status, 'error');
    assert.equal(r.errorCode, 'EA_NETWORK');
    assert.match(r.errorMessage ?? '', /friendlyMatch/);
    assert.equal(repo.matches.size, 10);
  });

  test('club no encontrado: lanza y deja registrada la ejecución fallida', async () => {
    const repo = new FakeRepo();
    const source = new FakeSource({});
    source.club = new ClubNotFoundError('no hay club');

    await assert.rejects(collect(deps(source, repo)), ClubNotFoundError);
    const run = repo.runs.get(1) as RunResult;
    assert.equal(run.status, 'error');
    assert.equal(run.errorCode, 'ClubNotFoundError');
  });

  test('falla de la base de datos: aborta y registra la falla', async () => {
    const repo = new FakeRepo();
    repo.failOnNormalized = true;

    await assert.rejects(collect(deps(new FakeSource({ leagueMatch: fixture }), repo)), RepositoryError);
    const run = repo.runs.get(1) as RunResult;
    assert.equal(run.status, 'error');
    assert.equal(run.errorCode, 'RepositoryError');
    assert.equal(repo.raw.size, 1, 'el crudo del primer partido alcanzó a guardarse');
  });
});
