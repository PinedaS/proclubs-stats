import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { ProClubsError, type ClubMatch } from 'proclubs-sdk';
import { collect, type CollectDeps } from '../src/collect.ts';
import type { ClubRow, MatchType, NormalizedMatch, RawMatchRow, RunResult } from '../src/domain.ts';
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
