// Se ejecuta con test/integration/run.sh (levanta Postgres + PostgREST).
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import type { ClubMatch } from 'proclubs-sdk';
import { collect } from '../../src/collect.ts';
import type { MatchType } from '../../src/domain.ts';
import type { MatchSource } from '../../src/ea-source.ts';
import { SupabaseStatsRepository, createServiceClient } from '../../src/repository.ts';

const API_URL = process.env.INT_API_URL;
const JWT_SECRET = process.env.INT_JWT_SECRET;
if (!API_URL || !JWT_SECRET) throw new Error('Corre esta prueba con test/integration/run.sh');

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/matches-leagueMatch.json', import.meta.url), 'utf8'),
) as ClubMatch[];

/** JWT HS256 mínimo, como los que emite Supabase para anon/service_role. */
function jwt(role: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${createHmac('sha256', JWT_SECRET!).update(body).digest('base64url')}`;
}

// supabase-js llama a <url>/rest/v1/...; PostgREST suelto sirve en la raíz.
const stripPrefix: typeof fetch = (input, init) =>
  fetch(String(input instanceof Request ? input.url : input).replace('/rest/v1', ''), init);

const service = createServiceClient(API_URL, jwt('service_role'), stripPrefix);
const anon = createServiceClient(API_URL, jwt('anon'), stripPrefix);

const source: MatchSource = {
  findClubByName: async () => ({ clubId: '1330384', name: 'Aston Huila' }),
  listMatches: async (_id: string, type: MatchType) => (type === 'leagueMatch' ? structuredClone(fixture) : []),
};

const config = {
  clubName: 'Aston Huila',
  platform: 'common-gen5' as const,
  season: 'FC27',
  runner: 'integration-test',
  matchTypes: ['leagueMatch', 'playoffMatch', 'friendlyMatch'] as MatchType[],
};

async function count(table: string): Promise<number> {
  const { count: n, error } = await service.from(table).select('*', { count: 'exact', head: true });
  assert.equal(error, null);
  return n ?? -1;
}

const ourPlayers = new Set(
  fixture.flatMap((m) => Object.keys((m.players as Record<string, object>)['1330384'] ?? {})),
);
const statRows = fixture.reduce(
  (n, m) => n + Object.keys((m.players as Record<string, object>)['1330384'] ?? {}).length,
  0,
);

describe('SupabaseStatsRepository contra Postgres + PostgREST', () => {
  const repo = new SupabaseStatsRepository(service);
  const log = { info() {}, error() {} };

  test('primera ejecución: guarda los 10 partidos', async () => {
    const r = await collect({ config, source, repo, log });
    assert.equal(r.status, 'success', r.errorMessage ?? '');
    assert.equal(r.matchesNew, 10);
    assert.equal(await count('matches'), 10);
    assert.equal(await count('match_raw'), 10);
    assert.equal(await count('player_match_stats'), statRows);
    assert.equal(await count('accounts'), ourPlayers.size);
    assert.equal(await count('persons'), ourPlayers.size);
  });

  test('segunda ejecución: idempotente, sin personas huérfanas ni fechas pisadas', async () => {
    const before = await service.from('accounts').select('player_id, first_seen_at, person_id').order('player_id');
    const r = await collect({ config, source, repo, log });
    const after = await service.from('accounts').select('player_id, first_seen_at, person_id').order('player_id');

    assert.equal(r.status, 'success', r.errorMessage ?? '');
    assert.equal(r.matchesNew, 0);
    assert.equal(await count('matches'), 10);
    assert.equal(await count('player_match_stats'), statRows);
    assert.equal(await count('persons'), ourPlayers.size, 'el trigger no debe crear personas en un upsert');
    assert.deepEqual(after.data, before.data, 'first_seen_at y person_id se conservan');
  });

  test('collector_runs registra ambas ejecuciones como exitosas', async () => {
    const { data, error } = await service.from('collector_runs').select('status, matches_new, club_id').order('run_id');
    assert.equal(error, null);
    assert.deepEqual(data, [
      { status: 'success', matches_new: 10, club_id: 1330384 },
      { status: 'success', matches_new: 0, club_id: 1330384 },
    ]);
  });

  test('el dashboard (anon) lee estadísticas pero no escribe ni ve el JSON crudo', async () => {
    const stats = await anon.rpc('person_stats', { p_match_types: ['leagueMatch'] });
    assert.equal(stats.error, null);
    assert.equal(stats.data?.length, ourPlayers.size);
    const total = (stats.data as { matches: number }[]).reduce((n, p) => n + p.matches, 0);
    assert.equal(total, statRows);

    // Experimentales: los regates (código 174) totales deben coincidir con el fixture.
    const expectedDribbles = fixture.reduce((n, m) => n + Object.values(
      (m.players as Record<string, Record<string, Record<string, string>>>)['1330384'] ?? {},
    ).reduce((k, p) => k + (p.match_event_aggregate_0 + ',' + (p.match_event_aggregate_1 ?? ''))
      .split(',').filter((x) => x.startsWith('174:')).reduce((s, x) => s + Number(x.split(':')[1]), 0), 0), 0);
    const dribbles = (stats.data as { dribbles_exp: number }[]).reduce((n, p) => n + Number(p.dribbles_exp ?? 0), 0);
    assert.ok(expectedDribbles > 0);
    assert.equal(dribbles, expectedDribbles);

    const status = await anon.from('v_collector_status').select('*').single();
    assert.equal(status.error, null);
    assert.equal((status.data as { consecutive_failures: number }).consecutive_failures, 0);

    const raw = await anon.from('match_raw').select('match_id').limit(1);
    assert.ok(raw.error, 'anon no debe leer match_raw');

    const ins = await anon.from('matches').insert({
      match_id: '1', club_id: 1330384, match_type: 'leagueMatch', played_at: new Date().toISOString(),
      goals_for: 0, goals_against: 0,
    });
    assert.ok(ins.error, 'anon no debe insertar');
  });
});
